import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'
import { QueryBlock } from '../components/QueryBlock'

// Language info-string that turns a fenced code block into a live results view.
export const QUERY_BLOCK_LANGUAGE = 'thread-query'

interface Mounted {
  dom: HTMLElement
  root: Root
}

// Each editor instance gets its own plugin + widget cache + disposer, so React
// StrictMode's mount/unmount/mount in dev can't cross-wire two instances.
export function createQueryBlockPlugin() {
  // One rendered widget per distinct query source. Keyed by the source string
  // so a widget decoration is reused across edits and the React tree (with its
  // live Dexie subscriptions) survives unrelated typing. Never pruned mid-life
  // — the document briefly holds no code block during editor init, and pruning
  // then would unmount a widget we immediately need again. Cleaned wholesale by
  // `dispose` on teardown.
  const bySource = new Map<string, Mounted>()

  const widgetFor = (source: string): HTMLElement => {
    const existing = bySource.get(source)
    if (existing) return existing.dom

    const dom = document.createElement('div')
    dom.className = 'query-block-view'
    dom.setAttribute('contenteditable', 'false')
    const root = createRoot(dom)
    const entry: Mounted = { dom, root }
    bySource.set(source, entry)
    // widgetFor runs inside ProseMirror's decoration computation, nested in the
    // app's React render pass; deferring the first render lets it commit.
    setTimeout(() => {
      if (bySource.get(source) === entry) root.render(createElement(QueryBlock, { source }))
    }, 0)
    return dom
  }

  const build = (doc: ProseNode): DecorationSet => {
    const decorations: Decoration[] = []
    doc.descendants((node, pos) => {
      if (node.type.name !== 'code_block') return true
      if (node.attrs.language === QUERY_BLOCK_LANGUAGE) {
        const source = node.textContent
        decorations.push(
          Decoration.widget(pos + node.nodeSize, () => widgetFor(source), {
            key: `tq:${source}`,
            side: 1,
            ignoreSelection: true,
          }),
        )
      }
      return false
    })
    return DecorationSet.create(doc, decorations)
  }

  const key = new PluginKey<DecorationSet>('thread-query-blocks')
  const plugin = $prose(() => new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, value) => (tr.docChanged ? build(tr.doc) : value.map(tr.mapping, tr.doc)),
    },
    props: {
      decorations(state) {
        return key.getState(state)
      },
    },
  }))

  const dispose = () => {
    for (const { root } of bySource.values()) {
      queueMicrotask(() => root.unmount())
    }
    bySource.clear()
  }

  return { plugin, dispose }
}
