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

const themedSource = `
import { Stack, Text, useHostTheme } from "cursor/canvas";
function Layer() {
  const theme = useHostTheme();
  return <div style={{ border: \`1px solid \${theme.stroke.tertiary}\`, background: theme.fill.tertiary }}><Text>Layer</Text></div>;
}
export default function App() { return <Stack><Layer /></Stack>; }
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

  it('renders React-style numeric dimensions with CSS units and neutral callout text', async () => {
    render(<WorkspaceCanvasViewer source={source} label="Styled Canvas" />)

    await screen.findByTitle('Styled Canvas')
    const documentSource = vi.mocked(window.agentsDock.workspace.createCanvasPreview).mock.calls[0]?.[0]
    expect(documentSource).toContain("value + 'px'")
    expect(documentSource).toContain("unitlessStyles.has(key)")
    expect(documentSource).toContain('.cv-callout { padding: 15px 17px; color: var(--cv-text);')
    expect(documentSource).toContain('--cv-bg: #f6f7f9; --cv-surface: #ffffff;')
  })

  it('provides the documented host theme token groups to canvas components', async () => {
    render(<WorkspaceCanvasViewer source={themedSource} label="Themed Canvas" />)

    await screen.findByTitle('Themed Canvas')
    const documentSource = vi.mocked(window.agentsDock.workspace.createCanvasPreview).mock.calls[0]?.[0]
    expect(documentSource).toContain("tertiary: 'var(--cv-stroke-tertiary)'")
    expect(documentSource).toContain("tertiary: 'var(--cv-fill-tertiary)'")
    expect(documentSource).toContain('tokens,')
    expect(documentSource).toContain("brand: 'cursor'")
  })

  it('reports malformed TSX instead of creating a runnable frame', () => {
    render(<WorkspaceCanvasViewer source={'export default () => <Card>'} label="Broken Canvas" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Canvas could not be compiled')
    expect(screen.queryByTitle('Broken Canvas')).not.toBeInTheDocument()
  })
})
