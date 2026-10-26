import { useCallback } from 'react'
import { getLocale, t } from '@shared/i18n'
import { paperPassageQuestion } from '@shared/paper-passages'
import { sideQuestionsAvailable, type SideQuestionScope } from '@shared/side-questions'
import type { Session } from '@shared/types'
import { useAppStore } from '../store/app-store'
import type { PaperAsk } from './PaperSelection'

export function usePaperAsk(session: Session | null, scope: SideQuestionScope | null): {
  canAsk: boolean
  askPassage: PaperAsk
} {
  const health = useAppStore(state => state.health)
  const connected = useAppStore(state => state.connected)
  const switching = useAppStore(state => state.switchingProfileId)
  const canSideAsk = Boolean(
    session && scope?.profileId && connected && !switching && !window.agentsDock.sharedChat
    && sideQuestionsAvailable(health, session.backend)
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
