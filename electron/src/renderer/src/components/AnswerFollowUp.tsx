import { useEffect, useState } from 'react'
import { Copy, Reply } from 'lucide-react'
import { t } from '@shared/i18n'
import { paperQuotePreview } from '@shared/paper-passages'
import { useLocale } from '../lib/i18n'
import { useAppStore } from '../store/app-store'
import { formulaSelectionText } from './formula-copy'

interface FollowUpBar {
  text: string
  left: number
  top: number
}

function answerSelection(): FollowUpBar | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const node = selection.anchorNode
  const element = node instanceof Element ? node : node?.parentElement ?? null
  const markdown = element?.closest('.markdown')
  if (!element || !markdown?.closest('.message-row.assistant')) return null
  if (element.closest('.answer-followup')) return null
  let range: Range | null = null
  try { range = selection.getRangeAt(0) } catch { range = null }
  if (!range) return null
  const formula = formulaSelectionText(range)
  const text = (formula ?? selection.toString().replace(/\s+/g, ' ')).trim()
  if (!text) return null
  const rect = typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 }
  const host = element.getBoundingClientRect()
  const placed = rect.width > 0 || rect.height > 0
  return {
    text,
    left: placed ? rect.left + rect.width / 2 : host.left + 24,
    top: placed ? rect.top : host.top
  }
}

export function AnswerFollowUp() {
  useLocale()
  const [bar, setBar] = useState<FollowUpBar | null>(null)
  useEffect(() => {
    const update = () => setBar(answerSelection())
    update()
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])
  if (!bar) return null
  const quote = paperQuotePreview(bar.text)
  const copy = () => { void window.agentsDock.native.writeClipboard(bar.text) }
  const followUp = () => {
    const sessionId = useAppStore.getState().selectedSessionId
    if (!sessionId) return
    const current = useAppStore.getState().drafts[sessionId] ?? ''
    const next = `${current.trimEnd()}${current.trim() ? '\n\n' : ''}> ${quote}\n\n`
    useAppStore.getState().setDraftForSession(sessionId, next)
    window.dispatchEvent(new CustomEvent('agentsdock:focus-composer', { detail: { sessionId } }))
    window.getSelection()?.removeAllRanges()
    setBar(null)
  }
  return (
    <div className="answer-followup" style={{ left: bar.left, top: bar.top }} role="toolbar" aria-label={t('answers.followUp')}>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={copy}><Copy size={14} />{t('papers.copy')}</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={followUp}><Reply size={14} />{t('answers.followUp')}</button>
    </div>
  )
}
