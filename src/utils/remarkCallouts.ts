import { visit } from 'unist-util-visit'
import type { Root, Blockquote } from 'mdast'
import type { Plugin } from 'unified'
import { applyCalloutToBlockquote, type MdastBlockquoteNode } from './callouts'

// Thin remark plugin wrapper. Kept out of callouts.ts so the marker-parsing
// logic in applyCalloutToBlockquote stays testable without a real unified
// pipeline — Jest can't transform react-markdown/remark's ESM output (see
// previewTaskDone.test.tsx), so unist-util-visit is only exercised here,
// in production code, not in tests.
export const remarkCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'blockquote', (node: Blockquote) => {
    applyCalloutToBlockquote(node as unknown as MdastBlockquoteNode)
  })
}
