import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { FolderOpen, LoaderCircle, Search } from 'lucide-react'
import { t } from '@shared/i18n'
import type { SideQuestionScope } from '@shared/side-questions'
import type { Session } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { usePaperAsk } from './paper-ask'
import './PaperShelf.css'

const PaperDocument = lazy(() => import('./PaperDocument').then(module => ({ default: module.PaperDocument })))

const PAPER_SPLIT_KEY = 'agentsdock:paper-reading-split'
const DEFAULT_CHAT_PERCENT = 42
const MIN_CHAT_PERCENT = 26
const MAX_CHAT_PERCENT = 68

interface PaperListFile {
  path: string
  name: string
  bytes: number
}

interface PaperList {
  root: string
  files: PaperListFile[]
  error?: string
}

export function PaperShelf({ chat, session, scope, onAsk }: {
  chat: ReactNode
  session: Session | null
  scope: SideQuestionScope | null
  onAsk: (draft: string) => void
}) {
  useLocale()
  const { canAsk, askPassage } = usePaperAsk(session, scope)
  const [revision, setRevision] = useState(0)
  const [listing, setListing] = useState(true)
  const [shelf, setShelf] = useState<PaperList | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const generation = useRef(0)
  const shellRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<number | null>(null)
  const [chatPercent, setChatPercent] = useState(readPaperSplit)
  const [splitDragging, setSplitDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const openFile = useCallback(async (path: string) => {
    const papers = window.agentsDock.papers
    if (!papers) return
    const current = ++generation.current
    setActive(path)
    setOpening(true)
    setDocumentError(null)
    try {
      const file = await papers.read(path)
      if (generation.current !== current) return
      setBytes(new Uint8Array(file.data))
    } catch (error) {
      if (generation.current !== current) return
      setBytes(null)
      setDocumentError(paperShelfMessage(error instanceof Error ? error.message : ''))
    } finally {
      if (generation.current === current) setOpening(false)
    }
  }, [])
  useEffect(() => {
    const papers = window.agentsDock.papers
    if (!papers) {
      setListing(false)
      setListError(t('papers.loadFailed'))
      return
    }
    let cancelled = false
    setListing(true)
    setListError(null)
    setActive(null)
    setBytes(null)
    void papers.list().then(result => {
      if (cancelled) return
      setShelf(result)
      setListing(false)
      if (result.error) setListError(paperShelfMessage(result.error))
    }).catch(error => {
      if (cancelled) return
      setListing(false)
      setListError(paperShelfMessage(error instanceof Error ? error.message : ''))
    })
    return () => { cancelled = true }
  }, [revision])
  useEffect(() => {
    if (active || !shelf || shelf.error || !shelf.files[0]) return
    void openFile(shelf.files[0].path)
  }, [active, openFile, shelf])
  const choose = () => {
    void window.agentsDock.papers?.chooseRoot().then(result => {
      if (result?.changed) setRevision(value => value + 1)
    }).catch(error => setListError(paperShelfMessage(error instanceof Error ? error.message : '')))
  }
  const folderError = shelf?.error ? paperShelfMessage(shelf.error) : listError
  const matches = paperFileMatches(shelf, query)
  const resizeTo = (clientX: number) => {
    const shell = shellRef.current
    if (!shell) return
    const bounds = shell.getBoundingClientRect()
    if (bounds.width <= 0) return
    setChatPercent(clampPaperSplit((clientX - bounds.left) / bounds.width * 100))
  }
  const finishSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current !== event.pointerId) return
    splitDragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setSplitDragging(false)
    setChatPercent(current => {
      writePaperSplit(current)
      return current
    })
  }
  const openMatch = (path: string) => {
    setSearchOpen(false)
    setQuery('')
    void openFile(path)
  }
  return <div
    ref={shellRef}
    className={`papers-shell${splitDragging ? ' papers-split-dragging' : ''}`}
    style={{ '--papers-chat-width': `${chatPercent}%` } as CSSProperties}
  >
    <div className="papers-chat">{chat}</div>
    <div
      className="papers-split-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_CHAT_PERCENT}
      aria-valuemax={MAX_CHAT_PERCENT}
      aria-valuenow={Math.round(chatPercent)}
      aria-label={t('papers.resize')}
      tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false) return
        event.preventDefault()
        splitDragRef.current = event.pointerId
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setSplitDragging(true)
      }}
      onPointerMove={event => {
        if (splitDragRef.current !== event.pointerId) return
        resizeTo(event.clientX)
      }}
      onPointerUp={finishSplit}
      onPointerCancel={finishSplit}
      onLostPointerCapture={finishSplit}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 8 : 2
        setChatPercent(current => {
          const next = event.key === 'Home'
            ? MIN_CHAT_PERCENT
            : event.key === 'End'
              ? MAX_CHAT_PERCENT
              : clampPaperSplit(current + (event.key === 'ArrowRight' ? step : -step))
          writePaperSplit(next)
          return next
        })
      }}
    ><span aria-hidden="true" /></div>
    <section className="paper-shelf" aria-label={t('papers.folder')}>
      <header className="paper-shelf-heading">
        <label className="paper-file-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            placeholder={t('editor.searchWorkspaceOrPasteAFullPath')}
            aria-label={t('editor.searchWorkspaceOrPasteAFullPath')}
            onChange={event => {
              setQuery(event.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setSearchOpen(false)
                setQuery('')
              }
              if (event.key === 'Enter' && matches[0]) openMatch(matches[0].path)
            }}
          />
        </label>
        <button type="button" title={shelf?.root} onClick={choose}><FolderOpen size={14} />{t('papers.changeFolder')}</button>
      </header>
      <div className="paper-shelf-body">
        {searchOpen && <div className="paper-shelf-files" role="listbox" aria-label={t('papers.folder')}>
          {listing && <p role="status"><LoaderCircle className="spin" size={14} />{t('papers.loading')}</p>}
          {folderError && <p role="status">{folderError}</p>}
          {shelf && !shelf.error && <p className="paper-shelf-count">{t('papers.files', { count: matches.length })}</p>}
          {matches.map(file => <button
            type="button"
            role="option"
            aria-selected={active === file.path}
            key={file.path}
            aria-current={active === file.path ? 'true' : undefined}
            title={file.path}
            onClick={() => openMatch(file.path)}
          >
            <span>{file.name}</span>
            {file.path !== file.name && <small>{file.path}</small>}
          </button>)}
          {shelf && !shelf.error && matches.length === 0 && <p>{t('papers.empty')}</p>}
        </div>}
        <div className="paper-shelf-reader" onMouseDown={() => { if (searchOpen) { setSearchOpen(false); setQuery('') } }}>
          {opening && <p className="paper-document-status" role="status"><LoaderCircle className="spin" size={14} />{t('papers.loading')}</p>}
          {documentError && <p className="paper-document-status" role="alert">{documentError}</p>}
          {!opening && !bytes && !documentError && <p className="paper-document-status">{t('papers.choose')}</p>}
          {bytes && <Suspense fallback={<p className="paper-document-status" role="status">{t('papers.loading')}</p>}>
            <PaperDocument data={bytes} canAsk={canAsk} askPassage={askPassage} onAsk={onAsk} />
          </Suspense>}
        </div>
      </div>
    </section>
  </div>
}

function clampPaperSplit(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_CHAT_PERCENT
  return Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, percent))
}

function readPaperSplit(): number {
  try {
    return clampPaperSplit(Number(window.localStorage.getItem(PAPER_SPLIT_KEY)))
  } catch {
    return DEFAULT_CHAT_PERCENT
  }
}

function writePaperSplit(percent: number): void {
  try { window.localStorage.setItem(PAPER_SPLIT_KEY, String(Math.round(percent))) } catch { /* preference is best effort */ }
}

function paperFileMatches(shelf: PaperList | null, query: string): PaperListFile[] {
  if (!shelf || shelf.error) return []
  const needle = query.trim()
  if (!needle) return shelf.files
  const relative = needle.startsWith(shelf.root)
    ? needle.slice(shelf.root.length).replace(/^[/\\]+/, '')
    : needle
  const exact = shelf.files.find(file => file.path === relative || file.path === needle || `${shelf.root}/${file.path}` === needle)
  if (exact && /[/\\]/.test(needle)) return [exact]
  const folded = needle.toLocaleLowerCase()
  return shelf.files.filter(file => file.name.toLocaleLowerCase().includes(folded) || file.path.toLocaleLowerCase().includes(folded))
}

function paperShelfMessage(code: string): string {
  if (code.includes('papers_root_missing')) return t('papers.missing')
  if (code.includes('papers_not_a_directory')) return t('papers.notDirectory')
  if (code.includes('papers_file_too_large')) return t('papers.tooLarge')
  return t('papers.loadFailed')
}
