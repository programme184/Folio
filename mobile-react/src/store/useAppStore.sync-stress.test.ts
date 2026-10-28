import assert from 'node:assert/strict'
import { AppState as NativeAppState } from 'react-native'
import { SNAPSHOT_CACHE_VERSION } from '../lib/history'
import { IN_MEMORY_SNAPSHOT_LIMIT, LIVE_TIMELINE_EVENT_LIMIT } from '../lib/timeline-memory'
import type { Event, Session, TimelinePage } from '../types'
import { client, useAppStore } from './useAppStore'

const appState = NativeAppState as typeof NativeAppState & { __emitAppState(state: string): void }
const sessions: Session[] = Array.from({ length: 8 }, (_, index) => ({
  id: `stress-${index}`, title: `Stress ${index}`, backend: index % 2 ? 'claude' : 'codex',
  latest_event_seq: 100_000, last_read_agent_event_seq: 100_000,
}))
const boundaries = new Map(sessions.map(session => [session.id, 100_000]))
const event = (id: string, seq: number): Event => ({
  id: `${id}-${seq}`, session_id: id, seq, type: 'assistant_text',
  text: `Event ${seq}. ${'Synthetic response. '.repeat(8)}`, ts: '2026-10-15T00:00:00Z',
})
const page = (id: string): TimelinePage => {
  const latest = boundaries.get(id)!
  return {
    session: sessions.find(session => session.id === id)!,
    events: Array.from({ length: 192 }, (_, index) => event(id, latest - 191 + index)),
    queued_turns: [], has_more: true, before: latest - 191, next_before: latest - 191,
    latest_seq: latest, total: latest, semantic_paging: true,
  }
}
const original = { page: client.sessionPage, stream: client.stream, files: client.files, read: client.markRead }
const leases: Array<{ id: string; after: number; receive: Parameters<typeof client.stream>[2]; state: Parameters<typeof client.stream>[3]; stopped: boolean }> = []
const requests: Array<{ id: string; options: Parameters<typeof client.sessionPage>[1] }> = []
let delayed: { id: string; result: Promise<TimelinePage>; started: () => void } | null = null
let failNext = false
let publishedEvents = 0
const startedAt = performance.now()
client.configure('http://127.0.0.1:1', '')
client.markValidated()
client.sessionPage = async (id, options) => {
  requests.push({ id, options })
  if (failNext) { failNext = false; throw new Error('synthetic transient failure') }
  if (delayed?.id === id) { delayed.started(); return delayed.result }
  return page(id)
}
client.stream = (id, after, receive, state) => {
  const lease = { id, after, receive, state, stopped: false }
  leases.push(lease)
  state(true)
  return () => { lease.stopped = true }
}
client.files = async () => ({ files: [], total: 0, offset: 0, limit: 60, has_more: false })
client.markRead = async id => sessions.find(session => session.id === id)!

function assertBounded(id: string): void {
  const state = useAppStore.getState()
  const snapshot = state.snapshots[id]
  assert.ok(snapshot.events.length <= LIVE_TIMELINE_EVENT_LIMIT)
  assert.ok(Object.keys(state.snapshots).length <= IN_MEMORY_SNAPSHOT_LIMIT)
  assert.equal(new Set(snapshot.events.map(value => value.id)).size, snapshot.events.length)
  assert.ok(snapshot.events.every((value, index, values) => value.session_id === id && (!index || value.seq > values[index - 1].seq)))
  assert.equal(snapshot.latestSeq, boundaries.get(id))
  assert.equal(leases.filter(lease => !lease.stopped).length, 1)
}

try {
  appState.__emitAppState('active')
  useAppStore.setState({ initialized: true, activeProfileId: 'uninitialized', profileGeneration: 0,
    serverConfigured: true, connected: true, connecting: false, workspaceAdopting: false,
    health: { ok: true, server_identity: 'uninitialized', api_contract_version: 9 }, sessions,
    snapshots: {}, selectedSessionId: null, liveConnected: false })

  for (let cycle = 0; cycle < 40; cycle += 1) {
    const id = sessions[cycle % sessions.length].id
    await useAppStore.getState().selectSession(id)
    const lease = leases.at(-1)!
    assert.equal(lease.after, boundaries.get(id), 'a reopened chat must start at its authoritative boundary')
    assert.equal(useAppStore.getState().snapshots[id].cacheVersion, SNAPSHOT_CACHE_VERSION)
    for (let offset = 1; offset <= 900; offset += 1) {
      const next = event(id, lease.after + offset)
      lease.receive(next)
      if (offset % 30 === 0) lease.receive(next)
      publishedEvents += 1
    }
    boundaries.set(id, lease.after + 900)
    assertBounded(id)
    assert.equal(useAppStore.getState().snapshots[id].events.length, LIVE_TIMELINE_EVENT_LIMIT)

    if (cycle % 5 === 0) {
      const visible = useAppStore.getState().snapshots[id]
      failNext = true
      await useAppStore.getState().syncSelectedSession('manual')
      assert.equal(useAppStore.getState().snapshots[id], visible)
      assert.equal(leases.filter(value => !value.stopped).length, 0)
      await useAppStore.getState().syncSelectedSession('manual')
    }

    let resolvePage!: (value: TimelinePage) => void
    let notifyStarted!: () => void
    const requestStarted = new Promise<void>(resolve => { notifyStarted = resolve })
    delayed = { id, result: new Promise(resolve => { resolvePage = resolve }), started: notifyStarted }
    const beforeCalls = requests.length
    const pending = useAppStore.getState().syncSelectedSession('manual')
    await requestStarted
    const duplicate = useAppStore.getState().syncSelectedSession('manual')
    assert.equal(requests.length, beforeCalls + 1, 'repeated retry taps share the in-flight read')
    const otherId = sessions[(cycle + 1) % sessions.length].id
    await useAppStore.getState().selectSession(otherId)
    const visibleOther = useAppStore.getState().snapshots[otherId]
    resolvePage(page(id))
    await pending
    await duplicate
    delayed = null
    lease.receive(event(id, boundaries.get(id)! + 1))
    lease.state(true)
    assert.equal(useAppStore.getState().selectedSessionId, otherId)
    assert.equal(useAppStore.getState().snapshots[otherId], visibleOther, 'late reads and retired streams cannot repaint the next chat')
    assertBounded(otherId)

    if (cycle % 4 === 0) {
      appState.__emitAppState('background')
      const count = requests.length
      await useAppStore.getState().syncSelectedSession('foreground')
      assert.equal(requests.length, count)
      appState.__emitAppState('active')
      await useAppStore.getState().syncSelectedSession('foreground')
      assertBounded(otherId)
    }
  }
  assert.ok(requests.every(request => request.options?.tail === true && request.options?.after === undefined && request.options?.limit === 48))
  console.log(`sync stress passed: 40 cycles, ${publishedEvents} events plus duplicates, ${requests.length} bounded reads, ${Math.round(performance.now() - startedAt)}ms`)
} finally {
  appState.__emitAppState('background')
  await useAppStore.getState().selectSession(sessions[0].id)
  client.sessionPage = original.page
  client.stream = original.stream
  client.files = original.files
  client.markRead = original.read
  client.dispose()
}
