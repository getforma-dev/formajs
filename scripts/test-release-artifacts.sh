#!/usr/bin/env bash
# Tests for scripts/release-artifacts.sh (SR43, FORMA-134): a packed file
# altered between the pack job and the publish job fails the check the publish
# job runs before it publishes, so nothing ships. Every failing case asserts
# the exit status and the message naming the cause; the passing cases assert
# what was verified. Run: bash scripts/test-release-artifacts.sh
set -uo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
tool="$here/release-artifacts.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

passed=0
failed=0
out=""
status=0

run() { out=$(bash "$tool" "$@" 2>&1); status=$?; }
ok() { passed=$((passed + 1)); echo "ok - $1"; }
not_ok() { failed=$((failed + 1)); echo "not ok - $1"; echo "  status $status, output: $out"; }

expect_pass() { # <name> <substring>
  if [ "$status" -eq 0 ] && [[ $out == *"$2"* ]]; then ok "$1"; else not_ok "$1"; fi
}
expect_fail() { # <name> <substring>
  if [ "$status" -ne 0 ] && [[ $out == *"$2"* ]]; then ok "$1"; else not_ok "$1"; fi
}

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# A fresh packed set: a tarball-like file and a second file, recorded.
fresh() {
  rm -rf "$work/set"
  mkdir -p "$work/set"
  head -c 4096 /dev/urandom > "$work/set/pkg-1.2.3.tgz"
  printf 'forma\n' > "$work/set/pkg-1.2.3.list"
  record_hash=$(bash "$tool" record "$work/set")
}

fresh
if [[ $record_hash =~ ^[0-9a-f]{64}$ ]] && [ "$record_hash" = "$(sha "$work/set/SHA256SUMS")" ]; then
  ok "record prints the SHA-256 of the record it wrote"
else
  not_ok "record prints the SHA-256 of the record it wrote"
fi
if [ "$(wc -l < "$work/set/SHA256SUMS" | tr -d ' ')" = 2 ] \
  && grep -q "^$(sha "$work/set/pkg-1.2.3.tgz")  pkg-1.2.3.tgz$" "$work/set/SHA256SUMS" \
  && grep -q "^$(sha "$work/set/pkg-1.2.3.list")  pkg-1.2.3.list$" "$work/set/SHA256SUMS"; then
  ok "record lists every file with its hash"
else
  not_ok "record lists every file with its hash"
fi

run verify "$work/set" "$record_hash"
expect_pass "the untouched set verifies" "verified $(sha "$work/set/pkg-1.2.3.tgz")  pkg-1.2.3.tgz"

# One byte of the tarball changed after it was recorded.
fresh
printf 'X' | dd of="$work/set/pkg-1.2.3.tgz" bs=1 seek=100 conv=notrunc 2>/dev/null
run verify "$work/set" "$record_hash"
expect_fail "a tarball altered by one byte fails" "pkg-1.2.3.tgz differs from the packed file"

# The tarball replaced and the record rewritten to match it: the record's own
# hash, which the pack job passed outside the artefact, no longer matches.
fresh
head -c 4096 /dev/urandom > "$work/set/pkg-1.2.3.tgz"
rm "$work/set/SHA256SUMS"
bash "$tool" record "$work/set" > /dev/null
run verify "$work/set" "$record_hash"
expect_fail "a replaced tarball with a rewritten record fails" "is not the record the pack job wrote"

fresh
printf 'extra\n' > "$work/set/other-9.9.9.tgz"
run verify "$work/set" "$record_hash"
expect_fail "a file added beside the packed set fails" "other-9.9.9.tgz is not in the record"

fresh
printf 'x\n' > "$work/set/.npmrc"
run verify "$work/set" "$record_hash"
expect_fail "a hidden file added beside the packed set fails" "unexpected file name"

fresh
rm "$work/set/pkg-1.2.3.list"
run verify "$work/set" "$record_hash"
expect_fail "a listed file removed fails" "pkg-1.2.3.list is listed in the record but missing"

fresh
mkdir "$work/set/sub"
run verify "$work/set" "$record_hash"
expect_fail "a directory inside the set fails" "sub in"

fresh
mv "$work/set/pkg-1.2.3.tgz" "$work/elsewhere.tgz"
ln -s "$work/elsewhere.tgz" "$work/set/pkg-1.2.3.tgz"
run verify "$work/set" "$record_hash"
expect_fail "a symbolic link in place of a packed file fails" "is a symbolic link"

fresh
run verify "$work/set" "not-a-hash"
expect_fail "an expected hash that is not a SHA-256 fails" "is not a SHA-256"
run verify "$work/set" ""
expect_fail "a missing expected hash fails" "is not a SHA-256"

fresh
rm "$work/set/SHA256SUMS"
run verify "$work/set" "$record_hash"
expect_fail "a missing record fails" "SHA256SUMS is missing"

# A record that names a path outside the set, written with its own hash passed
# as expected: the line is refused before any file is read.
fresh
printf '%s  ../pkg-1.2.3.tgz\n' "$(sha "$work/set/pkg-1.2.3.tgz")" > "$work/set/SHA256SUMS"
run verify "$work/set" "$(sha "$work/set/SHA256SUMS")"
expect_fail "a record naming a path fails" "cannot be a packed file"

fresh
printf '%s  pkg-1.2.3.tgz\n%s  pkg-1.2.3.tgz\n' "$(sha "$work/set/pkg-1.2.3.tgz")" "$(sha "$work/set/pkg-1.2.3.tgz")" > "$work/set/SHA256SUMS"
rm "$work/set/pkg-1.2.3.list"
run verify "$work/set" "$(sha "$work/set/SHA256SUMS")"
expect_fail "a record listing a file twice fails" "lists pkg-1.2.3.tgz twice"

fresh
printf '%s pkg-1.2.3.tgz\n' "$(sha "$work/set/pkg-1.2.3.tgz")" > "$work/set/SHA256SUMS"
run verify "$work/set" "$(sha "$work/set/SHA256SUMS")"
expect_fail "a malformed record line fails" "malformed line"

mkdir -p "$work/empty"
run record "$work/empty"
expect_fail "recording an empty directory fails" "holds no file to record"

fresh
run record "$work/set"
expect_fail "recording over an existing record fails" "already holds a SHA256SUMS"

# match: a file rebuilt from the tag compared with the packed one.
fresh
mkdir -p "$work/rebuilt"
cp "$work/set/pkg-1.2.3.tgz" "$work/rebuilt/pkg-1.2.3.tgz"
run match "$work/set" "$work/rebuilt/pkg-1.2.3.tgz"
expect_pass "an identical rebuilt file matches" "matched $(sha "$work/set/pkg-1.2.3.tgz")  pkg-1.2.3.tgz"
printf 'X' | dd of="$work/rebuilt/pkg-1.2.3.tgz" bs=1 seek=7 conv=notrunc 2>/dev/null
run match "$work/set" "$work/rebuilt/pkg-1.2.3.tgz"
expect_fail "a rebuilt file that differs fails" "rebuilt here differs from the packed one"
cp "$work/set/pkg-1.2.3.tgz" "$work/rebuilt/pkg-1.2.4.tgz"
run match "$work/set" "$work/rebuilt/pkg-1.2.4.tgz"
expect_fail "a rebuilt file the record does not list fails" "pkg-1.2.4.tgz is not in the record"

echo "release-artifacts: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
