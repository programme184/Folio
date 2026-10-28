import katex from 'katex'
import { createElement, useEffect, useLayoutEffect, useRef } from 'react'

/** Document editors turn `$` and `$$` into a formula. `\(` and `\[` stay literal text. */

interface FormulaNode {
  type: string
  text?: string
  name?: string
  font?: string
  family?: Kind
  label?: string
  left?: string | null
  right?: string | null
  hasBarLine?: boolean
  leftDelim?: string | null
  rightDelim?: string | null
  base?: FormulaNode
  body?: FormulaNode | FormulaNode[]
  sub?: FormulaNode
  sup?: FormulaNode
  numer?: FormulaNode
  denom?: FormulaNode
  cols?: { align?: string }[]
}

type Kind = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner'

interface Piece {
  tex: string
  kind: Kind
}

class UnsupportedFormula extends Error {}

/** Canonical LaTeX for a copied formula. Falls back to the source when a construct is unfamiliar. */
export function normalizeFormulaTex(tex: string): string {
  const source = tex.trim()
  const parsed = parseFormula(source)
  if (!parsed) return source
  try {
    return joinPieces(parsed.flatMap(piecesOf)).tex || source
  } catch (error) {
    if (error instanceof UnsupportedFormula) return source
    throw error
  }
}

function parseFormula(tex: string): FormulaNode[] | null {
  const parse = (katex as unknown as {
    __parse?: (source: string, settings: { throwOnError: boolean; displayMode: boolean }) => FormulaNode[]
  }).__parse
  if (!parse) return null
  for (const displayMode of [true, false]) {
    try {
      return parse(tex, { throwOnError: true, displayMode })
    } catch {
      // \tag is display-only, and some inline constructs reject display mode.
    }
  }
  return null
}

function copiedFormula(tex: string): string {
  const body = normalizeFormulaTex(tex)
  // A matrix has to stay display math. Inline `$` puts the rows on one line box.
  if (/\\begin\{|\\\\/.test(body)) return `$$\n${body}\n$$`
  return `$${body}$`
}

function piecesOf(node: FormulaNode): Piece[] {
  const piece = pieceOf(node)
  return piece.tex ? [piece] : []
}

function pieceOf(node: FormulaNode): Piece {
  switch (node.type) {
    case 'mathord':
    case 'textord':
      return { tex: node.text ?? '', kind: 'ord' }
    case 'atom':
      return { tex: node.text ?? '', kind: node.family ?? 'ord' }
    case 'op':
      if (!node.name) throw new UnsupportedFormula()
      return { tex: node.name, kind: 'op' }
    case 'supsub': {
      const base = pieceOf(node.base ?? unsupported())
      let tex = base.tex
      if (node.sub) tex += `_{${contentOf(node.sub)}}`
      if (node.sup) tex += `^{${contentOf(node.sup)}}`
      return { tex, kind: base.kind }
    }
    case 'ordgroup':
    case 'styling':
    case 'mclass':
      return joinPieces(nodeList(node.body).flatMap(piecesOf))
    case 'font': {
      const inner = pieceOf(node.body && !Array.isArray(node.body) ? node.body : unsupported())
      if (!node.font) throw new UnsupportedFormula()
      return { tex: `\\${node.font}{${inner.tex}}`, kind: 'ord' }
    }
    case 'text':
      return { tex: `\\text{${textOf(node)}}`, kind: 'ord' }
    case 'accent':
      return { tex: `${node.label}{${contentOf(node.base ?? unsupported())}}`, kind: 'ord' }
    case 'genfrac':
      if (!node.hasBarLine || node.leftDelim || node.rightDelim) throw new UnsupportedFormula()
      return { tex: `\\frac{${contentOf(node.numer ?? unsupported())}}{${contentOf(node.denom ?? unsupported())}}`, kind: 'ord' }
    case 'leftright':
      return {
        tex: `\\left${node.left || '.'}${joinPieces(nodeList(node.body).flatMap(piecesOf)).tex}\\right${node.right || '.'}`,
        kind: 'inner'
      }
    case 'array':
      return { tex: arrayTex(node), kind: 'ord' }
    case 'tag':
      return joinPieces(nodeList(node.body).flatMap(piecesOf))
    default:
      throw new UnsupportedFormula()
  }
}

function arrayTex(node: FormulaNode): string {
  const cols = (node.cols ?? []).map(column => column.align ?? 'c').join('')
  const rows = (node.body as unknown as FormulaNode[][]).map(row => row.map(cell => contentOf(cell)).join(' & '))
  return `\\begin{array}{${cols}}\n${rows.join(' \\\\\n')}\n\\end{array}`
}

function textOf(node: FormulaNode): string {
  return nodeList(node.body).map(child => {
    if (child.type === 'textord' || child.type === 'mathord') return child.text ?? ''
    if (child.type === 'spacing') return ' '
    if (child.type === 'ordgroup') return textOf(child)
    throw new UnsupportedFormula()
  }).join('')
}

function contentOf(node: FormulaNode): string {
  return pieceOf(node).tex
}

function nodeList(value: FormulaNode | FormulaNode[] | undefined): FormulaNode[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function unsupported(): FormulaNode {
  throw new UnsupportedFormula()
}

function joinPieces(pieces: Piece[]): Piece {
  const present = pieces.filter(piece => piece.tex)
  if (present.length === 0) return { tex: '', kind: 'ord' }
  let tex = present[0].tex
  for (let index = 1; index < present.length; index += 1) {
    tex += gap(present[index - 1], present[index]) + present[index].tex
  }
  return { tex, kind: present.length === 1 ? present[0].kind : 'ord' }
}

function gap(left: Piece, right: Piece): string {
  if (/\\[a-zA-Z]+$/.test(left.tex) && /^[a-zA-Z]/.test(right.tex)) return ' '
  if (right.kind === 'punct') return ''
  if (left.kind === 'punct') return ' '
  if (left.kind === 'rel' || right.kind === 'rel') return ''
  if (left.kind === 'bin' || right.kind === 'bin') return ' '
  if (left.kind === 'ord' && right.kind === 'ord' && scripted(left) && scripted(right)) return ' '
  return ''
}

function scripted(piece: Piece): boolean {
  return piece.tex.startsWith('\\') || /[_^]/.test(piece.tex)
}

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
    source.textContent = copiedFormula(tex)
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
  event.clipboardData.setData('text/html', `<p>${escapeHtml(text)}</p>`)
}

/**
 * Plain text for a selection in rendered Markdown.
 * Formulas become LaTeX inside `$...$` instead of the
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
  return copiedFormula(tex)
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
