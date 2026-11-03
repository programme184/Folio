import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCanvasViewer, compileCanvas } from './WorkspaceCanvasViewer'

const source = `
import { Card, CardBody, H1, Text } from "cursor/canvas";
function App() {
  return <Card><CardBody><H1>Native preview</H1><Text>Rendered inside AgentsDock</Text></CardBody></Card>;
}
export default App;
`

describe('WorkspaceCanvasViewer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { workspace: {
        createCanvasPreview: vi.fn().mockResolvedValue('agentsdock-canvas://preview/00000000-0000-4000-8000-000000000000'),
        releaseCanvasPreview: vi.fn().mockResolvedValue(undefined)
      } }
    })
  })

  it('compiles a cursor canvas without loading the Cursor application', () => {
    const result = compileCanvas(source)

    expect(result.error).toBeNull()
    expect(result.code).toContain('require("cursor/canvas")')
    expect(result.code).toContain('CanvasRuntime.createElement')
    expect(result.code).not.toContain('cursor://')
  })

  it('places the compiled canvas in a script-only sandbox served by the native preview protocol', async () => {
    render(<WorkspaceCanvasViewer source={source} label="Architecture Canvas" />)

    const frame = await screen.findByTitle('Architecture Canvas')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame).toHaveAttribute('src', 'agentsdock-canvas://preview/00000000-0000-4000-8000-000000000000')
    expect(window.agentsDock.workspace.createCanvasPreview).toHaveBeenCalledWith(expect.stringContaining("default-src 'none'"))
    expect(window.agentsDock.workspace.createCanvasPreview).toHaveBeenCalledWith(expect.stringContaining('Native preview'))
  })

  it('reports malformed TSX instead of creating a runnable frame', () => {
    render(<WorkspaceCanvasViewer source={'export default () => <Card>'} label="Broken Canvas" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Canvas could not be compiled')
    expect(screen.queryByTitle('Broken Canvas')).not.toBeInTheDocument()
  })
})
