# frozen_string_literal: true

# SR43's lint over the release workflow (FORMA-134; decision brief L-34, L-42).
#
#   ruby scripts/check-release-workflow.rb              check the workflow
#   ruby scripts/check-release-workflow.rb --self-test  also seed violations into
#     a copy of the workflow, at least one for every rule, and fail unless each
#     is caught by the rule it names
#
# It fails unless: the release tag is the only trigger; every job declares its
# token; the publish job alone holds `id-token: write`; the publish and pack jobs
# restore no cache and run in no container; the publish job runs no dependency
# code and no third-party action beyond the ones it needs, waits for every other
# job, downloads only this run's packed artefact, checks it against the pack
# job's record before it publishes, and cannot go on to publish after a failed
# step or job; unless the pack job uploads that artefact with
# `overwrite: true`, so re-running all jobs after a failure replaces it; and
# unless the step after every `npm ci` is its own `npm audit signatures` (S1). Ruby's standard library parses the YAML, so the check adds nothing
# to the supply chain it guards. The repository-specific part is CONFIG.
require 'yaml'

CONFIG = {
  workflow: '.github/workflows/release.yml',
  tags: ['v*'],
  publish_job: 'publish',
  pack_job: 'pack',
  artifact: 'release-packed',
  # The environment the registry's trusted-publisher entry names; nil when the
  # publish job names none.
  environment: 'npm-publish',
  registry: :npm, # :npm or :crates
}.freeze

# Actions the publish job may use: GitHub's checkout, setup and artefact
# download, the Rust toolchain installer, and crates.io's OIDC token exchange.
PUBLISH_ACTIONS = %w[
  actions/checkout actions/setup-node actions/download-artifact
  dtolnay/rust-toolchain rust-lang/crates-io-auth-action
].freeze

# Commands that run code from the dependency tree or the package's own scripts.
DEPENDENCY_CODE = [
  /\bnpm\s+(ci|install|i|it|add|run|run-script|rum|urn|test|t|tst|start|stop|restart|exec|x|rebuild|rb|pack|link|ln|update|up)\b/,
  /\bnpx\b/,
  /\b(yarn|pnpm|bun|bunx)\b/,
  /\bcargo\s+(build|b|test|t|run|r|check|c|clippy|install|bench|doc|d|fix|rustc|rustdoc)\b/,
].freeze

# Shells GitHub runs with errexit (`bash -eo pipefail`, `sh -e`), so a failed
# command in a step stops the step.
ERREXIT_SHELLS = %w[bash sh].freeze

# A check line in the publish job: the whole line is the command, so nothing
# (`|| true`, `; true`, `|| :`, `&`, a pipe, a substitution) can swallow its
# failure.
CHECK_LINE = %r{\A\s*bash scripts/release-artifacts\.sh (?:verify|match)\b[^;&|`#\\\n]*\z}.freeze

def jobs_of(doc)
  doc['jobs'].is_a?(Hash) ? doc['jobs'] : {}
end

def needs_of(job)
  Array(job.is_a?(Hash) ? job['needs'] : nil).map(&:to_s)
end

def steps_of(job)
  job.is_a?(Hash) && job['steps'].is_a?(Array) ? job['steps'] : []
end

def action_of(step)
  step.is_a?(Hash) && step['uses'].is_a?(String) ? step['uses'].split('@').first : nil
end

def action_base(step)
  name = action_of(step)
  name && name.split('/').first(2).join('/')
end

def run_of(step)
  step.is_a?(Hash) && step['run'].is_a?(String) ? step['run'] : ''
end

def with_of(step)
  step.is_a?(Hash) && step['with'].is_a?(Hash) ? step['with'] : {}
end

def env_of(step)
  step.is_a?(Hash) && step['env'].is_a?(Hash) ? step['env'] : {}
end

def falsy?(value)
  [false, 'false', '', nil].include?(value)
end

def default_shell(holder)
  defaults = holder.is_a?(Hash) ? holder['defaults'] : nil
  run = defaults.is_a?(Hash) ? defaults['run'] : nil
  run.is_a?(Hash) ? run['shell'] : nil
end

# Whether a `permissions:` value grants the OIDC token.
def grants_id_token?(perms)
  return true if perms.to_s.downcase == 'write-all'
  perms.is_a?(Hash) && perms['id-token'].to_s.downcase == 'write'
end

# Jobs that need `name`, directly or through another job.
def dependants(jobs, name)
  found = []
  frontier = [name]
  until frontier.empty?
    current = frontier.shift
    jobs.each do |other, job|
      next if found.include?(other) || !needs_of(job).include?(current)

      found << other
      frontier << other
    end
  end
  found
end

def check_trigger(doc, config, out)
  on = doc['on']
  unless on.is_a?(Hash) && on.keys == ['push']
    out << "T1 the release tag must be the only trigger: `on` must hold `push` alone, found #{on.inspect}"
    return
  end
  push = on['push']
  unless push.is_a?(Hash) && push.keys == ['tags'] && Array(push['tags']).map(&:to_s).sort == config[:tags].sort
    out << "T1 `on.push` must hold only `tags: #{config[:tags].inspect}` (no branches, paths or other filter), found #{push.inspect}"
  end
end

def check_permissions(doc, config, out)
  top = doc['permissions']
  if grants_id_token?(top)
    out << 'P1 the workflow-level `permissions` grant `id-token: write` to every job; grant it on the publish job only'
  end
  jobs_of(doc).each do |name, job|
    next if job.is_a?(Hash) && job.key?('permissions')

    out << "P2 job `#{name}` declares no `permissions`, so it inherits the workflow's token; declare them on every job"
  end
  publish = jobs_of(doc)[config[:publish_job]]
  perms = publish.is_a?(Hash) ? publish['permissions'] : nil
  unless perms == { 'contents' => 'read', 'id-token' => 'write' }
    out << "P3 the publish job's permissions must be exactly `contents: read` and `id-token: write`, found #{perms.inspect}"
  end
  jobs_of(doc).each do |name, job|
    next if name == config[:publish_job]

    own = job.is_a?(Hash) && job.key?('permissions')
    next unless grants_id_token?(own ? job['permissions'] : top)

    out << "P4 job `#{name}` holds `id-token: write`#{own ? '' : ' (inherited from the workflow level)'}; only `#{config[:publish_job]}` may"
  end
end

# No cache in the jobs whose bytes publish. In `pack`, which has the whole tree,
# setup-node must also turn off the cache v5 and later add on their own when
# package.json names a packageManager; `publish` checks out no package.json (D4).
def check_cache_free(doc, name, out, setup_node_off_required:)
  job = jobs_of(doc)[name]
  steps_of(job).each_with_index do |step, i|
    action = action_of(step).to_s
    if action =~ /cache/i
      out << "C1 job `#{name}` step #{i + 1} uses `#{action}`; it must restore no cache"
    end
    with = with_of(step)
    if with.key?('cache') && !falsy?(with['cache'])
      out << "C1 job `#{name}` step #{i + 1} sets `cache: #{with['cache']}`; it must restore no cache"
    end
    if with.key?('package-manager-cache') && !falsy?(with['package-manager-cache'])
      out << "C1 job `#{name}` step #{i + 1} sets `package-manager-cache: #{with['package-manager-cache']}`; it must restore no cache"
    end
    if setup_node_off_required && action == 'actions/setup-node' && !(with.key?('package-manager-cache') && falsy?(with['package-manager-cache']))
      out << "C1 job `#{name}` step #{i + 1}: setup-node must set `package-manager-cache: false`, or v5 and later cache on their own"
    end
  end
end

# The jobs that hold the credential or produce the bytes run on the runner
# itself: a `container:` would run every step inside a third-party image, and a
# `services:` container would start one beside them.
def check_runtime(doc, name, out)
  job = jobs_of(doc)[name]
  return unless job.is_a?(Hash)

  %w[container services].each do |key|
    out << "R1 job `#{name}` sets `#{key}:`; it must run its steps on the runner, with no other image beside them" if job.key?(key)
  end
end

def publish_command_pattern(config)
  config[:registry] == :crates ? /\bcargo\s+publish\b/ : /\bnpm\s+publish\b/
end

def publish_command_index(steps, config)
  steps.index { |s| run_of(s) =~ publish_command_pattern(config) }
end

# A failed check, test or job must stop the publish (S1 of the review).
def check_fail_closed(doc, pub, config, out)
  if pub.key?('continue-on-error') && !falsy?(pub['continue-on-error'])
    out << 'E1 the publish job sets `continue-on-error`'
  end
  steps = pub['steps']
  steps.each_with_index do |step, i|
    next unless step.is_a?(Hash) && step.key?('continue-on-error') && !falsy?(step['continue-on-error'])

    out << "E1 the publish job's step #{i + 1} sets `continue-on-error`, so the job goes on after it fails"
  end

  last_publish = steps.each_index.select { |i| run_of(steps[i]) =~ publish_command_pattern(config) }.max
  (0..(last_publish || -1)).each do |i|
    next unless steps[i].is_a?(Hash) && steps[i].key?('if')

    out << "E2 the publish job's step #{i + 1} has `if: #{steps[i]['if']}`; no step up to the publish command may have one, so each runs only when every step before it passed"
  end

  if pub['if'].to_s =~ /\b(always|failure|cancelled)\s*\(/
    out << "E3 the publish job's `if` calls `#{Regexp.last_match(1)}()`, so it can run after a job it needs has failed"
  end

  steps.each_with_index do |step, i|
    run_of(step).each_line do |line|
      next unless line.include?('release-artifacts.sh')
      next if line.chomp =~ CHECK_LINE && !line.include?('$(')

      out << "E4 the publish job's step #{i + 1}: a check must be the whole line, with nothing to swallow its failure: #{line.strip}"
    end
  end

  [['the workflow', default_shell(doc)], ['the publish job', default_shell(pub)]].each do |where, shell|
    next if shell.nil? || ERREXIT_SHELLS.include?(shell)

    out << "E5 #{where} sets `defaults.run.shell: #{shell}`; the publish job's steps must run in bash or sh, which stop on a failed command"
  end
  steps.each_with_index do |step, i|
    if step.is_a?(Hash) && step.key?('shell') && !ERREXIT_SHELLS.include?(step['shell'])
      out << "E5 the publish job's step #{i + 1} sets `shell: #{step['shell']}`; it must run in bash or sh, which stop on a failed command"
    end
    if run_of(step) =~ /\bset\s+(\+[a-zA-Z]*e|\+o\s+errexit)/
      out << "E5 the publish job's step #{i + 1} turns errexit off (`#{Regexp.last_match(0)}`)"
    end
  end
end

def check_publish_job(doc, config, out)
  jobs = jobs_of(doc)
  pub_name = config[:publish_job]
  pub = jobs[pub_name]
  unless pub.is_a?(Hash) && pub['steps'].is_a?(Array)
    out << "J1 the workflow needs a job `#{pub_name}` with its own steps (not a reusable workflow)"
    return
  end

  waits_for = needs_of(pub)
  after_publish = dependants(jobs, pub_name)
  (jobs.keys - [pub_name] - after_publish).each do |other|
    next if waits_for.include?(other)

    out << "J2 the publish job does not wait for `#{other}`: list it under `needs`"
  end

  condition = pub['if'].to_s
  unless condition.include?("startsWith(github.ref, 'refs/tags/")
    out << "J3 the publish job's `if` must require a tag ref (startsWith(github.ref, 'refs/tags/...')), found #{condition.inspect}"
  end

  env = pub['environment']
  env_name = env.is_a?(Hash) ? env['name'] : env
  if config[:environment].nil?
    unless env.nil?
      out << "J4 the publish job names environment #{env_name.inspect}, which the registry entry does not; an environment GitHub does not know is created unprotected"
    end
  elsif env_name != config[:environment]
    out << "J4 the publish job must run in environment #{config[:environment].inspect}, the one the registry's trusted-publisher entry names; found #{env_name.inspect}"
  end

  check_fail_closed(doc, pub, config, out)

  steps = pub['steps']
  steps.each_with_index do |step, i|
    base = action_base(step)
    if base && !PUBLISH_ACTIONS.include?(base)
      out << "D1 the publish job's step #{i + 1} runs `#{action_of(step)}`; only #{PUBLISH_ACTIONS.join(', ')} may run beside the publish credential"
    end
    if step.is_a?(Hash) && step.key?('uses') && step['uses'].to_s.start_with?('./')
      out << "D1 the publish job's step #{i + 1} runs a local action from the checkout"
    end
    script = run_of(step)
    DEPENDENCY_CODE.each do |pattern|
      next unless script =~ pattern

      out << "D2 the publish job's step #{i + 1} runs dependency code (`#{Regexp.last_match(0)}`)"
    end
    script.scan(/\bnpm\s+publish\b[^\n]*/).each do |line|
      out << "D3 `npm publish` must pass --ignore-scripts: #{line.strip}" unless line.include?('--ignore-scripts')
      out << "D3 `npm publish` must pass --provenance: #{line.strip}" unless line.include?('--provenance')
    end
    script.scan(/\bcargo\s+(?:publish|package)\b[^\n]*/).each do |line|
      next if line.include?('--list')

      out << "D3 `#{line.strip}` must pass --no-verify, or it builds the crate and runs its dependencies' build scripts" unless line.include?('--no-verify')
    end
    next unless action_of(step) == 'actions/checkout'

    with = with_of(step)
    unless falsy?(with['persist-credentials']) && with.key?('persist-credentials')
      out << "D4 the publish job's checkout must set `persist-credentials: false`"
    end
    if config[:registry] == :npm && !(with['sparse-checkout'].to_s.strip != '' && falsy?(with['sparse-checkout-cone-mode']) && with.key?('sparse-checkout-cone-mode'))
      out << 'D4 the npm publish job checks out only the verifier: `sparse-checkout` with `sparse-checkout-cone-mode: false`'
    end
    %w[repository ref].each do |key|
      out << "D5 the publish job's checkout sets `#{key}:`; it must check out the tagged commit of this repository" if with.key?(key)
    end
  end

  publish_at = publish_command_index(steps, config)
  if publish_at.nil?
    out << "A0 the publish job has no `#{config[:registry] == :crates ? 'cargo publish' : 'npm publish'}` step"
    return
  end

  downloads = steps.each_index.select { |i| action_of(steps[i]) == 'actions/download-artifact' }
  if downloads.length != 1
    out << "A1 the publish job must download exactly one artefact, found #{downloads.length} download steps"
  else
    with = with_of(steps[downloads.first])
    out << "A1 the publish job must download the artefact named #{config[:artifact].inspect}" unless with['name'] == config[:artifact]
    %w[run-id github-token repository pattern artifact-ids merge-multiple].each do |key|
      out << "A1 the publish job's download sets `#{key}`; it must take this run's artefact by name only" if with.key?(key)
    end
    if with.key?('digest-mismatch') && with['digest-mismatch'] != 'error'
      out << "A1 the publish job's download must fail on a digest mismatch (`digest-mismatch: error`)"
    end
  end

  record_ref = "needs.#{config[:pack_job]}.outputs.record-sha256"
  verify_at = steps.index do |s|
    run_of(s) =~ %r{scripts/release-artifacts\.sh verify\b} &&
      (run_of(s).include?(record_ref) || env_of(s).values.any? { |v| v.to_s.include?(record_ref) })
  end
  if verify_at.nil?
    out << "A2 the publish job must run `scripts/release-artifacts.sh verify` against `#{record_ref}`"
  else
    out << 'A2 the artefact check must run after the download' if downloads.length == 1 && verify_at < downloads.first
    out << 'A2 the artefact check must run before the publish' if verify_at > publish_at
  end

  if config[:registry] == :crates
    match_at = steps.index { |s| run_of(s) =~ %r{scripts/release-artifacts\.sh match\b} }
    if match_at.nil? || match_at > publish_at || (verify_at && match_at < verify_at)
      out << 'A3 the crate re-packaged from the tag must be matched against the record (`release-artifacts.sh match`) after the check and before `cargo publish`'
    end
  end
end

def check_pack_job(doc, config, out)
  pack = jobs_of(doc)[config[:pack_job]]
  unless pack.is_a?(Hash) && pack['steps'].is_a?(Array)
    out << "K1 the workflow needs a job `#{config[:pack_job]}` with its own steps"
    return
  end
  outputs = pack['outputs'].is_a?(Hash) ? pack['outputs'] : {}
  out << 'K1 the pack job must declare the output `record-sha256`' unless outputs.key?('record-sha256')
  steps = pack['steps']
  unless steps.any? { |s| run_of(s) =~ %r{scripts/release-artifacts\.sh record\b} }
    out << 'K2 the pack job must write the record with `scripts/release-artifacts.sh record`'
  end
  upload = steps.find { |s| action_of(s) == 'actions/upload-artifact' && with_of(s)['name'] == config[:artifact] }
  unless upload
    out << "K3 the pack job must upload the artefact #{config[:artifact].inspect}"
    return
  end
  # A failed release is recovered by re-running all its jobs (forma documents
  # it so). Without `overwrite: true` the new attempt's upload may fail on the
  # name the earlier attempt's artefact holds (A2 audit S7, FORMA-179).
  # Replacing it is safe: publish checks every file against the record whose
  # hash `pack` passes as a job output, never against the artefact alone.
  unless [true, 'true'].include?(with_of(upload)['overwrite'])
    out << "K4 the pack job's upload of #{config[:artifact].inspect} must set `overwrite: true`, so re-running all jobs replaces the earlier attempt's artefact instead of failing on its name"
  end
end

# S1 (A2 audit F11, FORMA-180; the same rule in every repository's lint): the
# step right after every `npm ci` in a job is its own `run:` step whose command
# is exactly `npm audit signatures`, so a package whose registry record carries
# no signature, or one the registry's keys do not verify, fails the job before
# anything runs from the tree; and the audit appears nowhere else, so a job
# that installs nothing (publish) runs no npm command for it, and an audit
# moved after a build step audits nothing the build already ran. The audit is
# the whole step, so nothing on its line (`|| true`, `; true`, another
# command) can swallow its exit status.
AUDIT_SIGNATURES = /\Anpm audit signatures\z/.freeze

def check_audit_signatures(doc, config, out)
  return unless config[:registry] == :npm

  jobs_of(doc).each do |name, job|
    steps = steps_of(job)
    steps.each_with_index do |step, i|
      run = run_of(step)
      if run =~ /\bnpm\s+ci\b/
        following = steps[i + 1]
        unless following.is_a?(Hash) && run_of(following).strip =~ AUDIT_SIGNATURES
          found = following.nil? ? 'no step' : (following['run'] || following['uses']).to_s.strip.inspect
          out << "S1 job `#{name}` step #{i + 1} runs `npm ci`; the next step must be its own `run: npm audit signatures`, found #{found}"
        end
      elsif run =~ /npm audit signatures/
        previous = i.positive? ? steps[i - 1] : nil
        if run.strip !~ AUDIT_SIGNATURES
          out << "S1 job `#{name}` step #{i + 1}: `npm audit signatures` must be the whole step, with nothing to swallow its failure: #{run.strip.inspect}"
        elsif !(previous.is_a?(Hash) && run_of(previous) =~ /\bnpm\s+ci\b/)
          out << "S1 job `#{name}` step #{i + 1} runs `npm audit signatures` with no `npm ci` as the step before it; the audit follows an install, and a job that installs nothing runs no npm command"
        end
      end
    end
  end
end

def violations(doc, config = CONFIG)
  out = []
  return ['W0 the workflow is not a mapping'] unless doc.is_a?(Hash)

  check_trigger(doc, config, out)
  check_permissions(doc, config, out)
  check_publish_job(doc, config, out)
  check_pack_job(doc, config, out)
  check_audit_signatures(doc, config, out)
  check_cache_free(doc, config[:publish_job], out, setup_node_off_required: false)
  check_cache_free(doc, config[:pack_job], out, setup_node_off_required: true)
  check_runtime(doc, config[:publish_job], out)
  check_runtime(doc, config[:pack_job], out)
  out
end

def load_workflow(path)
  doc = YAML.safe_load(File.read(path), aliases: false, filename: path)
  # YAML 1.1 reads the key `on` as the boolean true; GitHub reads it as "on".
  doc['on'] = doc.delete(true) if doc.is_a?(Hash) && doc.key?(true)
  doc
end

def deep_copy(value)
  Marshal.load(Marshal.dump(value))
end

def publish_job(doc)
  doc['jobs'][CONFIG[:publish_job]]
end

def publish_steps(doc)
  publish_job(doc)['steps']
end

def pack_job(doc)
  doc['jobs'][CONFIG[:pack_job]]
end

def check_step(doc, kind = 'verify')
  publish_steps(doc).find { |s| run_of(s) =~ /release-artifacts\.sh #{kind}\b/ }
end

def publish_step(doc)
  publish_steps(doc)[publish_command_index(publish_steps(doc), CONFIG)]
end

def append_to_check(doc, suffix, kind = 'verify')
  step = check_step(doc, kind)
  step['run'] = step['run'].lines.map { |l| l =~ /release-artifacts\.sh #{kind}\b/ ? "#{l.chomp}#{suffix}\n" : l }.join
end

# A mutation may replace the whole document by returning [:replace, value].
REPLACE = :replace

# Seeded violations: [what it does, the rule that must catch it, mutation].
SEEDS = [
  ['a workflow that is not a mapping', 'W0', ->(_d) { [REPLACE, ['jobs']] }],
  ['a branch filter beside the tags', 'T1', ->(d) { d['on']['push']['branches'] = ['main'] }],
  ['a workflow_dispatch trigger', 'T1', ->(d) { d['on']['workflow_dispatch'] = nil }],
  ['a pull_request trigger', 'T1', ->(d) { d['on']['pull_request'] = { 'branches' => ['main'] } }],
  ['id-token: write at the workflow level', 'P1', ->(d) { d['permissions'] = { 'contents' => 'read', 'id-token' => 'write' } }],
  ['a job without permissions', 'P2', ->(d) { pack_job(d).delete('permissions') }],
  ['contents: write on the publish job', 'P3', ->(d) { publish_job(d)['permissions']['contents'] = 'write' }],
  ['id-token: write on the pack job', 'P4', ->(d) { pack_job(d)['permissions'] = { 'contents' => 'read', 'id-token' => 'write' } }],
  ['write-all on the pack job', 'P4', ->(d) { pack_job(d)['permissions'] = 'write-all' }],
  ['`id-token: Write` on the pack job', 'P4', ->(d) { pack_job(d)['permissions'] = { 'contents' => 'read', 'id-token' => 'Write' } }],
  ['the pack job inheriting id-token: write from the workflow level', 'P4', lambda do |d|
    d['permissions'] = { 'id-token' => 'write' }
    pack_job(d).delete('permissions')
  end],
  ['the publish job as a reusable workflow', 'J1', ->(d) { d['jobs'][CONFIG[:publish_job]] = { 'uses' => './.github/workflows/x.yml', 'permissions' => { 'contents' => 'read', 'id-token' => 'write' } } }],
  ['publish not waiting for the pack job', 'J2', ->(d) { publish_job(d)['needs'] = needs_of(publish_job(d)) - [CONFIG[:pack_job]] }],
  ['a new gate job publish does not wait for', 'J2', ->(d) { d['jobs']['late-gate'] = { 'permissions' => {}, 'runs-on' => 'ubuntu-latest', 'steps' => [{ 'run' => 'true' }] } }],
  ['the pack job uploading without overwrite: true', 'K4', lambda do |d|
    pack_job(d)['steps'].find { |s| action_of(s) == 'actions/upload-artifact' }['with'].delete('overwrite')
  end],
  ['the pack job uploading with overwrite: false', 'K4', lambda do |d|
    pack_job(d)['steps'].find { |s| action_of(s) == 'actions/upload-artifact' }['with']['overwrite'] = false
  end],
  ['publish without its tag condition', 'J3', ->(d) { publish_job(d).delete('if') }],
  ['an environment the registry entry does not name', 'J4', ->(d) { publish_job(d)['environment'] = 'unknown-environment' }],
  ['continue-on-error on the artefact check', 'E1', ->(d) { check_step(d)['continue-on-error'] = true }],
  ['continue-on-error on the publish job', 'E1', ->(d) { publish_job(d)['continue-on-error'] = true }],
  ['if: always() on the publish step', 'E2', ->(d) { publish_step(d)['if'] = 'always()' }],
  ['if: failure() on the publish step', 'E2', ->(d) { publish_step(d)['if'] = 'failure()' }],
  ['if: !cancelled() on the publish step', 'E2', ->(d) { publish_step(d)['if'] = '!cancelled()' }],
  ['if: always() on the artefact check', 'E2', ->(d) { check_step(d)['if'] = 'always()' }],
  ['always() in the publish job\'s if', 'E3', ->(d) { publish_job(d)['if'] = "always() && (#{publish_job(d)['if']})" }],
  ['!cancelled() in the publish job\'s if', 'E3', ->(d) { publish_job(d)['if'] = "!cancelled() && (#{publish_job(d)['if']})" }],
  ['`|| true` after the artefact check', 'E4', ->(d) { append_to_check(d, ' || true') }],
  ['`; true` after the artefact check', 'E4', ->(d) { append_to_check(d, '; true') }],
  ['`|| :` after the artefact check', 'E4', ->(d) { append_to_check(d, ' || :') }],
  ['the artefact check inside an if', 'E4', lambda do |d|
    step = check_step(d)
    step['run'] = step['run'].lines.map { |l| l =~ /release-artifacts\.sh verify/ ? "if #{l.strip}; then :; fi\n" : l }.join
  end],
  ['a publish job shell without errexit', 'E5', ->(d) { publish_job(d)['defaults'] = { 'run' => { 'shell' => 'bash {0}' } } }],
  ['a workflow shell without errexit', 'E5', ->(d) { d['defaults'] = { 'run' => { 'shell' => 'bash --noprofile --norc {0}' } } }],
  ['a step shell without errexit', 'E5', ->(d) { check_step(d)['shell'] = 'bash {0}' }],
  ['set +e before the artefact check', 'E5', ->(d) { check_step(d)['run'] = "set +e\n#{check_step(d)['run']}" }],
  ['container: on the publish job', 'R1', ->(d) { publish_job(d)['container'] = 'node:24' }],
  ['services: on the publish job', 'R1', ->(d) { publish_job(d)['services'] = { 'x' => { 'image' => 'someone/image:1' } } }],
  ['container: on the pack job', 'R1', ->(d) { pack_job(d)['container'] = 'node:24' }],
  ['actions/cache in the publish job', 'C1', ->(d) { publish_steps(d).unshift('uses' => 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830', 'with' => { 'path' => '~/.npm', 'key' => 'k' }) }],
  ['rust-cache in the pack job', 'C1', ->(d) { pack_job(d)['steps'].insert(1, 'uses' => 'Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6') }],
  ['a setup step with `cache:` in the publish job', 'C1', ->(d) { publish_steps(d).unshift('uses' => 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444', 'with' => { 'node-version' => 24, 'cache' => 'npm' }) }],
  ['setup-node in the pack job without `package-manager-cache: false`', 'C1', ->(d) { pack_job(d)['steps'].insert(1, 'uses' => 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444', 'with' => { 'node-version' => 24 }) }],
  ['npm ci in the publish job', 'D2', ->(d) { publish_steps(d).insert(1, 'run' => 'npm ci') }],
  ['cargo build in the publish job', 'D2', ->(d) { publish_steps(d).insert(1, 'run' => "cargo build --release\n") }],
  ['a third-party action in the publish job', 'D1', ->(d) { publish_steps(d).insert(1, 'uses' => 'peter-evans/repository-dispatch@28959ce8df70de7be546dd1250a005dd32156697') }],
  ['a local action in the publish job', 'D1', ->(d) { publish_steps(d).insert(1, 'uses' => './.github/actions/setup') }],
  ['the publish command without its safety flag', 'D3', lambda do |d|
    step = publish_step(d)
    step['run'] = step['run'].gsub(' --ignore-scripts', '').gsub(' --no-verify', '')
  end],
  ['a checkout that keeps its credentials', 'D4', ->(d) { publish_steps(d).find { |s| action_of(s) == 'actions/checkout' }['with'].delete('persist-credentials') }],
  ['a checkout of another repository in the publish job', 'D5', ->(d) { publish_steps(d).find { |s| action_of(s) == 'actions/checkout' }['with']['repository'] = 'someone/else' }],
  ['a checkout of another ref in the publish job', 'D5', ->(d) { publish_steps(d).find { |s| action_of(s) == 'actions/checkout' }['with']['ref'] = 'main' }],
  ['no publish command', 'A0', ->(d) { publish_steps(d).reject! { |s| run_of(s) =~ publish_command_pattern(CONFIG) } }],
  ['an artefact from another run', 'A1', lambda do |d|
    step = publish_steps(d).find { |s| action_of(s) == 'actions/download-artifact' }
    step['with']['run-id'] = '123'
    step['with']['github-token'] = '${{ github.token }}'
  end],
  ['no artefact check', 'A2', ->(d) { publish_steps(d).reject! { |s| run_of(s) =~ /release-artifacts\.sh verify/ } }],
  ['the artefact check after the publish', 'A2', lambda do |d|
    steps = publish_steps(d)
    check = steps.delete_at(steps.index { |s| run_of(s) =~ /release-artifacts\.sh verify/ })
    steps.insert(publish_command_index(steps, CONFIG) + 1, check)
  end],
  ['no record-sha256 output on the pack job', 'K1', ->(d) { pack_job(d)['outputs'].delete('record-sha256') }],
  ['no record written by the pack job', 'K2', ->(d) { pack_job(d)['steps'].reject! { |s| run_of(s) =~ /release-artifacts\.sh record/ } }],
  ['no artefact uploaded by the pack job', 'K3', ->(d) { pack_job(d)['steps'].reject! { |s| action_of(s) == 'actions/upload-artifact' } }],
].freeze

NPM_SEEDS = [
  ['a full checkout in the npm publish job', 'D4', lambda do |d|
    with = publish_steps(d).find { |s| action_of(s) == 'actions/checkout' }['with']
    with.delete('sparse-checkout')
    with.delete('sparse-checkout-cone-mode')
  end],
  ['an npm ci in the pack job with no npm audit signatures after it', 'S1', lambda do |d|
    pack_job(d)['steps'].reject! { |s| run_of(s).strip == 'npm audit signatures' }
  end],
  ['the audit before the install instead of after it', 'S1', lambda do |d|
    steps = pack_job(d)['steps']
    audit = steps.delete_at(steps.index { |s| run_of(s).strip == 'npm audit signatures' })
    steps.insert(steps.index { |s| run_of(s) =~ /\bnpm\s+ci\b/ }, audit)
  end],
  ['the audit moved after the build step', 'S1', lambda do |d|
    steps = pack_job(d)['steps']
    audit = steps.delete_at(steps.index { |s| run_of(s).strip == 'npm audit signatures' })
    steps.insert(steps.index { |s| run_of(s) =~ /\bnpm run build\b/ } + 1, audit)
  end],
  ['an audit whose failure a `|| true` swallows', 'S1', lambda do |d|
    pack_job(d)['steps'].find { |s| run_of(s).strip == 'npm audit signatures' }['run'] = 'npm audit signatures || true'
  end],
  ['an audit whose failure a `; true` swallows', 'S1', lambda do |d|
    pack_job(d)['steps'].find { |s| run_of(s).strip == 'npm audit signatures' }['run'] = "npm audit signatures; true\n"
  end],
  ['the audit combined with the install in one step', 'S1', lambda do |d|
    steps = pack_job(d)['steps']
    steps.delete_at(steps.index { |s| run_of(s).strip == 'npm audit signatures' })
    steps.find { |s| run_of(s) =~ /\bnpm\s+ci\b/ }['run'] = 'npm ci && npm audit signatures'
  end],
  ['an audit added to the publish job, which installs nothing', 'S1', ->(d) { publish_steps(d).insert(1, 'run' => 'npm audit signatures') }],
  ['an npm ci in a new job with no audit', 'S1', lambda do |d|
    d['jobs']['extra'] = { 'permissions' => { 'contents' => 'read' }, 'runs-on' => 'ubuntu-latest', 'steps' => [{ 'run' => 'npm ci' }, { 'run' => 'npm test' }] }
    publish_job(d)['needs'] = needs_of(publish_job(d)) + ['extra']
  end],
].freeze

CRATES_SEEDS = [
  ['no re-packaged crate matched before publishing', 'A3', ->(d) { publish_steps(d).reject! { |s| run_of(s) =~ /release-artifacts\.sh match/ } }],
  ['continue-on-error on the re-package and match step', 'E1', ->(d) { check_step(d, 'match')['continue-on-error'] = true }],
  ['`|| true` after a match', 'E4', ->(d) { append_to_check(d, ' || true', 'match') }],
].freeze

# The rules this file can report, read from its own source, so a rule added
# without a seed fails the self-test.
def rule_ids
  File.read(__FILE__).scan(/(?:out << |\[)["']([A-Z]\d) /).flatten.uniq.sort
end

def self_test(doc)
  failures = 0
  crates = CONFIG[:registry] == :crates
  seeds = SEEDS + (crates ? CRATES_SEEDS : NPM_SEEDS)
  baseline = violations(doc)
  seeds.each do |label, rule, mutate|
    copy = deep_copy(doc)
    result = mutate.call(copy)
    copy = result[1] if result.is_a?(Array) && result[0] == REPLACE
    # Only what the seed adds counts: a rule the real workflow already breaks
    # cannot pass its seed for it.
    found = violations(copy) - baseline
    if found.any? { |v| v.start_with?("#{rule} ") }
      puts "ok - #{rule} catches #{label}"
    else
      failures += 1
      puts "not ok - #{rule} misses #{label}: #{found.inspect}"
    end
  end
  applicable = rule_ids - (crates ? [] : ['A3'])
  unseeded = applicable - seeds.map { |_, rule, _| rule }
  if unseeded.empty?
    puts "ok - every rule has a seed (#{applicable.join(' ')})"
  else
    failures += 1
    puts "not ok - rules without a seed: #{unseeded.join(' ')}"
  end
  puts "check-release-workflow self-test: #{seeds.length + 1 - failures} of #{seeds.length + 1} checks passed (#{seeds.length} seeded violations, #{applicable.length} rules)"
  failures
end

if $PROGRAM_NAME == __FILE__
  doc = load_workflow(CONFIG[:workflow])
  found = violations(doc)
  if found.empty?
    puts "#{CONFIG[:workflow]}: SR43 holds (only `#{CONFIG[:publish_job]}` holds id-token: write; no cache or container in `#{CONFIG[:publish_job]}` or `#{CONFIG[:pack_job]}`; a failed check stops the publish)"
  else
    found.each { |v| puts "#{CONFIG[:workflow]}: #{v}" }
  end
  failures = ARGV.include?('--self-test') ? self_test(doc) : 0
  exit(found.empty? && failures.zero? ? 0 : 1)
end
