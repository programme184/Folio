import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const timeline = await readFile(resolve('src/components/Timeline.tsx'), 'utf8')

test('empty cached chats with known remote history stay in a loading state until rows arrive', () => {
  assert.match(timeline, /snapshot\?\.session\.latest_event_seq/)
  assert.match(timeline, /selectedSession\?\.latest_event_seq/)
  assert.match(timeline, /shouldShowInitialTimelineLoading\(\{ rowCount: rows\.length, loading, hasKnownHistory, syncStatus: selectedSyncStatus \}\)/)
})
