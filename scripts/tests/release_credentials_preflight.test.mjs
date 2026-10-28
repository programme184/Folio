import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/release-credentials-preflight.yml', import.meta.url), 'utf8')

function step(name) {
  const section = workflow.split(`        name: ${name}\n`)[1] ?? workflow.split(`      - name: ${name}\n`)[1]
  assert(section, `Missing step: ${name}`)
  const block = section.split('        run: |\n')[1]
  assert(block, `Missing inline script: ${name}`)
  const lines = []
  for (const line of block.split('\n')) {
    if (line && !line.startsWith('          ')) break
    lines.push(line.slice(10))
  }
  return lines.join('\n')
}

const guard = step('Require the exact reviewed hosted workflow')
const token = step('Check release-token identity and repository metadata without writes')
const signing = step('Verify existing Developer ID with a disposable signing probe')
const notary = step('Check existing Apple API authentication using read-only history')
const cleanup = step('Always restore keychain state and erase disposable credentials')

test('credential preflight is manual, canonical, protected, and hosted macOS only', () => {
  assert.match(workflow, /on:\n  workflow_dispatch:\n    inputs:\n      source_sha:/)
  assert.doesNotMatch(workflow, /^  (?:pull_request(?:_target)?|push|schedule|workflow_call|workflow_run):/m)
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' && github\.repository == 'ZhengyiLuo\/AgentsDock' && \(github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/heads\/release\/'\)\)/)
  assert.match(workflow, /environment: direct-production\n    runs-on: macos-15\n    timeout-minutes: 15/)
  assert.match(workflow, /permissions:\n  contents: read\n/)
  assert.doesNotMatch(workflow, /(?:contents|id-token|actions|packages): write/)
  assert.match(guard, /test "\$RUNNER_ENVIRONMENT" = github-hosted/)
  assert.match(guard, /test "\$RUNNER_OS" = macOS/)
  assert.match(guard, /test "\$SOURCE_SHA" = "\$GITHUB_SHA"/)
  assert.match(guard, /\^\[0-9a-f\]\{40\}\$/)
  assert.match(guard, /git check-ref-format "\$GITHUB_REF"/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('the sole action is the existing pinned checkout without persisted credentials', () => {
  assert.deepEqual([...workflow.matchAll(/uses: ([^\n ]+)/g)].map(match => match[1]), [
    'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  ])
  assert.match(workflow, /repository: ZhengyiLuo\/AgentsDock\n          ref: \$\{\{ inputs\.source_sha \}\}\n          persist-credentials: false/)
  assert.match(step('Verify the checked-out source pin'), /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/)
  assert(workflow.indexOf('Require the exact reviewed hosted workflow') < workflow.indexOf('actions/checkout@'))
  assert(workflow.indexOf('Verify the checked-out source pin') < workflow.indexOf('${{ secrets.'))
})

test('credentials stay in independently guarded step environments, never PR source checks', () => {
  assert.equal((workflow.match(/if: \$\{\{ !cancelled\(\) && steps\.source\.outcome == 'success' && steps\.private\.outcome == 'success' \}\}/g) || []).length, 3)
  assert.deepEqual([...workflow.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map(match => match[1]).sort(), [
    'AGENTSDOCK_RELEASE_TOKEN', 'APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_API_KEY_P8_BASE64',
    'MACOS_CERTIFICATE_P12_BASE64', 'MACOS_CERTIFICATE_PASSWORD',
  ])
  assert.doesNotMatch(workflow, /GITHUB_ENV|ACTIONS_STEP_DEBUG|set -x|set -[^\n ]*x|print\((?:result|payload|identity|metadata|token|password|encoded)/)
  for (const body of [token, signing, notary]) assert.match(body, /^set \+x\n/)
  assert.doesNotMatch(workflow, /AGENTSDOCK_SERVER_SIGNING|SERVER_SIGNING_KEY|NPM_TOKEN/)
})

test('GitHub credential use consists only of bounded GETs to fixed identity/repository metadata', () => {
  assert.match(token, /HTTPSConnection\("api\.github\.com", timeout=30\)/)
  assert.match(token, /connection\.request\("GET", path/)
  assert.match(token, /get_metadata\("\/user", token\)/)
  assert.match(token, /\("ZhengyiLuo\/AgentsDock", "ZhengyiLuo\/AgentsDock-Releases"\)/)
  assert.match(token, /get_metadata\("\/repos\/" \+ repository, token\)/)
  assert.match(token, /get\("permissions", \{\}\)\.get\("push"\) is not True/)
  assert.match(token, /response\.status != 200/)
  assert.match(token, /response\.read\(2 \* 1024 \* 1024 \+ 1\)/)
  assert.match(token, /not proof of token Contents\/Workflows write permission/)
  assert.doesNotMatch(token, /"(?:POST|PATCH|PUT|DELETE)"|gh |getheader\(["'](?:location|Location)/)
})

test('existing P12 signs only a disposable probe via the explicitly selected temporary keychain', () => {
  assert.match(signing, /"signing\.keychain-db"/)
  assert.match(signing, /base64\.b64decode\(""\.join\(encoded\.split\(\)\), validate=True\)/)
  assert.match(signing, /"security", "import"[^\n]*"-x"[^\n]*"-k", keychain, "-T", "\/usr\/bin\/codesign"/)
  assert.doesNotMatch(signing, /"-A"|generateKeyPair|openssl.*(?:req|genrsa|genpkey)|certificate-request/)
  assert.match(signing, /find-identity", "-v", "-p", "codesigning", keychain/)
  assert.match(signing, /Developer ID Application:/)
  assert.match(signing, /if len\(matches\) != 1:/)
  assert.match(signing, /"codesign", "--force", "--sign", matches\[0\], "--keychain", keychain, "--timestamp=none"/)
  assert.match(signing, /"codesign", "--verify", "--strict", "-R=anchor apple generic and certificate leaf\[field\.1\.2\.840\.113635\.100\.6\.1\.13\] exists"/)
  assert.match(signing, /capture_output=True, timeout=timeout, check=False/)
  assert.match(signing, /not full Electron signing\/notarization acceptance/)
})

test('search-list snapshot is immediately restored and always restored/verified on failure cleanup', () => {
  assert(signing.indexOf('(private / "keychain-baseline.json").write_text') < signing.indexOf('"create-keychain"'))
  assert.match(signing, /try:\n        command\(\["security", "create-keychain"[^]*?finally:\n[^]*?command\(\["security", "list-keychains", "-d", "user", "-s", \*baseline\["search"\]\]\)/)
  assert.equal((signing.match(/if keychain_state\(\) != baseline:/g) || []).length, 2)
  assert.match(workflow, /if: \$\{\{ always\(\) && steps\.private\.outcome == 'success' \}\}/)
  assert.match(cleanup, /raw\.is_symlink\(\)/)
  assert.match(cleanup, /private\.parent != pathlib\.Path\(os\.environ\["RUNNER_TEMP"\]\)\.resolve\(strict=True\)/)
  assert.match(cleanup, /private\.name\.startswith\("agentsdock-credentials\."\)/)
  assert.match(cleanup, /"security", "delete-keychain", str\(keychain\)/)
  assert.match(cleanup, /finally:\n        if baseline_file\.exists\(\):/)
  assert.match(cleanup, /"security", "list-keychains", "-d", "user", "-s", \*baseline\["search"\]/)
  assert.match(cleanup, /if actual != baseline:/)
  assert.match(cleanup, /shutil\.rmtree\(private\)/)
  assert.match(cleanup, /if failed:[^]*?sys\.exit\(1\)/)
  assert.doesNotMatch(workflow, /"default-keychain", "-d", "user", "-s"|rm -rf|(?:HOME|CODEX_HOME)=/)
})

test('signing checkpoints are fixed public labels, never private command output', () => {
  const labels = [...signing.matchAll(/^    +checkpoint\("([a-z-]+)"\)$/gm)].map(match => match[1])
  assert.deepEqual(labels, [
    'validate-private-directory', 'decode-existing-certificate', 'snapshot-keychain-state',
    'create-disposable-keychain', 'restore-keychain-search-list', 'verify-keychain-state',
    'configure-disposable-keychain', 'import-existing-certificate', 'configure-signing-key-access',
    'find-valid-developer-id', 'compile-disposable-probe', 'enable-disposable-keychain-for-signing',
    'sign-disposable-probe', 'verify-disposable-signature', 'restore-signing-search-list',
    'verify-final-keychain-state',
  ])
  assert.equal((signing.match(/checkpoint\(/g) || []).length, labels.length + 1)
  assert.match(signing, /print\("Developer ID probe checkpoint: " \+ name, flush=True\)/)
  assert.match(signing, /Private command output is intentionally suppressed/)
})

test('signing search-list scope restores exact state on success, sign failure and verify failure', () => {
  const python = signing.match(/python3 - <<'PY'\n([^]*?)\nPY(?:\n|$)/)[1]
  const result = spawnSync('python3', ['-c', `
import ast, pathlib, sys
tree = ast.parse(sys.stdin.read())
blocks = [node for node in ast.walk(tree) if isinstance(node, ast.Try)
          and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Call)
          and isinstance(node.body[0].value.func, ast.Name) and node.body[0].value.func.id == "checkpoint"
          and node.body[0].value.args[0].value == "enable-disposable-keychain-for-signing"]
assert len(blocks) == 1
code = compile(ast.fix_missing_locations(ast.Module(body=blocks, type_ignores=[])), "signing-scope", "exec")
for failure in (None, "--sign", "--verify"):
    baseline = {"search": ["/fixture/login.keychain-db"], "default": ["/fixture/login.keychain-db"]}
    keychain = "/fixture/probe.keychain-db"
    search, calls = list(baseline["search"]), []
    def command(arguments):
        calls.append(arguments)
        if arguments[:2] == ["security", "list-keychains"]:
            search[:] = arguments[5:]
        elif arguments[0] == "codesign":
            assert search == [keychain, *baseline["search"]]
            if failure and failure in arguments:
                raise RuntimeError("synthetic signing failure")
        else:
            raise AssertionError("unexpected command")
    scope = dict(command=command, checkpoint=lambda name: None, keychain=keychain,
                 baseline=baseline, matches=["f" * 40], probe=pathlib.Path("/fixture/probe"),
                 keychain_state=lambda: {"search": list(search), "default": baseline["default"]})
    try:
        exec(code, scope)
    except RuntimeError:
        assert failure is not None
    else:
        assert failure is None
    assert search == baseline["search"]
    assert calls[-1] == ["security", "list-keychains", "-d", "user", "-s", *baseline["search"]]
`], { input: python, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('notarization checks only read-only history, emits counts, and never persists private history', () => {
  assert.match(notary, /\["xcrun", "notarytool", "history", "--key", str\(key\)/)
  assert.match(notary, /"--output-format", "json", "--no-progress"/)
  assert.match(notary, /capture_output=True, timeout=120, check=False/)
  assert.match(notary, /result\.returncode or len\(result\.stdout\) > 8 \* 1024 \* 1024/)
  assert.match(notary, /str\(len\(payload\["history"\]\)\)/)
  assert.match(notary, /finally:\n        key\.unlink\(missing_ok=True\)/)
  assert.doesNotMatch(notary, /(?:write_text|write_bytes)\((?:result|payload)|print\((?:result|payload)|"submit"|"store-credentials"|--verbose/)
})

test('workflow cannot install packages, build an app, upload artifacts, or publish', () => {
  assert.doesNotMatch(workflow, /\b(?:npm|npx|pnpm|yarn)\s+(?:install|publish|exec|run|build)|gh (?:release|workflow|run)|upload-artifact@|download-artifact@|notarytool[" ]*,?[" ]*submit|xcodebuild|electron-builder|build_electron_release|git push/)
  assert.doesNotMatch(workflow, /--keychain-profile|--apple-id|--team-id|notarytool.*store-credentials/)
  const report = step('Report credential-only results and acceptance boundaries')
  assert.match(report, /not proof of token Contents\/Workflows write permission/)
  assert.match(report, /not complete Electron build\/notarization acceptance/)
  assert.match(report, /may temporarily change the hosted search list/)
  assert.match(report, /No package, release, draft, artifact, app, or notarization submission was published or uploaded/)
})

test('all inline scripts parse without executing credentials, network, signing, or cleanup', () => {
  // Static syntax checking only: never execute the workflow's Python or Bash.
  const bodies = [...workflow.matchAll(/^        run: \|\n((?:          .*\n|\n)+)/gm)].map(match => match[1].split('\n').map(line => line.slice(10)).join('\n'))
  assert.equal(bodies.length, 8)
  for (const body of bodies) {
    const bash = spawnSync('/bin/bash', ['--noprofile', '--norc', '-n'], { input: body, encoding: 'utf8' })
    assert.equal(bash.status, 0, bash.stderr)
    const python = body.match(/python3 - <<'PY'\n([^]*?)\nPY(?:\n|$)/)?.[1]
    if (python) {
      const syntax = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: python, encoding: 'utf8' })
      assert.equal(syntax.status, 0, syntax.stderr)
    }
  }
})
