import { createElement, useEffect, useLayoutEffect, useRef } from 'react'

/** Doubao copies every formula, including display math, inside \( \). */
const COPY_DELIMITERS = ['\\(', '\\)'] as const

let listeners = 0

/** The only selectable text inside a rendered formula. System copy reads the selection itself. */
export function FormulaSource() {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const source = ref.current
    const katex = source?.parentElement
    if (!source || !katex) return
    const tex = katex.querySelector('annotation')?.textContent?.trim() ?? ''
    if (!tex) {
      source.textContent = ''
      return
    }
    source.textContent = `${COPY_DELIMITERS[0]}${tex}${COPY_DELIMITERS[1]}`
    source.classList.toggle('formula-tex-display', Boolean(katex.closest('.katex-display')))
  })
  return createElement('span', { ref, className: 'formula-tex', 'aria-hidden': true })
}

/** Keep one document listener while any rendered answer is on screen. */
export function useFormulaCopy(): void {
  useEffect(() => {
    listeners += 1
    if (listeners === 1) document.addEventListener('copy', onFormulaCopy)
    return () => {
      listeners -= 1
      if (listeners === 0) document.removeEventListener('copy', onFormulaCopy)
    }
  }, [])
}

function onFormulaCopy(event: ClipboardEvent): void {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !event.clipboardData) return
  const text = formulaSelectionText(selection.getRangeAt(0))
  if (!text) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', text)
  event.clipboardData.setData('text/html', `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`)
}

/**
 * Plain text for a selection in rendered Markdown.
 * Formulas become LaTeX inside `\(...\)` instead of the
 * broken KaTeX span text. Returns null when the selection has no formula,
 * so ordinary prose copy is left untouched.
 */
export function formulaSelectionText(range: Range | null | undefined): string | null {
  try {
    if (!range || typeof range.cloneRange !== 'function') return null
    if (!rangeHasFormula(range)) return null
    const expanded = range.cloneRange()
    const start = formulaBoundary(expanded.startContainer)
    const end = formulaBoundary(expanded.endContainer)
    if (start) expanded.setStartBefore(start)
    if (end) expanded.setEndAfter(end)
    const root = expanded.commonAncestorContainer
    if (!root) return null
    const text = serialize(root, expanded).replace(/\n{3,}/g, '\n\n').trim()
    return text || null
  } catch {
    return null
  }
}

function rangeHasFormula(range: Range): boolean {
  if (formulaBoundary(range.startContainer) || formulaBoundary(range.endContainer)) return true
  const root = range.commonAncestorContainer
  const element = root instanceof Element ? root : root.parentElement
  if (!element || typeof range.intersectsNode !== 'function' || typeof element.querySelectorAll !== 'function') return false
  for (const katex of element.querySelectorAll('.katex')) {
    if (!katex.closest('.markdown')) continue
    try {
      if (range.intersectsNode(katex)) return true
    } catch {
      // The node is not in this document.
    }
  }
  return false
}

function formulaBoundary(node: Node | null): Element | null {
  const element = node instanceof Element ? node : node?.parentElement
  const katex = element?.closest('.katex')
  if (!katex?.closest('.markdown')) return null
  return katex.closest('.katex-display') ?? katex
}

function serialize(node: Node, range: Range): string {
  if (node instanceof Text) return sliceText(node, range)
  if (!(node instanceof Element)) {
    return [...node.childNodes].map(child => serialize(child, range)).join('')
  }
  if (!intersects(range, node)) return ''
  if (node.classList.contains('katex-display')) return delimit(node.querySelector('.katex')) ?? ''
  if (node.classList.contains('katex')) return delimit(node) ?? ''
  if (node.classList.contains('katex-html') || node.classList.contains('katex-mathml')) return ''
  if (node.tagName === 'BR') return '\n'
  const inner = [...node.childNodes].map(child => serialize(child, range)).join('')
  if (!isBlock(node)) return inner
  return inner.endsWith('\n') ? inner : `${inner}\n`
}

function delimit(katex: Element | null): string | null {
  const tex = (katex?.getAttribute('data-tex') ?? katex?.querySelector('annotation')?.textContent ?? '').trim()
  if (!tex) return null
  return `${COPY_DELIMITERS[0]}${tex}${COPY_DELIMITERS[1]}`
}

function sliceText(node: Text, range: Range): string {
  if (!intersects(range, node)) return ''
  const start = node === range.startContainer ? range.startOffset : 0
  const end = node === range.endContainer ? range.endOffset : node.data.length
  if (end < start) return ''
  return node.data.slice(start, end)
}

function intersects(range: Range, node: Node): boolean {
  if (typeof range.intersectsNode !== 'function') return false
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

function isBlock(node: Element): boolean {
  return /^(?:P|LI|H[1-6]|BLOCKQUOTE|PRE|TR|FIGCAPTION)$/.test(node.tagName)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
