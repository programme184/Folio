import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve('src')
const english = JSON.parse(fs.readFileSync('../electron/src/shared/locales/en.json', 'utf8'))
const chinese = JSON.parse(fs.readFileSync('../electron/src/shared/locales/zh-CN.json', 'utf8'))
const extra = JSON.parse(fs.readFileSync('src/i18n/zh-CN.extra.json', 'utf8'))
const outputFile = 'src/i18n/zh-CN.json'
const used = new Set()

function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'i18n' && entry.name !== 'terminal' && entry.name !== 'editor') visitDirectory(filename)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      const source = fs.readFileSync(filename, 'utf8')
      const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      function visit(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) used.add(node.text)
        if (ts.isJsxText(node)) {
          const value = node.text.replace(/\s+/g, ' ').trim()
          if (value) used.add(value)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
  }
}

visitDirectory(root)
const matches = new Map()
for (const [key, value] of Object.entries(english)) {
  if (!used.has(value) || typeof chinese[key] !== 'string' || chinese[key] === value) continue
  const options = matches.get(value) ?? new Set()
  options.add(chinese[key])
  matches.set(value, options)
}
const translations = Object.fromEntries([...matches].filter(([, options]) => options.size === 1)
  .map(([source, options]) => [source, [...options][0]]))
Object.assign(translations, extra)
const output = `${JSON.stringify(Object.fromEntries(Object.entries(translations).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`
if (process.argv.includes('--check')) {
  if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf8') !== output) {
    console.error('Mobile Chinese catalog is stale; run pnpm run locale:generate')
    process.exitCode = 1
  }
} else {
  fs.writeFileSync(outputFile, output)
  console.log(`${Object.keys(translations).length} mobile Chinese translations`)
}
