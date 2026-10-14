# frozen_string_literal: true

# SR43's lint over the release workflow (FORMA-134; decision brief L-34, L-42).
#
#   ruby scripts/check-release-workflow.rb              check the workflow
#   ruby scripts/check-release-workflow.rb --self-test  also seed one violation
#     per rule into a copy of the workflow and fail unless each is caught
#
# It fails unless: the release tag is the only trigger; every job declares its
# token; the publish job alone holds `id-token: write`; the publish and pack jobs
# restore no cache; the publish job runs no dependency code and no third-party
# action beyond the ones it needs, waits for every other job, downloads only this
# run's packed artefact and checks it against the pack job's record before it
# publishes. Ruby's standard library parses the YAML, so the check adds nothing
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
  # setup-node v5 and later cache on their own when package.json names a
  # packageManager; where the pinned setup-node is v5, the cache-free jobs must
  # turn that off explicitly.
  setup_node_cache_off_required: true,
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

# Whether a `permissions:` value grants the OIDC token.
def grants_id_token?(perms)
  return true if perms == 'write-all'
  perms.is_a?(Hash) && perms['id-token'].to_s == 'write'
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

def check_cache_free(doc, config, name, out)
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
    if config[:setup_node_cache_off_required] && action == 'actions/setup-node' && !(with.key?('package-manager-cache') && falsy?(with['package-manager-cache']))
      out << "C1 job `#{name}` step #{i + 1}: setup-node must set `package-manager-cache: false`, or it caches on its own"
    end
  end
end

def publish_command_index(steps, config)
  pattern = config[:registry] == :crates ? /\bcargo\s+publish\b/ : /\bnpm\s+publish\b/
  steps.index { |s| run_of(s) =~ pattern }
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
    if action_of(step) == 'actions/checkout'
      unless falsy?(with_of(step)['persist-credentials']) && with_of(step).key?('persist-credentials')
        out << "D4 the publish job's checkout must set `persist-credentials: false`"
      end
      if config[:registry] == :npm && !(with_of(step)['sparse-checkout'].to_s.strip != '' && falsy?(with_of(step)['sparse-checkout-cone-mode']) && with_of(step).key?('sparse-checkout-cone-mode'))
        out << 'D4 the npm publish job checks out only the verifier: `sparse-checkout` with `sparse-checkout-cone-mode: false`'
      end
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
  unless steps.any? { |s| action_of(s) == 'actions/upload-artifact' && with_of(s)['name'] == config[:artifact] }
    out << "K3 the pack job must upload the artefact #{config[:artifact].inspect}"
  end
end

def violations(doc, config = CONFIG)
  out = []
  return ['W0 the workflow is not a mapping'] unless doc.is_a?(Hash)

  check_trigger(doc, config, out)
  check_permissions(doc, config, out)
  check_publish_job(doc, config, out)
  check_pack_job(doc, config, out)
  check_cache_free(doc, config, config[:publish_job], out)
  check_cache_free(doc, config, config[:pack_job], out)
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

def publish_steps(doc)
  doc['jobs'][CONFIG[:publish_job]]['steps']
end

def step_index(doc, job, &blk)
  doc['jobs'][job]['steps'].index(&blk)
end

# One seeded violation per rule: [what it does, the rule that must catch it, mutation].
SEEDS = [
  ['a branch filter beside the tags', 'T1', ->(d) { d['on']['push']['branches'] = ['main'] }],
  ['a workflow_dispatch trigger', 'T1', ->(d) { d['on']['workflow_dispatch'] = nil }],
  ['a pull_request trigger', 'T1', ->(d) { d['on']['pull_request'] = { 'branches' => ['main'] } }],
  ['id-token: write at the workflow level', 'P1', ->(d) { d['permissions'] = { 'contents' => 'read', 'id-token' => 'write' } }],
  ['a job without permissions', 'P2', ->(d) { d['jobs'][CONFIG[:pack_job]].delete('permissions') }],
  ['contents: write on the publish job', 'P3', ->(d) { d['jobs'][CONFIG[:publish_job]]['permissions']['contents'] = 'write' }],
  ['id-token: write on the pack job', 'P4', ->(d) { d['jobs'][CONFIG[:pack_job]]['permissions'] = { 'contents' => 'read', 'id-token' => 'write' } }],
  ['write-all on the pack job', 'P4', ->(d) { d['jobs'][CONFIG[:pack_job]]['permissions'] = 'write-all' }],
  ['the pack job inheriting id-token: write from the workflow level', 'P4', lambda do |d|
    d['permissions'] = { 'id-token' => 'write' }
    d['jobs'][CONFIG[:pack_job]].delete('permissions')
  end],
  ['the publish job as a reusable workflow', 'J1', ->(d) { d['jobs'][CONFIG[:publish_job]] = { 'uses' => './.github/workflows/x.yml', 'permissions' => { 'contents' => 'read', 'id-token' => 'write' } } }],
  ['publish not waiting for the pack job', 'J2', ->(d) { d['jobs'][CONFIG[:publish_job]]['needs'] = needs_of(d['jobs'][CONFIG[:publish_job]]) - [CONFIG[:pack_job]] }],
  ['a new gate job publish does not wait for', 'J2', ->(d) { d['jobs']['late-gate'] = { 'permissions' => {}, 'runs-on' => 'ubuntu-latest', 'steps' => [{ 'run' => 'true' }] } }],
  ['publish without its tag condition', 'J3', ->(d) { d['jobs'][CONFIG[:publish_job]].delete('if') }],
  ['an environment the registry entry does not name', 'J4', ->(d) { d['jobs'][CONFIG[:publish_job]]['environment'] = 'unknown-environment' }],
  ['actions/cache in the publish job', 'C1', ->(d) { publish_steps(d).unshift('uses' => 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830', 'with' => { 'path' => '~/.npm', 'key' => 'k' }) }],
  ['rust-cache in the pack job', 'C1', ->(d) { d['jobs'][CONFIG[:pack_job]]['steps'].insert(1, 'uses' => 'Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6') }],
  ['a setup step with `cache:` in the publish job', 'C1', ->(d) { publish_steps(d).unshift('uses' => 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444', 'with' => { 'node-version' => 24, 'cache' => 'npm' }) }],
  ['npm ci in the publish job', 'D2', ->(d) { publish_steps(d).insert(1, 'run' => 'npm ci') }],
  ['cargo build in the publish job', 'D2', ->(d) { publish_steps(d).insert(1, 'run' => "cargo build --release\n") }],
  ['a third-party action in the publish job', 'D1', ->(d) { publish_steps(d).insert(1, 'uses' => 'peter-evans/repository-dispatch@28959ce8df70de7be546dd1250a005dd32156697') }],
  ['a local action in the publish job', 'D1', ->(d) { publish_steps(d).insert(1, 'uses' => './.github/actions/setup') }],
  ['the publish command without its safety flag', 'D3', lambda do |d|
    step = publish_steps(d)[publish_command_index(publish_steps(d), CONFIG)]
    step['run'] = step['run'].gsub(' --ignore-scripts', '').gsub(' --no-verify', '')
  end],
  ['a checkout that keeps its credentials', 'D4', lambda do |d|
    step = publish_steps(d).find { |s| action_of(s) == 'actions/checkout' }
    step['with'].delete('persist-credentials')
  end],
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
  ['no record-sha256 output on the pack job', 'K1', ->(d) { d['jobs'][CONFIG[:pack_job]]['outputs'].delete('record-sha256') }],
  ['no record written by the pack job', 'K2', ->(d) { d['jobs'][CONFIG[:pack_job]]['steps'].reject! { |s| run_of(s) =~ /release-artifacts\.sh record/ } }],
].freeze

CRATES_SEEDS = [
  ['no re-packaged crate matched before publishing', 'A3', ->(d) { publish_steps(d).reject! { |s| run_of(s) =~ /release-artifacts\.sh match/ } }],
].freeze

def self_test(doc)
  failures = 0
  seeds = SEEDS + (CONFIG[:registry] == :crates ? CRATES_SEEDS : [])
  seeds.each do |label, rule, mutate|
    copy = deep_copy(doc)
    mutate.call(copy)
    found = violations(copy)
    if found.any? { |v| v.start_with?("#{rule} ") }
      puts "ok - #{rule} catches #{label}"
    else
      failures += 1
      puts "not ok - #{rule} misses #{label}: #{found.inspect}"
    end
  end
  puts "check-release-workflow self-test: #{seeds.length - failures} of #{seeds.length} seeded violations caught"
  failures
end

if $PROGRAM_NAME == __FILE__
  doc = load_workflow(CONFIG[:workflow])
  found = violations(doc)
  if found.empty?
    puts "#{CONFIG[:workflow]}: SR43 holds (only `#{CONFIG[:publish_job]}` holds id-token: write; no cache in `#{CONFIG[:publish_job]}` or `#{CONFIG[:pack_job]}`)"
  else
    found.each { |v| puts "#{CONFIG[:workflow]}: #{v}" }
  end
  failures = ARGV.include?('--self-test') ? self_test(doc) : 0
  exit(found.empty? && failures.zero? ? 0 : 1)
end
