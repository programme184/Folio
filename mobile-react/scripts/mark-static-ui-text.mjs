import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = path.resolve('src/components')
let changed = 0
let marked = 0

function isLiteralUiExpression(node) {
  if (!node) return false
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true
  if (ts.isParenthesizedExpression(node)) return isLiteralUiExpression(node.expression)
  if (ts.isConditionalExpression(node)) return isLiteralUiExpression(node.whenTrue) && isLiteralUiExpression(node.whenFalse)
  return false
}

function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) visitDirectory(filename)
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) markFile(filename)
  }
}

function markFile(filename) {
  const source = fs.readFileSync(filename, 'utf8')
  if (!source.includes("from './AppText'") && !source.includes("from '../AppText'")) return
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const positions = []
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Text'
      && !node.openingElement.attributes.properties.some(prop => prop.name?.text === 'localize')
      && node.children.some(child => ts.isJsxText(child) && child.text.trim()
        || ts.isJsxExpression(child) && isLiteralUiExpression(child.expression))) {
      positions.push(node.openingElement.end - 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (!positions.length) return
  marked += positions.length
  if (!process.argv.includes('--write')) return
  let result = source
  for (const position of positions.reverse()) result = `${result.slice(0, position)} localize${result.slice(position)}`
  fs.writeFileSync(filename, result)
  changed++
}

visitDirectory(root)
console.log(`${marked} static Text elements${process.argv.includes('--write') ? ` across ${changed} files` : ' to mark'}`)
