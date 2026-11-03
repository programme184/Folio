import { useEffect, useMemo, useRef, useState } from 'react'
import * as ts from 'typescript'
import './WorkspaceCanvasViewer.css'

interface WorkspaceCanvasViewerProps {
  source: string
  label: string
}

interface CompiledCanvas {
  code: string
  error: string | null
}

export function WorkspaceCanvasViewer({ source, label }: WorkspaceCanvasViewerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [documentUrl, setDocumentUrl] = useState<string | null>(null)
  const light = document.documentElement.dataset.theme === 'light'
  const compiled = useMemo(() => compileCanvas(source), [source])
  const documentSource = useMemo(() => (
    compiled.error ? '' : canvasDocument(compiled.code, light)
  ), [compiled, light])

  useEffect(() => {
    let cancelled = false
    setDocumentUrl(null)
    if (documentSource) {
      void window.agentsDock.workspace.createCanvasPreview(documentSource)
        .then(url => {
          if (!cancelled) setDocumentUrl(url)
        })
        .catch(error => {
          if (!cancelled) setRuntimeError(error instanceof Error ? error.message : String(error))
        })
    }
    return () => {
      cancelled = true
    }
  }, [documentSource])

  useEffect(() => {
    setRuntimeError(null)
    const frame = frameRef.current
    if (!frame) return
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.source !== 'agentsdock-canvas-preview') return
      if (event.data.type === 'error') setRuntimeError(String(event.data.message || 'Canvas failed to render.'))
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [documentUrl])

  if (compiled.error) {
    return <div className="workspace-canvas-error" role="alert">
      <strong>Canvas could not be compiled.</strong>
      <pre>{compiled.error}</pre>
    </div>
  }

  if (!documentUrl) return <div className="workspace-editor-loading">Loading Canvas…</div>

  return <div className="workspace-canvas-viewer">
    {runtimeError && <div className="workspace-canvas-runtime-error" role="alert">{runtimeError}</div>}
    <iframe
      ref={frameRef}
      className="workspace-canvas-frame"
      title={label}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      src={documentUrl}
    />
  </div>
}

export function compileCanvas(source: string): CompiledCanvas {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'CanvasRuntime.createElement',
      jsxFragmentFactory: 'CanvasRuntime.Fragment',
      esModuleInterop: true,
      isolatedModules: true,
      sourceMap: false,
      inlineSourceMap: false
    },
    fileName: 'artifact.canvas.tsx',
    reportDiagnostics: true
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length) {
    return {
      code: '',
      error: errors.map(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        if (diagnostic.start === undefined || !diagnostic.file) return message
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        return `${position.line + 1}:${position.character + 1} ${message}`
      }).join('\n')
    }
  }
  return { code: result.outputText, error: null }
}

function canvasDocument(code: string, light: boolean): string {
  const safeCode = code.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html data-theme="${light ? 'light' : 'dark'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src agentsdock-canvas:; img-src data: blob:; font-src data:">
<meta name="color-scheme" content="${light ? 'light' : 'dark'}">
<style>
:root {
  --cv-bg: #111315; --cv-surface: #181b1f; --cv-surface-2: #20242a;
  --cv-text: #f0f2f4; --cv-muted: #aeb4bc; --cv-faint: #7d858f; --cv-border: #30353c;
  --cv-accent: #8ab4f8; --cv-info: #82b5ff; --cv-warning: #e8bc72;
  --cv-success: #76c893; --cv-danger: #f08a84;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--cv-text); background: var(--cv-bg); color-scheme: dark;
}
:root[data-theme="light"] {
  --cv-bg: #f6f7f9; --cv-surface: #ffffff; --cv-surface-2: #f0f2f5;
  --cv-text: #1f2328; --cv-muted: #59636e; --cv-faint: #818b98; --cv-border: #d8dee6;
  --cv-accent: #0969da; --cv-info: #0969da; --cv-warning: #8a5b00;
  --cv-success: #1a7f37; --cv-danger: #cf222e; color-scheme: light;
}
* { box-sizing: border-box; }
html, body, #canvas-root { min-height: 100%; margin: 0; }
body { background: var(--cv-bg); color: var(--cv-text); font-size: 14px; line-height: 1.6; text-rendering: optimizeLegibility; }
#canvas-root { overflow: hidden; }
h1, h2, h3 { margin: 0; color: var(--cv-text); line-height: 1.25; letter-spacing: -0.018em; }
h1 { font-size: clamp(24px, 2.7vw, 32px); font-weight: 720; }
h2 { font-size: 18px; font-weight: 680; }
h3 { font-size: 15px; font-weight: 680; }
.cv-stack { display: flex; flex-direction: column; }
.cv-row { display: flex; min-width: 0; }
.cv-grid { display: grid; min-width: 0; }
.cv-card { min-width: 0; overflow: hidden; background: var(--cv-surface); border: 1px solid var(--cv-border); border-radius: 12px; }
.cv-card-borderless { background: var(--cv-surface-2); border-color: transparent; }
.cv-card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 48px; padding: 13px 17px; font-weight: 680; border-bottom: 1px solid var(--cv-border); }
.cv-card-body { padding: 17px; }
.cv-text { display: block; min-width: 0; }
.cv-text-secondary { color: var(--cv-muted); }
.cv-text-small { font-size: 12.5px; line-height: 1.55; }
.cv-weight-semibold { font-weight: 650; }
.cv-weight-bold { font-weight: 700; }
.cv-code { padding: 1px 5px; border-radius: 5px; background: var(--cv-surface-2); border: 1px solid var(--cv-border); font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.cv-divider { width: 100%; margin: 0; border: 0; border-top: 1px solid var(--cv-border); }
.cv-pill { display: inline-flex; align-items: center; width: fit-content; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 680; line-height: 1.35; color: var(--cv-muted); background: var(--cv-surface); border: 1px solid var(--cv-border); }
.cv-tone-info { color: var(--cv-info); } .cv-tone-warning { color: var(--cv-warning); }
.cv-tone-success { color: var(--cv-success); } .cv-tone-danger { color: var(--cv-danger); }
.cv-callout { padding: 15px 17px; color: var(--cv-text); border: 1px solid var(--cv-border); border-left: 3px solid var(--cv-muted); border-radius: 9px; background: var(--cv-surface); }
.cv-callout.cv-tone-info { border-left-color: var(--cv-info); }
.cv-callout.cv-tone-warning { border-left-color: var(--cv-warning); }
.cv-callout.cv-tone-success { border-left-color: var(--cv-success); }
.cv-callout.cv-tone-danger { border-left-color: var(--cv-danger); }
.cv-callout-title { margin-bottom: 5px; color: var(--cv-text); font-weight: 680; }
.cv-table-wrap { width: 100%; overflow: auto; border: 1px solid var(--cv-border); border-radius: 10px; background: var(--cv-surface); }
.cv-table { width: 100%; min-width: 560px; border-collapse: collapse; background: var(--cv-surface); }
.cv-table th, .cv-table td { padding: 11px 13px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--cv-border); }
.cv-table th { position: sticky; top: 0; z-index: 1; color: var(--cv-muted); background: var(--cv-surface-2); font-size: 11.5px; font-weight: 680; letter-spacing: 0.01em; }
.cv-table tr:last-child td { border-bottom: 0; }
.cv-table-striped tbody tr:nth-child(even) { background: color-mix(in srgb, var(--cv-surface-2) 55%, transparent); }
.cv-table tbody tr[class*="cv-tone-"] { color: var(--cv-text); }
.cv-table tbody tr.cv-tone-warning { background: color-mix(in srgb, var(--cv-warning) 7%, var(--cv-surface)); }
.cv-table tbody tr.cv-tone-info { background: color-mix(in srgb, var(--cv-info) 6%, var(--cv-surface)); }
.cv-button { appearance: none; padding: 7px 11px; color: var(--cv-text); background: var(--cv-surface-2); border: 1px solid var(--cv-border); border-radius: 6px; font: inherit; cursor: pointer; }
.cv-link { color: var(--cv-accent); text-decoration: none; }
.cv-stat-value { font-size: 24px; font-weight: 720; letter-spacing: -0.02em; } .cv-stat-label { color: var(--cv-muted); font-size: 12px; }
.cv-error { margin: 24px; padding: 16px; color: var(--cv-danger); white-space: pre-wrap; background: var(--cv-surface); border: 1px solid var(--cv-danger); border-radius: 8px; }
@media (max-width: 720px) {
  h1 { font-size: 24px; }
  .cv-grid { grid-template-columns: 1fr !important; }
  #canvas-root > .cv-stack { padding: 18px !important; gap: 18px !important; }
  .cv-card-header, .cv-card-body { padding-left: 14px; padding-right: 14px; }
}
</style>
</head>
<body><main id="canvas-root" aria-label="Canvas visualization"></main>
<script>
(() => {
  'use strict';
  const root = document.getElementById('canvas-root');
  const Fragment = Symbol('Fragment');
  let hookCursor = 0;
  const hooks = [];
  let CanvasApp = null;
  const flatten = values => values.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false && value !== true);
  const append = (node, children) => {
    for (const child of flatten(children)) {
      if (child instanceof Node) node.appendChild(child);
      else node.appendChild(document.createTextNode(String(child)));
    }
    return node;
  };
  const classNames = (...values) => values.filter(Boolean).join(' ');
  const unitlessStyles = new Set(['animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexNegative', 'flexOrder', 'flexPositive', 'flexShrink', 'floodOpacity', 'fontWeight', 'gridArea', 'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart', 'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth', 'tabSize', 'widows', 'zIndex', 'zoom']);
  const applyStyle = (node, style) => {
    for (const [key, value] of Object.entries(style || {})) {
      if (value === undefined || value === null || value === false) continue;
      const normalized = typeof value === 'number' && value !== 0 && !unitlessStyles.has(key) ? value + 'px' : String(value);
      if (key.startsWith('--')) node.style.setProperty(key, normalized);
      else node.style[key] = normalized;
    }
  };
  const applyProps = (node, props) => {
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'children' || key === 'key' || value === undefined || value === null || value === false) continue;
      if (key === 'style' && typeof value === 'object') { applyStyle(node, value); continue; }
      if (key === 'className') { node.className = String(value); continue; }
      if (/^on[A-Z]/.test(key) && typeof value === 'function') { node.addEventListener(key.slice(2).toLowerCase(), value); continue; }
      if (key === 'htmlFor') { node.setAttribute('for', String(value)); continue; }
      if (key === 'dangerouslySetInnerHTML') continue;
      if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  };
  const createElement = (type, props, ...children) => {
    const allProps = { ...(props || {}), children: flatten(children) };
    if (type === Fragment) return allProps.children;
    if (typeof type === 'function') return type(allProps);
    const node = document.createElement(type);
    applyProps(node, allProps);
    return append(node, allProps.children);
  };
  const h = createElement;
  const gapStyle = gap => gap === undefined ? {} : { gap: typeof gap === 'number' ? gap + 'px' : gap };
  const Stack = ({ gap, children, style, ...props }) => h('div', { ...props, className: classNames('cv-stack', props.className), style: { ...gapStyle(gap), ...style } }, children);
  const Row = ({ gap, justify, align, wrap, children, style, ...props }) => h('div', { ...props, className: classNames('cv-row', props.className), style: { ...gapStyle(gap), justifyContent: justify, alignItems: align, flexWrap: wrap ? 'wrap' : undefined, ...style } }, children);
  const Grid = ({ columns, gap, children, style, ...props }) => h('div', { ...props, className: classNames('cv-grid', props.className), style: { gridTemplateColumns: typeof columns === 'number' ? 'repeat(' + columns + ', minmax(0, 1fr))' : columns, ...gapStyle(gap), ...style } }, children);
  const Card = ({ variant, children, ...props }) => h('section', { ...props, className: classNames('cv-card', variant === 'borderless' && 'cv-card-borderless', props.className) }, children);
  const CardHeader = ({ trailing, children, ...props }) => h('header', { ...props, className: classNames('cv-card-header', props.className) }, h('div', null, children), trailing ? h('div', null, trailing) : null);
  const CardBody = ({ children, ...props }) => h('div', { ...props, className: classNames('cv-card-body', props.className) }, children);
  const heading = tag => ({ children, ...props }) => h(tag, props, children);
  const H1 = heading('h1'), H2 = heading('h2'), H3 = heading('h3');
  const Text = ({ tone, size, weight, children, ...props }) => h('span', { ...props, className: classNames('cv-text', tone && 'cv-text-' + tone, size && 'cv-text-' + size, weight && 'cv-weight-' + weight, props.className) }, children);
  const Code = ({ children, ...props }) => h('code', { ...props, className: classNames('cv-code', props.className) }, children);
  const Divider = props => h('hr', { ...props, className: classNames('cv-divider', props.className) });
  const Pill = ({ tone, children, ...props }) => h('span', { ...props, className: classNames('cv-pill', tone && 'cv-tone-' + tone, props.className) }, children);
  const Callout = ({ tone, title, children, ...props }) => h('aside', { ...props, className: classNames('cv-callout', tone && 'cv-tone-' + tone, props.className) }, title ? h('div', { className: 'cv-callout-title' }, title) : null, h('div', null, children));
  const Table = ({ headers = [], rows = [], striped, rowTone = [], ...props }) => h('div', { className: 'cv-table-wrap' }, h('table', { ...props, className: classNames('cv-table', striped && 'cv-table-striped', props.className) }, h('thead', null, h('tr', null, headers.map(header => h('th', null, header)))), h('tbody', null, rows.map((row, index) => h('tr', { className: rowTone[index] ? 'cv-tone-' + rowTone[index] : '' }, row.map(cell => h('td', null, cell)))))));
  const Button = ({ children, ...props }) => h('button', { type: 'button', ...props, className: classNames('cv-button', props.className) }, children);
  const Link = ({ children, href = '#', ...props }) => h('a', { ...props, href: String(href).startsWith('javascript:') ? '#' : href, className: classNames('cv-link', props.className) }, children);
  const Spacer = ({ size = 8 }) => h('div', { 'aria-hidden': 'true', style: { height: typeof size === 'number' ? size + 'px' : size } });
  const Stat = ({ label, value, tone, ...props }) => h('div', props, h('div', { className: classNames('cv-stat-value', tone && 'cv-tone-' + tone) }, value), h('div', { className: 'cv-stat-label' }, label));
  const useHostTheme = () => ({
    bg: { editor: 'var(--cv-bg)', primary: 'var(--cv-bg)', secondary: 'var(--cv-surface)', tertiary: 'var(--cv-surface-2)' },
    fg: { primary: 'var(--cv-text)', secondary: 'var(--cv-muted)', muted: 'var(--cv-faint)' },
    border: { default: 'var(--cv-border)', muted: 'var(--cv-border)' },
    accent: { primary: 'var(--cv-accent)' },
    colors: { bg: { primary: 'var(--cv-bg)', secondary: 'var(--cv-surface)' }, fg: { primary: 'var(--cv-text)', secondary: 'var(--cv-muted)' } }
  });
  const useState = initial => {
    const index = hookCursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; renderApp(); }];
  };
  const useMemo = (factory, deps) => {
    const index = hookCursor++;
    const previous = hooks[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps[i])) hooks[index] = { value: factory(), deps };
    return hooks[index].value;
  };
  const useRef = initial => { const index = hookCursor++; return hooks[index] || (hooks[index] = { current: initial }); };
  const useEffect = (effect, deps) => { useMemo(() => { queueMicrotask(effect); return true; }, deps); };
  const useCanvasState = initial => useState(initial);
  const useCanvasAction = () => () => undefined;
  const generic = name => ({ children, ...props }) => h('div', { ...props, className: classNames('cv-' + String(name).toLowerCase(), props.className) }, children);
  const api = { Stack, Row, Grid, Card, CardHeader, CardBody, H1, H2, H3, Text, Code, Divider, Pill, Callout, Table, Button, Link, Spacer, Stat, useHostTheme, useState, useMemo, useRef, useEffect, useCanvasState, useCanvasAction, mergeStyle: (...styles) => Object.assign({}, ...styles) };
  const canvasApi = new Proxy(api, { get(target, key) { return key in target ? target[key] : generic(key); } });
  const CanvasRuntime = { createElement, Fragment };
  const module = { exports: {} };
  const exports = module.exports;
  const require = id => { if (id === 'cursor/canvas' || id === 'react') return canvasApi; throw new Error('Canvas import is not allowed: ' + id); };
  const renderError = error => {
    root.replaceChildren(h('pre', { className: 'cv-error', role: 'alert' }, String(error && (error.stack || error.message) || error)));
    parent.postMessage({ source: 'agentsdock-canvas-preview', type: 'error', message: String(error && error.message || error) }, '*');
  };
  const renderApp = () => {
    if (!CanvasApp) return;
    try { hookCursor = 0; root.replaceChildren(); append(root, [h(CanvasApp, null)]); }
    catch (error) { renderError(error); }
  };
  try {
${safeCode}
    CanvasApp = module.exports.default || module.exports;
    if (typeof CanvasApp !== 'function') throw new Error('Canvas must default-export a component.');
    renderApp();
    parent.postMessage({ source: 'agentsdock-canvas-preview', type: 'ready' }, '*');
  } catch (error) { renderError(error); }
})();
</script></body></html>`
}
