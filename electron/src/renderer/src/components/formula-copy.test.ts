import { afterEach, describe, expect, it } from 'vitest'
import { formulaSelectionText } from './formula-copy'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

function select(node: Node): Range {
  const range = document.createRange()
  range.selectNode(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

describe('formula copy', () => {
  afterEach(() => {
    document.body.replaceChildren()
    window.getSelection()?.removeAllRanges()
  })

  it('replaces the broken visual formula text with LaTeX delimiters', () => {
    const host = mount(`<div class="markdown"><p>Torque <span class="katex"><span class="katex-mathml"><annotation encoding="application/x-tex">\\tau_{t}^{\\mathrm{cmd}}</annotation></span><span class="katex-html">τ\ncmd\nt</span></span> holds.</p></div>`)
    const visual = host.querySelector('.katex-html')!
    expect(visual.textContent).toBe('τ\ncmd\nt')
    expect(formulaSelectionText(select(visual))).toBe('\\(\\tau_{t}^{\\mathrm{cmd}}\\)')
    const paragraph = document.createRange()
    paragraph.selectNodeContents(host.querySelector('p')!)
    expect(formulaSelectionText(paragraph)).toBe('Torque \\(\\tau_{t}^{\\mathrm{cmd}}\\) holds.')
  })

  it('uses display delimiters for a display formula', () => {
    const host = mount(`<div class="markdown"><span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">E = mc^2</annotation></span></span></div>`)
    expect(formulaSelectionText(select(host.querySelector('.katex-html') ?? host.querySelector('.katex')!))).toBe('\\(E = mc^2\\)')
  })

  it('leaves a selection without a formula unchanged', () => {
    const host = mount('<div class="markdown"><p>No math here.</p></div>')
    expect(formulaSelectionText(select(host.querySelector('p')!))).toBeNull()
  })
})
