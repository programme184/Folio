import { parser, type ASTNode, type MarkdownParser } from 'react-native-markdown-display'

// The library accepts/returns AST arrays at runtime; its declarations describe
// the renderer callback as a single node returning a native View instead.
const parseAst = parser as unknown as (
  source: string,
  render: (nodes: ASTNode[]) => ASTNode[],
  markdown: MarkdownParser,
) => ASTNode[]

export function stableMarkdownAst(source: string, markdown: MarkdownParser): ASTNode[] {
  return parseAst(source, nodes => {
    const visit = (children: ASTNode[], parent: string) => {
      children.forEach((node, index) => {
        // Appends retain native paragraphs; structural type changes remount.
        node.key = `${parent}/${index}:${node.type}`
        if (node.children?.length) visit(node.children, node.key)
      })
    }
    visit(nodes, 'markdown')
    return nodes
  }, markdown)
}
