# History maintenance and chat admission

This development change separates opening a chat, admitting a turn, importing
provider history, and repairing old display metadata. None of these changes
truncate transcripts, compact provider context, or bypass source ownership proof.

| Failure | Change | Retained constraint |
| --- | --- | --- |
| Large rollouts disappear from discovery or repeatedly fail at 256 MiB | Validate a bounded metadata header, prefer the saved source path, and consume complete records in 16 MiB batches | Verify the consumed prefix digest and source identity before continuing |
| A native compaction embeds a large replacement history | Preserve the current streaming parser and extend a batch through its first complete record | Retain bounded proof text, source identity checks and ownership proof |
| Slow import preparation monopolizes the chat lifecycle lock | Prepare outside the lock; acquire it only for a validated commit | Reject changed provider binding, cursor, source, timeline, busy state, deletion or competing admission |
| Opening a chat waits behind a global repair scan | Serve the existing projection immediately and schedule bounded background maintenance | Imported batches still require their own native proof before publication |
| Old display repair starves an otherwise valid import backlog | Finish forward batches before preparing legacy display repair | A deferred repair remains explicitly deferred, not treated as successful |
| Unrelated old text exhausts a forward import proof's memory budget | Retain native text keys relevant to the candidate batch | Scan the entire journal and retain ownership and ambiguity evidence; keep the capacity limit |
| Restart recovery scans every event log before any chat can send | Persist queue reduction checkpoints and recover small/checkpointed chats first | Each chat remains fenced until its own queue and migration evidence are recovered |
| A lost send response leaves acceptance uncertain | Persist a request identity in the desktop cache and server receipt journal; return pending acceptance after a bounded wait | Retry the same identity; conflicting bodies are rejected and ambiguous crash recovery fails closed |

Background metadata proofs can change the presentation of existing events.
An opt-in WebSocket revision announces this without consuming an event sequence
number. The initial subscription revision covers the HTTP/subscription race;
the desktop deduplicates revisions and performs a bounded semantic refresh.
Older clients retain the existing stream handshake. The refresh can replace the
cached tail; older messages remain available through pagination.

## Checkpoints and retries

Queue checkpoints contain the pending reducer state, source device/inode,
complete-line offset, and a small boundary digest. They are accelerators for
server-owned append-only journals. Replacement, truncation, invalid metadata or
a changed boundary falls back to replay. Migration evidence still requires its
full scan. Arbitrary in-place rewriting of an already checkpointed journal
prefix is outside this append-only contract; discard its checkpoint after such
an administrative rewrite.

Unchanged provider cursors skip import parsing. Prefix verification is retained
when a source grows, so this is not constant-time ingestion. Preparation and
legacy proof remain bounded background work rather than admission dependencies.
First-time batched backfill captures the preexisting timeline boundary, including
previously imported rows, and consumes those credits only once. New batches
cannot treat their own newly appended rows as earlier ownership evidence.
Deterministic maintenance failures persist across reconnect/restart; transient
proof failures have a retry delay. Native legacy-proof capacity exhaustion is a
deterministic failure. Explicit `POST /api/sessions/{id}/history/maintenance`
clears that chat's backoff and schedules a retry, preserving all proof and busy
guards. Existing session responses expose `history_maintenance` status/reason.

The desktop stores the pending request fingerprint and ID before sending. A
202 pending response keeps the draft and identity. Retrying an unchanged message
checks the same admission operation; there is no automatic transport retry.
Accepted server receipts survive a lost response and restart. Crash recovery
searches only the bounded journal suffix after the pending receipt, and refuses
an ambiguous replay. Receipt files are retained; automatic expiry is not part
of this change. Use the paired client/server candidate for this guarantee.

## Integration and validation

This is the history-responsiveness change from PR #87, integrated onto main.
The release-branch version bumps are deliberately excluded: source version
fields stay on main's development values until a separately prepared release.
Unrelated release-only changes are not part of this port.

The integration preserves main's negotiated event-stream liveness, latest-first
bounded refresh, health recovery reporting and virtual timeline recovery.
Projection notices and liveness control packets coexist without acknowledging
an event sequence. Repeated projection notices coalesce while a refresh is in
flight; retired subscriptions cannot refresh a different chat.

Focused history, import, source-proof, queue recovery and transport regression
suites cover the changed behavior. Integration-specific checks exercise both
WebSocket control protocols together and bounded desktop refresh after a
projection change. Native validation and its limits are recorded in the public
development log; local timings are not a performance guarantee.

Use the paired app and server to get durable explicit-send retry behavior.
This source change does not publish a signed update or install a production
server. Cold timeline indexing still scales with transcript size. Provider
content parity and release/upgrade acceptance remain separate requirements.
