import { Bot, Code2, MousePointer2, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import type { Backend } from '@shared/types'

const BACKEND_MARK_SRC: Record<Backend, string> = {
  claude: './backend-claude.png',
  codex: './backend-codex.png',
  cursor: './backend-cursor.png',
  opencode: '',
  gemini: './backend-gemini.svg'
}

export function BackendMark({ backend, size = 18 }: { backend: Backend; size?: number }) {
  const asset = BACKEND_MARK_SRC[backend]
  const src = asset && (window.agentsDock?.sharedChat ? `/interactive-chat/assets/${asset.slice(2)}` : asset)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return (
    <span className={`backend-mark backend-${backend}`} style={{ width: size, height: size }} aria-hidden="true">
      {src && failedSrc !== src ? <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setFailedSrc(src)}
      /> : <span className="backend-fallback">
        {backend === 'opencode' ? <Code2 size={size - 3} /> : backend === 'codex' ? <TerminalSquare size={size - 3} /> : backend === 'cursor' ? <MousePointer2 size={size - 3} /> : <Bot size={size - 3} />}
      </span>}
    </span>
  )
}
