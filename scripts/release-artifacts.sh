#!/usr/bin/env bash
# The SHA-256 record of a release's packed files (SR43, FORMA-134).
#
#   release-artifacts.sh record <dir>
#       Write <dir>/SHA256SUMS, one "<sha256>  <name>" line per file in <dir>,
#       and print the SHA-256 of that record.
#   release-artifacts.sh verify <dir> <record-sha256>
#       Pass only if <dir>/SHA256SUMS hashes to <record-sha256>, lists every
#       file in <dir> and nothing more, and every listed file has its hash.
#   release-artifacts.sh match <dir> <file>
#       Pass only if <file>'s name is listed in <dir>/SHA256SUMS with <file>'s
#       SHA-256 (used to compare a file rebuilt from the tag with the packed one).
#
# The release workflow's pack job runs `record` and hands the record's hash to
# the publish job as a job output; the publish job runs `verify` before it
# publishes anything. The expected hash travels outside the artefact, so
# replacing the artefact's files and its record together is caught as well as
# altering one file. Plain bash and coreutils: the publish job runs it with no
# dependency installed. Tested by scripts/test-release-artifacts.sh.
set -euo pipefail
export LC_ALL=C

RECORD=SHA256SUMS
# A packed file's name: no path, no leading dot or dash, nothing a shell or a
# CLI could read as anything else.
NAME_RE='^[A-Za-z0-9_@+][A-Za-z0-9._@+-]*$'
HASH_RE='^[0-9a-f]{64}$'

fail() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error title=release artefact check failed::$*" >&2
  else
    echo "release-artifacts: $*" >&2
  fi
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Every entry of <dir> must be a plain file with a plain name: no directory, no
# symbolic link, no hidden file can ride along beside the packed files.
check_entries() {
  local dir=$1 entry name
  while IFS= read -r -d '' entry; do
    name=${entry##*/}
    [ -L "$entry" ] && fail "$name in $dir is a symbolic link"
    [ -f "$entry" ] || fail "$name in $dir is not a regular file"
    [[ $name =~ $NAME_RE ]] || fail "unexpected file name in $dir: $name"
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -print0)
}

# Read <dir>/SHA256SUMS into the arrays NAMES and HASHES, refusing a malformed
# line, a path, or a name listed twice.
read_record() {
  local dir=$1 line hash name seen=" "
  NAMES=()
  HASHES=()
  [ -L "$dir/$RECORD" ] && fail "$dir/$RECORD is a symbolic link"
  [ -f "$dir/$RECORD" ] || fail "$dir/$RECORD is missing"
  while IFS= read -r line || [ -n "$line" ]; do
    hash=${line%%  *}
    name=${line#*  }
    [[ $hash =~ $HASH_RE ]] && [ "$line" = "$hash  $name" ] \
      || fail "malformed line in $dir/$RECORD: $line"
    [[ $name =~ $NAME_RE ]] && [ "$name" != "$RECORD" ] \
      || fail "the record lists a name that cannot be a packed file: $name"
    case $seen in *" $name "*) fail "the record lists $name twice" ;; esac
    seen="$seen$name "
    NAMES+=("$name")
    HASHES+=("$hash")
  done < "$dir/$RECORD"
  [ "${#NAMES[@]}" -gt 0 ] || fail "$dir/$RECORD lists no file"
}

cmd_record() {
  local dir=${1:?usage: release-artifacts.sh record <dir>} entry name count=0
  [ -d "$dir" ] || fail "$dir is not a directory"
  [ -e "$dir/$RECORD" ] && fail "$dir already holds a $RECORD"
  check_entries "$dir"
  : > "$dir/$RECORD.tmp"
  while IFS= read -r entry; do
    name=${entry##*/}
    printf '%s  %s\n' "$(sha256_of "$entry")" "$name" >> "$dir/$RECORD.tmp"
    count=$((count + 1))
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type f ! -name "$RECORD.tmp" | sort)
  if [ "$count" -eq 0 ]; then
    rm -f "$dir/$RECORD.tmp"
    fail "$dir holds no file to record"
  fi
  mv "$dir/$RECORD.tmp" "$dir/$RECORD"
  sha256_of "$dir/$RECORD"
}

cmd_verify() {
  local dir=${1:?usage: release-artifacts.sh verify <dir> <record-sha256>}
  local want=${2:-} got i entry name listed
  [[ $want =~ $HASH_RE ]] || fail "the expected record hash is not a SHA-256: '$want'"
  [ -d "$dir" ] || fail "$dir is not a directory"
  check_entries "$dir"
  got=$(sha256_of "$dir/$RECORD" 2>/dev/null) || fail "$dir/$RECORD is missing"
  [ "$got" = "$want" ] \
    || fail "$dir/$RECORD is not the record the pack job wrote (sha256 $got, expected $want)"
  read_record "$dir"
  for i in "${!NAMES[@]}"; do
    name=${NAMES[$i]}
    [ -f "$dir/$name" ] || fail "$name is listed in the record but missing"
    got=$(sha256_of "$dir/$name")
    [ "$got" = "${HASHES[$i]}" ] \
      || fail "$name differs from the packed file (sha256 $got, record ${HASHES[$i]})"
  done
  while IFS= read -r -d '' entry; do
    name=${entry##*/}
    [ "$name" = "$RECORD" ] && continue
    listed=no
    for i in "${!NAMES[@]}"; do
      [ "${NAMES[$i]}" = "$name" ] && listed=yes
    done
    [ "$listed" = yes ] || fail "$name is not in the record"
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -print0)
  for i in "${!NAMES[@]}"; do
    echo "verified ${HASHES[$i]}  ${NAMES[$i]}"
  done
}

cmd_match() {
  local dir=${1:?usage: release-artifacts.sh match <dir> <file>}
  local file=${2:?usage: release-artifacts.sh match <dir> <file>} name got i
  [ -f "$file" ] && [ ! -L "$file" ] || fail "$file is not a regular file"
  name=${file##*/}
  read_record "$dir"
  got=$(sha256_of "$file")
  for i in "${!NAMES[@]}"; do
    if [ "${NAMES[$i]}" = "$name" ]; then
      [ "$got" = "${HASHES[$i]}" ] \
        || fail "$name rebuilt here differs from the packed one (sha256 $got, record ${HASHES[$i]})"
      echo "matched ${HASHES[$i]}  $name"
      return 0
    fi
  done
  fail "$name is not in the record"
}

case ${1:-} in
  record) shift; cmd_record "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  match) shift; cmd_match "$@" ;;
  *) fail "usage: release-artifacts.sh record <dir> | verify <dir> <record-sha256> | match <dir> <file>" ;;
esac
