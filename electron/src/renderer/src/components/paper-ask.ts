import { useCallback } from 'react'
import { getLocale, t } from '@shared/i18n'
import { paperPassageQuestion } from '@shared/paper-passages'
import { sideQuestionsAvailable, type SideQuestionScope } from '@shared/side-questions'
import type { Health, Session } from '@shared/types'
import { useAppStore } from '../store/app-store'
import type { PaperAsk } from './PaperSelection'

/**
 * Side questions need a real provider conversation to fork/resume. A newly
 * created AgentsDock chat has an app session id, but its native Codex thread
 * is not created until the first main turn is admitted.
 */
export function hasMainProviderConversation(session: Session | null): boolean {
  if (!session) return false
  if (session.backend === 'codex') {
    // Older persisted sessions may retain the native thread only in the
    // provider-agnostic session_id field.
    return Boolean(session.codex_thread_id?.trim() || session.session_id?.trim())
  }
  if (session.backend === 'claude') {
    return Boolean(session.claude_session_id?.trim() || session.session_id?.trim())
  }
  return false
}

export function paperSideChatAvailable(health: Health | null | undefined, session: Session | null): boolean {
  return Boolean(session && hasMainProviderConversation(session) && sideQuestionsAvailable(health, session.backend))
}

export function usePaperAsk(session: Session | null, scope: SideQuestionScope | null): {
  canAsk: boolean
  askPassage: PaperAsk
} {
  const health = useAppStore(state => state.health)
  const connected = useAppStore(state => state.connected)
  const switching = useAppStore(state => state.switchingProfileId)
  const canSideAsk = Boolean(
    session && scope?.profileId && connected && !switching && !window.agentsDock.sharedChat
    && paperSideChatAvailable(health, session)
  )
  const canAsk = canSideAsk || Boolean(
    session && connected && !switching && !session.archived && !window.agentsDock.sharedChat
  )
  const askPassage = useCallback<PaperAsk>(async (input, signal) => {
    if (!session) throw new Error('side_question_unsupported')
    const question = paperPassageQuestion({
      kind: input.kind,
      answerLanguage: getLocale() === 'zh-CN' ? 'zh-CN' : 'en',
      translateTo: input.translateTo,
      passage: input.passage
    })
    if (!canSideAsk || !scope?.profileId || !window.agentsDock.sideQuestions) {
      const sent = await useAppStore.getState().sendPromptForSession(session.id, question, false, { consumeComposer: false })
      if (signal.aborted) throw new Error('side_question_cancelled')
      if (!sent) throw new Error('side_question_unsupported')
      return t('papers.sentToChat')
    }
    const requestId = crypto.randomUUID()
    const sideChatId = `paper${crypto.randomUUID().replaceAll('-', '')}`
    const cancel = () => { void window.agentsDock.sideQuestions?.cancel(scope, session.id, requestId).catch(() => undefined) }
    if (signal.aborted) throw new Error('side_question_cancelled')
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const answer = await window.agentsDock.sideQuestions.ask(scope, session.id, {
        request_id: requestId,
        question,
        side_chat_id: sideChatId
      })
      if (signal.aborted) throw new Error('side_question_cancelled')
      if (answer.session_id !== session.id || answer.request_id !== requestId) throw new Error('side_question_invalid_response')
      return answer.answer
    } finally {
      signal.removeEventListener('abort', cancel)
      void window.agentsDock.sideQuestions.close?.(scope, session.id, sideChatId).catch(() => undefined)
    }
  }, [canSideAsk, scope, session])
  return { canAsk, askPassage }
}
