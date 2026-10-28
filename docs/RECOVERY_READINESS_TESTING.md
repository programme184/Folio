# Queue recovery and emergency acknowledgement acceptance

This matrix covers failed queue restoration, emergency receipt scans, and their
interaction with desktop connection/update status. It does not establish the
cause of an individual remote installation's failure.

## Test cases

| Case | Action | Expected result | Coverage |
| --- | --- | --- | --- |
| Healthy startup | Connect, send, follow up, refresh and reopen a disposable chat | Chat admission is ready; messages and history work | Native Electron and real provider; automated HTTP |
| Pending recovery | Hold restoration while several callers send | Bounded 503 responses; shared recovery keeps running | Automated async admission |
| Recovery fails | Finish restoration with TimeoutError or OSError; repeat Send and Refresh | Health stays accessible but chat readiness is failed; clear error, no false progress or lost draft/history | Automated HTTP; native Electron against isolated failing server |
| Caller cancels | Cancel a waiting HTTP/admission task | Shared restoration is not cancelled | Automated admission |
| Recovery owner | Queue work from the restoration task itself | No self-deadlock | Automated admission |
| Restored work ordering | Restore durable messages before allowing new work | No lost messages or new work jumping ahead | Queue and split gateway/worker integration |
| Large text event | Put a generated 256 MiB event after a synthetic alert, then acknowledge over loopback HTTP | Exactly one acknowledgement within the client deadline | Real HTTP performance fixture |
| Large structured event | Put more than 250,000 irrelevant JSON values after an alert | Acknowledgement succeeds without applying native-import budgets to the journal | Automated server regression |
| Metadata projection | Scan large discarded object keys and nested payloads | Bounded retained metadata; native import defaults remain unchanged | Parser and import compatibility |
| Duplicate clicks | Eight concurrent authenticated acknowledgements and a later retry | One durable receipt; retries report no new acknowledgement | Automated HTTP; sequential native UI/HTTP retry |
| Wrong authority or target | Omit token, change alert ID or chat | Request rejected; original journal unchanged | Automated HTTP |
| Concurrent projection | Append/ack while projection scans; fail persistence | No global-store lock held through scan, stale resurrection or false committed success | Emergency lifecycle regressions |
| Desktop update status | Report matching versions with recovering/failed chat admission | Pending/failed rather than complete; recovery can clear status | Desktop coordinator and service tests |
| Older server | Omit the new readiness field | Existing connection/update behavior retained | Desktop compatibility tests |
| Update activation | Exercise preparation, held gateway, failed activation and recovery | Existing work/state preserved; exact hold released; safe retry/rollback | Isolated worker/gateway processes and installer regression fixtures |

## Recorded results

On macOS, the following targeted groups passed:

- 195 recovery, emergency, transcript and authority checks.
- 203 preparation, durability, gateway/worker startup and rollback checks.
- 99 import/history compatibility and admission checks (overlaps the first group).
- 487 desktop coordinator/service checks.
- Earlier validation of the desktop changes passed TypeScript checking,
  production compilation, bundle audit and strict local ad-hoc signing, plus
  the complete desktop suite: 5,142 passed and five skipped.

The expanded tests exposed a genuine regression in the initial streaming fix:
large structured tool output still hit the native transcript import value-count
budget. The added test failed before the correction and passed afterward.
Journal projections now have separate structural limits; native imports retain
their original default limits.

The repeat 256 MiB synthetic HTTP acknowledgement completed in 1.58 seconds.
The original stable implementation exceeded a 30-second client deadline for
that fixture. Timing is local evidence, not a latency promise for arbitrary
hardware or history.

An isolated native Electron window used the production client transport against
a real HTTP server with an injected recovery failure. Send showed the explicit
failure and preserved its draft. Refresh remained truthful, and server
selection stayed accessible. Provider execution was disabled for this failure
fixture. The healthy path was separately exercised with a real Codex request
and a provider-created synthetic alert; one UI acknowledgement cleared the
alert, and a repeated request did not create another receipt. The additional
server fix was installed on the designated idle test instance from commit
`fd4cb2ed`; its identity, token and all existing chat IDs/titles were preserved.
The native test app was then closed and reopened. The acknowledged state stayed
cleared, the earlier history was visible, and a contextual follow-up returned
the code supplied in the first turn. Disposable chat and client credentials
were removed after validation.

## Repeating automated checks

After integrating current main, the new batch dismissal path was also moved
onto the projected reader. Its 40 MiB regression measured over 80 MiB of Python
allocations before the correction and less than 8 MiB afterward. All 31 alert
tests passed, including batch boundary/retry cases. An isolated native
development app dismissed two synthetic alerts through the real authenticated
API with that large intervening record; both receipts persisted and refresh
kept the active banner cleared while retaining historical rows.

The integrated branch also passed 201 focused server checks, 907 desktop
checks, TypeScript and production compilation. The repeat large-state process
test preserved all original history and queue order, with chat readiness in
14.1 seconds and per-route p95 below 0.22 seconds. These timings supersede no
earlier observation and remain local measurements, not performance guarantees.

Use an isolated HOME, state/config directories and native temporary storage;
never inject recovery errors into a working user's state. From `server/`, use
the project's Python environment:

```sh
python -m unittest \
  tests.test_emergency_alerts tests.test_transcript_reader \
  tests.test_queue_steer tests.test_consumed_queue_recovery \
  tests.test_durable_team_mail_grants_isolated \
  tests.test_provider_chat_pairs_isolated

python -m unittest \
  tests.test_execution_preparation tests.test_execution_durability \
  tests.test_execution_startup_integration tests.test_execution_gateway_integration \
  tests.test_execution_recovery tests.test_execution_recovery_status \
  tests.test_update_recovery tests.test_activation_transaction \
  tests.test_installer_activation_recovery tests.test_installer_preparation

python -m unittest tests.test_transcript_reader \
  tests.test_large_transcript_import tests.test_provider_history_sync \
  tests.test_queue_steer.StartupQueueRecoveryAdmissionTests
```

From `electron/`:

```sh
pnpm exec vitest run src/main/coordinated-updates.test.ts src/main/service.test.ts
```

## Boundaries

- Do not interpret an accessible health endpoint as permission to admit chat
  work after restoration fails. Preserving saved work takes priority.
- Failure classification does not repair an unknown disk, state or provider
  failure. Repeated real failures still need their server logs.
- Real worker/gateway tests cover isolated processes. Several activation tests
  use native-service fixtures; they are not a public release/update journey.
- macOS testing cannot establish Linux systemd or Windows native restart
  behavior. No Linux-native claim is made by this test run.
- Only the designated local test server was updated. These changes are not a
  published desktop/server release.

## Large-state and busy-update stress pass — 2026-10-13

The previous small-chat acceptance was extended with actual isolated execution
worker/gateway processes and a native Electron client. Production server source
was `fd4cb2ed`; desktop source was `a5e1e768`. Temporary candidate directories
used fixture version labels, not published release packages.

Dataset:

- 1,000 saved chats, including 200 archived chats.
- Approximately 1.21 GB of history: 128,000 baseline events with mixed Unicode
  prompts, long replies and structured tool output, plus queue/recovery events.
- One 128 MiB image-like tool payload and a separate array of 260,001 values.
- 192 durable queued messages across 64 chats.
- 32 interrupted-run examples with the native registry's latest-event metadata.

| Scenario | Observed result |
| --- | --- |
| Start production worker and gateway with the populated state | Transport health in 10–11 seconds; chat recovery ready in 11–12 seconds across the completed runs. |
| Read concurrently while restoration is complete | 120 requests at concurrency 12, covering health, update status, chat list, detail and timeline index; no HTTP errors. |
| Read with 32 controlled runs active | Another 120 requests at concurrency 12; no errors. Per-route p95 was below 0.23 seconds in this run. |
| Request worker replacement while busy | Three authenticated public requests returned the explicit 32-active-run deferral. Direct activation also refused before stopping either component and retired its temporary transaction. |
| Replace gateway while busy | Production activation controller replaced the gateway in about one second, preserving the worker epoch and all 32 controlled runs. |
| Reopen the App while busy | The native App reconnected, displayed the saved chats/queues and retained a visible pending update with blocker counts. Cancelling that reservation through the UI left all 32 runs active. |
| Replace an idle worker | Production controller replaced it, retained the gateway and identity, and reached chat-ready state in about three seconds. Paused durable queues survived. |
| Candidate startup fails | Controller rejected the deliberately broken worker and restored the previous one; gateway and identity survived. A subsequent valid retry succeeded. |
| Check preservation after replacements, rollback and retry | All 1,000 original history prefixes matched their original hashes. All 192 queued IDs and their order survived. All 32 controlled live runs finished exactly once. |
| Recover interrupted runs with valid native metadata | The repeatable process test closed each of 32 interrupted runs once without replaying its accepted input. |

The first manually generated interrupted-run examples omitted the registry's
latest-event metadata and therefore were not valid interrupted-run acceptance.
The automated fixture was corrected to match the native persisted schema and
passed; the incomplete examples are not counted as recovery evidence.

The rollback run also confirmed a meaningful intermediate state: component
health was available before the reconstructed queues appeared. After
`chat_readiness.ready` became true, all 64 queued-chat entries were present.
Transport health or matching component versions alone must not establish
complete recovery.

### Repeatable opt-in process test

The new test generates approximately 1.2 GB and is skipped by default. Use the
server dependency environment and native temporary storage with enough free
space. Provider executables are explicitly disabled and no installed service
is addressed:

```sh
cd server
RUN_LARGE_STATE_UPDATE_TESTS=1 python -m unittest \
  tests.test_large_state_update_integration -v
```

It checks real startup/queue restoration, 184 authenticated reads, rejection of
new work under an activation hold, exact queue order, interrupted-run closure
and byte preservation. It prints bounded counts and timing statistics. The
busy replacement, rollback and native UI observations above were separate
manual isolated acceptance; they are not claimed as coverage of this one test.

### Additional boundaries and update policy

- The 32 active runs were deterministic workload fixtures inside the real
  application; the eight child processes were owned fixtures. They were not
  32 live model sessions, and do not prove provider-specific long-goal behavior.
- The native service-manager adapter managed only owned subprocesses. The real
  activation controller, process identity checks, maintenance controls,
  transaction journal, worker/gateway transports and recovery were exercised;
  launchd/systemd installation was not.
- The pending update receipt used for the UI case was explicitly seeded, with
  public download polling disabled. Rendering, reconnection and cancellation
  used the real native transport. That case does not prove package preparation
  or automatic idle-to-install scheduling.
- History was retained across worker replacement using explicitly paused queue
  fixtures. The ordinary idle updater still waits for queued work; this result
  is not permission to bypass its admission policy.
- Continuous active/queued work can keep an ordinary update pending indefinitely.
  The current policy allows new work while waiting; these tests do not implement
  a drain policy or authorize forced interruption. App installation must remain
  independent, and a pending server must remain visibly pending.
- The local development App cannot self-update. A signed old-app-to-new-app
  installation plus automatic server package installation under this same load
  remains release acceptance, as do Linux/Windows native-service behavior and
  low-memory-host behavior. No public feed or production trust setting changed.
