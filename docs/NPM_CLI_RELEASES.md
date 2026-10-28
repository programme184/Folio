# Matched npm runtime and short CLI releases

`@agentsdock/server` supplies the signed runtime. `agentsdock` supplies the short
command and its reviewed first-global-install hook. Publish both from one clean,
committed source snapshot and one public version; the CLI dependency must be
`"@agentsdock/server": "VERSION"`, never a range or floating tag. The desktop
continues to pin the signed runtime descriptor, not a floating npm channel.

This document describes release tooling, not full product acceptance. As of
2026-10-11, runtime `latest` is `1.0.9`, runtime `beta` is `1.0.10-beta.6`, and
`agentsdock` is not public. Runtime publication run `38062694130`, attempt 1,
verified the exact beta.6 registry package, then stopped at the explicit
first-CLI bootstrap gate. It did not complete a matched desktop/CLI release.
Recheck these public states before acting; leave published bytes and stable
defaults unchanged. Main's development `server/VERSION` is not a reservation.
Do not rebuild the frozen beta.6 candidate or silently drop release-line fixes.

At the earlier preparation pins, main `3964cf80` was an ancestor of beta.4 source
`941bc4cd`. Later release-line changes include pending-update HTTP handling,
signed-update lock waiting, executable packaging permissions, native build
reservation corrections, persistent service PATH handling and instance lifecycle
work. This tooling change does not import those product changes into main.
Before cutting a new candidate, reconcile the current main and reviewed release
line explicitly, choose an unused version/build, and run full source and native
acceptance. Neither blindly bumping main nor reusing a prior accepted artifact
establishes that the new candidate contains the required runtime fixes.

## Operating releases from another computer

The operator computer can be a controller, not the signing host. Use a canonical
checkout and authenticated GitHub CLI (or the GitHub Actions UI). GitHub-hosted
jobs consume protected environment secrets; the operator need not download the
Developer ID private key, Apple API key, server signing key or npm OIDC token.
Local source checks additionally need the repository's pinned Node/pnpm and
Python tooling. Local native builds are a separate optional setup, not a
prerequisite for dispatching hosted builds.

Keep the identities and responsibilities separate:

| Responsibility | Required access |
| --- | --- |
| Review/push release source, dispatch jobs, inspect results | Repository write access and any required environment/review approval |
| Canonical desktop and mirror publication from CI | Dedicated `AGENTSDOCK_RELEASE_TOKEN` stored in `direct-production`, with Contents write on both repositories and Workflows write when the target differs in workflow files |
| Configure environment secrets/protection or grant repository access | Repository administrator; do not give the release token secret-administration privileges |
| First short CLI publication and package trust configuration | An authorized npm account, its browser/2FA approval and package settings access; GitHub login is not npm login |
| Routine paired npm publication | Each package's own Trusted Publisher for `server-npm-publish.yml` / `npm-release`; no local npm session or long-lived npm token |

An operator who dispatches the canonical CI workflow does not also need mirror
write access on their personal GitHub login. A local mirror publish helper does.
Keep the existing server trust key in AgentsServer and dispatch its signing
workflow; a source export alone must never publish a second bridge.

After credentials are provisioned, register and run
`release-credentials-preflight.yml` from a reviewed `main` or `release/*` commit,
with `source_sha` equal to the exact dispatched commit. This manual protected
job reads release access metadata, signs/verifies a disposable native probe
with the existing Developer ID, and authenticates a read-only notarization
history request. It creates no release, submits no notarization, publishes no
package, installs no service and uploads no private diagnostics. It reports
missing checks as failures, not an overall readiness pass.

The disposable signing keychain is on the hosted user's search list only while
signing and verifying the probe: `codesign --keychain` selects an identity but
still needs the search list to resolve its certificate chain. The original list
is restored in a `finally` block on success or failure; cleanup verifies it again.
The user's default keychain is never replaced.

The GitHub metadata check does not prove actual release-write permission. The
probe does not establish a full Electron build, notarization submission, public
publication, migration or reboot acceptance. A separately authorized hosted
native build/private draft and exact-artifact verification remain required.
`artifacts_only=true` skips the hosted Mac signing build and a successful
`verification_only=true` run checks existing signed packages, not the secrets
that would build a new one. The desktop workflows now retain the audited
build-number epochs and the canonical draft's verification-only replay; see
[the desktop release procedure](DIRECT_RELEASES.md#public-release-automation).
This does not import all release-line product fixes or the draft unified
product-release pipeline. Review the selected source's actual capabilities.
Never rebuild an existing immutable release just to test credentials. The new
preflight must first be registered on main through review before GitHub can
dispatch it on a selected reviewed branch.

### Completing permanent operator access

A green credential preflight completes only the credential gate. To establish
repeatable release capability from an operator's own computer:

1. Reconcile the intended source and release helpers; choose a new, unused
   version and its audited native build reservation. Do not rebuild a frozen
   candidate or bypass a failed native lifecycle check.
2. With explicit build/upload authorization, prepare and sign the immutable
   runtime/CLI pair and desktop candidate using the existing protected hosted
   workflows. Accept their native installation, lifecycle, update and rollback
   journeys at their actual platform boundaries.
3. With publication authorization, publish/verify the accepted runtime, then
   have the npm account holder bootstrap the short CLI from its accepted exact
   archive. Configure that package's separate Trusted Publisher as described
   below. A successful `npm whoami` is not proof of package ownership.
4. Validate the new trust with a subsequent accepted, authorized new-version CI
   publication. Replaying an already-published version skips `npm publish`, so
   it does not prove OIDC trust or activate a newly configured publisher.
5. Verify desktop publication to both repositories, exact registry downloads,
   public update feeds and a genuine installed update journey. Record source,
   versions, checksums and actual workflow results; do not equate green source
   tests with a completed public release.

After bootstrap and successful trust validation, routine releases use GitHub
dispatch plus the protected credentials. No personal mirror-write permission,
local signing keys or repeated npm login is required. Renew expiring repository
credentials and retain normal review, acceptance and publication approvals.

## Prepare the immutable pair

1. Commit the complete reviewed candidate, including its exact `server/VERSION`.
   Dispatch `server-npm-publish.yml`, `operation=prepare`, with its full
   `source_sha` and reviewed `source_ref` (`main` or `release/*`). Preparation runs
   package tests and produces separate runtime and CLI artifacts without running
   setup hooks, changing services, signing, or publishing.
2. Use the existing authorized server-signing process and current trust key for
   that exact runtime. Compare signed tarball bytes with the prepared runtime;
   this workflow does not create a new key or accept an unsigned descriptor.
3. Keep two separate input directories. The runtime directory contains exactly
   `server-VERSION.tgz`, `agents-server-npm-manifest.json` and its `.sig`. The CLI
   directory contains exactly `agentsdock-VERSION.tgz` and
   `agentsdock-cli-receipt.json`. Record both acceptance hashes. A checksum receipt
   is not a second signing identity: the CLI verifier additionally compares every
   packaged CLI file with the pinned Git source and checks the signed dependency.
4. Use the existing `npm-candidate-release.mjs` helper for the three-file runtime
   draft. The new CLI helper stages only the two-file CLI draft. Both are private
   release drafts, not public releases or public npm packages. Uploading requires
   separate explicit release authorization.

The CLI staging command below uses previously verified absolute paths and pins;
do not copy placeholders as literal values:

```sh
node scripts/agentsdock-cli-candidate-release.mjs stage \
  --assets "$CLI_DIR" --npm-assets "$RUNTIME_DIR" \
  --version "$VERSION" --track beta \
  --source-sha "$SOURCE_SHA" --source-ref "$SOURCE_REF" \
  --accepted-receipt-sha256 "$CLI_RECEIPT_SHA256" \
  --accepted-manifest-sha256 "$RUNTIME_MANIFEST_SHA256" \
  --expected-latest absent
```

`inspect` uses the same arguments and never uploads. Matching draft retries are
idempotent; conflicting tags, identities, inventories or bytes fail without
overwriting anything. CLI files do not get appended to the fixed three-file
runtime bundle or the desktop's sealed asset set.

## Acceptance before publication

Source CI covers command routing, explicit selectors, token privacy, setup
skip/failure/retry behavior, actual offline npm package installation in disposable
prefixes, and publication guards. Fixtures and safe existing-state no-op tests
do not establish fresh native service acceptance.

After these workflows are registered on the default branch, dispatch
`agentsdock-cli-native-acceptance.yml` on the exact prepared source/ref with
`manifest_sha256` and `cli_receipt_sha256`. It downloads the private pair and runs
on disposable GitHub-hosted Apple silicon macOS and Linux. It has no npm publish
or signing operation. Never spoof its runner guards on a developer account.

Registration is not implementation: the selected workflow commit must contain
the CLI verifier, staging helper, native harness and their tests. An older main
with only the registered YAML is not a runnable paired-release source. Supply
the exact reviewed branch and commit rather than relying on the UI default.

The native job exercises actual npm global postinstall, authenticated default
health, installed runtime bytes/modes, repeated-install process/identity/token
retention, list/status/info/token, named creation and lifecycle, removal
confirmation and synthetic state retention, default lifecycle and independence
from the original npm prefix/cache after restart. It also stops both default
components, verifies canceled removal preserves their exact runtime/configuration
and token, and verifies confirmed removal unregisters both while preserving
synthetic state and the unrelated named instance's retained state. Failure
receipts retain partial observations and never assert full product acceptance.
Bounded `failedCheck` identifiers must not contain private exception output.
Record the actual run,
attempt, source and both hashes; validate the original artifact's API digest and
contents rather than substituting another attempt.

The beta.6 diagnostic run `38027600173`, attempt 1, passed Linux but failed
macOS immediate named stop/start fresh-process and stable-health validation
after both commands returned success. Normal named restart passed. This remains
a known failed product boundary; importing stronger harness checks does not fix
the runtime or turn that result into acceptance. Preserve every original run,
attempt and failed/full-acceptance flag. Any product correction requires a new
candidate; do not rebuild beta.6 or weaken the lifecycle checks.

Remaining release checks:

- Fresh real global setup on both supported native hosts; missing `uv`/service
  prerequisites, occupied port, interrupted setup and explicit retry.
- Correct start/stop/restart/removal of both components of a split default
  installation. The current instance manager has a known old-layout binding
  limitation. The harness deliberately fails on refusal; do not bypass the
  binding check, stop only one component, or describe it as complete management.
- Interactive setup/pairing and optional dependency decline; native token-menu
  cancellation, bulk controls/exclusions, name reuse and removal/purge behavior.
- Genuine history retention and logout/reboot service survival. A synthetic
  marker and restart do not prove either.
- After authorized publication, fresh registry-backed exact-version install and
  `agentsdock@beta` resolution, before exposing a paired desktop release.
- If a desktop is also released, its normal signed-app, legacy bridge, managed
  update and platform gates still apply. This npm workflow does not waive them.

## First publication and authentication

The scoped runtime's npm trust configuration does not grant rights to
`agentsdock`. A registry 404 is not ownership or authentication evidence. Local
`npm whoami` must succeed for an owner-approved first publication; complete login
and 2FA in npm's own browser/terminal flow, never by pasting tokens in chat.

Once the accepted runtime is public, the owner must bootstrap the exact accepted
CLI tarball (not a rebuilt tarball):

```sh
EXPECTED_NPM_LATEST=1.0.9 node scripts/verify_agentsdock_cli_publication.mjs preflight \
  "$CLI_DIR" "$VERSION" "$SOURCE_SHA" "$CLI_RECEIPT_SHA256" \
  "$RUNTIME_DIR" "$RUNTIME_MANIFEST_SHA256" absent
# Only after acceptance, explicit publication approval and successful owner login:
npm publish "$CLI_DIR/agentsdock-$VERSION.tgz" --ignore-scripts --access public \
  --tag beta --registry https://registry.npmjs.org/
```

Configure the **agentsdock package's own** npm Trusted Publisher:

- GitHub user/organization: `ZhengyiLuo`
- Repository: `AgentsDock`
- Workflow filename: `server-npm-publish.yml` (filename only)
- Environment: `npm-release`
- Allow direct `npm publish`, not only staging. Dist-tag editing is unnecessary.

Create the configuration when its first accepted CI publication is ready:
[npm requires its first successful publish within two days](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).
If that window expires, delete the expired configuration and recreate it when
ready. Do not publish an unaccepted version to beat the deadline, or assume a
no-op replay of the bootstrap version activates trust. The later successful CI
publication must publish a new, accepted immutable version.

Preserve the existing scoped publisher, server trust key and Apple identities.
No new Apple credential or server key is required for this integration. See
[npm's trusted-publishing instructions](https://docs.npmjs.com/trusted-publishers/).

## Publish and resume without changing accepted bytes

Use the protected `server-npm-publish.yml` workflow with `operation=publish`:

| Input | Accepted value |
| --- | --- |
| `source_sha`, `source_ref` | Exact candidate source and reviewed branch |
| `workflow_sha` | Reviewed publishing workflow SHA; defaults to `source_sha` |
| `candidate_tag` | `npm-candidate-vVERSION` |
| `accepted_manifest_sha256` | Accepted runtime descriptor hash |
| `cli_candidate_tag` | `cli-candidate-vVERSION` |
| `accepted_cli_receipt_sha256` | Accepted CLI receipt hash |
| `expected_runtime_latest` | Observed stable baseline, currently `1.0.9` |
| `expected_cli_latest` | Observed stable baseline, initially `absent` |

The publisher first validates both local candidates, then publishes and downloads
the runtime for verification, then publishes/verifies the CLI. It checks npm
resolution metadata as well as tarball bytes. A beta must leave both `latest`
baselines unchanged; a future authorized stable release intentionally advances
them. The first missing CLI package stops with an explicit partial-release
summary for owner bootstrap. It is not reported as a completed matched release.

Rerun with the same accepted inputs after owner bootstrap or a transient registry
visibility failure. Exact public versions are verified and skipped, never
uploaded twice; conflicting public bytes/tags fail closed. Do not resolve an
error by rebuilding, overwriting or manually moving stable tags.

After both packages verify, retain the publication receipt and perform the fresh
registry installation check. Only then proceed with any separately authorized
legacy bridge and desktop publication. The desktop's existing local publish
helper is unchanged: its runtime/bridge checks alone do **not** prove CLI
publication, so the release operator must also require the paired npm receipt.

Initially advertise:

```sh
npm install -g agentsdock@beta
agentsdock list
```

There is no stable unscoped `latest` on the first beta. Do not advertise untagged
`npm install -g agentsdock` until an approved stable CLI is published. Existing
servers are not upgraded by reinstalling the CLI; use the signed managed-update
path. See the [CLI command guide](../server/npm/agentsdock/README.md).
