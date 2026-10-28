import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { SideQuestionScope } from '@shared/side-questions'
import type { Session } from '@shared/types'
import { useLocale } from '../lib/i18n'
import { SideChatController } from '../lib/side-chat'
import { Inspector } from './Inspector'
import { InspectorFiles } from './InspectorFiles'
import './SideQuestionPanel.css'

export type InspectorWorkspaceTab = 'details' | 'files' | 'review'
export function InspectorWorkspace({ session, scope, controller, tab, onTabChange, onHide, review }: {
  session: Session | null; scope: SideQuestionScope; controller: SideChatController; tab: InspectorWorkspaceTab
  onTabChange: (tab: InspectorWorkspaceTab) => void; onHide: () => void; review?: ReactNode
}) {
  useLocale()
  const id = useId()
  const selectedTab = tab === 'review' && !review ? 'details' : tab
  const tabs: InspectorWorkspaceTab[] = review ? ['details', 'files', 'review'] : ['details', 'files']
  return <aside className="inspector inspector-workspace">
    <div className="inspector-drag-region" />
    <header className="inspector-workspace-header">
      <div className="inspector-workspace-tabs" role="tablist" aria-label={t('sideChat.panelViews')}>
        {tabs.map(value => <button type="button" role="tab" key={value} id={`${id}-${value}-tab`}
          aria-controls={`${id}-${value}-panel`} aria-selected={selectedTab === value} tabIndex={selectedTab === value ? 0 : -1}
          onClick={() => onTabChange(value)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = tabs.indexOf(value)
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)!
              : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
            onTabChange(next)
            document.getElementById(`${id}-${next}-tab`)?.focus()
          }}>{t(value === 'details' ? 'sideChat.details' : value === 'files' ? 'inspector.files' : 'sideChat.review')}</button>)}
      </div>
      <button type="button" className="icon-button" aria-label={t('sideChat.hide')} title={t('sideChat.hide')} onClick={onHide}><X size={15} /></button>
    </header>
    {selectedTab === 'details' && <div className="inspector-workspace-content" role="tabpanel" id={`${id}-details-panel`} aria-labelledby={`${id}-details-tab`}>
      <InspectorDetails scope={scope} sessionId={session?.id ?? ''} controller={controller} />
    </div>}
    {selectedTab === 'files' && <div className="inspector-workspace-content" role="tabpanel" id={`${id}-files-panel`} aria-labelledby={`${id}-files-tab`}>
      <InspectorFiles session={session} scope={scope} />
    </div>}
    {review && selectedTab === 'review' && <div className="inspector-workspace-content" role="tabpanel" id={`${id}-review-panel`} aria-labelledby={`${id}-review-tab`}>{review}</div>}
  </aside>
}

function InspectorDetails({ scope, sessionId, controller }: { scope: SideQuestionScope; sessionId: string; controller: SideChatController }) {
  const host = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const element = host.current?.querySelector<HTMLElement>('.inspector-scroll')
    if (!element) return
    element.scrollTop = controller.detailsScroll(scope, sessionId)
    return () => controller.saveDetailsScroll(scope, sessionId, element.scrollTop)
  }, [scope.profileId, scope.profileGeneration, sessionId, controller])
  return <div className="inspector-details-host" ref={host}><Inspector embedded /></div>
}
