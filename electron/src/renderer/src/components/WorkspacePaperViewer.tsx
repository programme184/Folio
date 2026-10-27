import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { paperWorkspaceMarkKey } from '@shared/paper-passages'
import { sideQuestionsAvailable } from '@shared/side-questions'
import type { Session, WorkspaceProfileScope } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { usePaperAsk } from './paper-ask'
import './PaperShelf.css'

const PaperDocument = lazy(() => import('./PaperDocument').then(module => ({ default: module.PaperDocument })))

export function WorkspacePaperViewer({ source, label, load, session, scope, onAsk }: {
  source: string
  label: string
  load: () => Promise<Uint8Array>
  session: Session
  scope: WorkspaceProfileScope | null
  onAsk?: (draft: string) => void
}) {
  useLocale()
  const [data, setData] = useState<Uint8Array | null>(null)
  const [failed, setFailed] = useState(false)
  const loadRef = useRef(load)
  loadRef.current = load
  const sideScope = scope
    ? { profileId: scope.profileId, profileGeneration: scope.profileGeneration, serverIdentity: scope.serverIdentity }
    : null
  const { canAsk, askPassage } = usePaperAsk(session, sideScope)
  useEffect(() => {
    let cancelled = false
    setData(null)
    setFailed(false)
    void loadRef.current().then(bytes => {
      if (!cancelled) setData(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [source])
  const askInChat = (quote: string) => {
    if (onAsk && sideQuestionsAvailable(useAppStore.getState().health, session.backend)) {
      onAsk(quote)
      return
    }
    useAppStore.getState().setDraftForSession(session.id, quote)
  }
  return <div className="workspace-editor-pdf-viewer" role="region" aria-label={t('editor.pdfPreviewOf', { name: label })}>
    {failed && <div className="workspace-editor-loading">{t('papers.loadFailed')}</div>}
    {!failed && data && <Suspense fallback={<div className="workspace-editor-loading">{t('papers.loading')}</div>}>
      <PaperDocument
        data={data}
        documentKey={paperWorkspaceMarkKey(scope?.profileId ?? 'local', session.id, source)}
        canAsk={canAsk}
        askPassage={askPassage}
        onAsk={askInChat}
      />
    </Suspense>}
    {!failed && !data && <div className="workspace-editor-loading">{t('papers.loading')}</div>}
  </div>
}
