// Formatting while writing (owner's request): Ctrl/⌘+B, I, E (code), Shift+X (strike) and K
// (a link) wrap the selection in its Markdown, or take it off again; with nothing selected
// they open a pair to type into. On any keyboard, a mark typed over a selection (`*`, `_`,
// `` ` ``, `~`, `[`, `(`, `"`) wraps it instead of replacing it: the way to format on a phone.

import { indentLess, indentMore } from '@codemirror/commands'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** Each selection wrapped in `open`…`close`, or unwrapped where it already is. */
export function toggleWrap(state: EditorState, open: string, close = open): TransactionSpec {
  return state.changeByRange((range) => {
    const { from, to } = range
    const inside = state.sliceDoc(from, to)
    const around =
      state.sliceDoc(from - open.length, from) === open &&
      state.sliceDoc(to, to + close.length) === close
    if (around)
      return {
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length },
        ],
        range: EditorSelection.range(from - open.length, to - open.length),
      }
    if (
      inside.startsWith(open) &&
      inside.endsWith(close) &&
      inside.length >= open.length + close.length
    )
      return {
        changes: { from, to, insert: inside.slice(open.length, inside.length - close.length) },
        range: EditorSelection.range(from, to - open.length - close.length),
      }
    return {
      changes: [
        { from, insert: open },
        { from: to, insert: close },
      ],
      range: EditorSelection.range(from + open.length, to + open.length),
    }
  })
}

/** A link: the selection as its text, the cursor where its address goes. */
export function link(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    const insert = `[${text}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + (text ? insert.length - 1 : 1)),
    }
  })
}

const run =
  (open: string, close = open) =>
  (view: EditorView) => {
    view.dispatch(toggleWrap(view.state, open, close))
    return true
  }

const LIST = /^(\s*)([-*+]|\d+[.)])\s+/

/**
 * Tab on a list item nests it under the item above (its text's column), Shift-Tab brings it
 * back out; each selected line moves. Null when the cursor's line isn't a list item.
 */
export function indentList(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  if (!LIST.test(first.text)) return null
  const changes = []
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n)
    const m = LIST.exec(line.text)
    if (!m) continue
    const indent = m[1]!.length
    if (dir === 1) {
      // The item above at this depth says how wide its marker is: nest under its text.
      let width = 2
      for (let p = n - 1; p >= 1; p--) {
        const text = state.doc.line(p).text
        const above = LIST.exec(text)
        if (!above) {
          if (text.trim()) break
          continue
        }
        if (above[1]!.length <= indent) {
          width = above[0].length - above[1]!.length
          break
        }
      }
      changes.push({ from: line.from, insert: ' '.repeat(width) })
    } else if (indent) {
      // Back out to the next shallower item above, or to the margin.
      let target = 0
      for (let p = n - 1; p >= 1; p--) {
        const above = LIST.exec(state.doc.line(p).text)
        if (above && above[1]!.length < indent) {
          target = above[1]!.length
          break
        }
      }
      changes.push({ from: line.from, to: line.from + indent - target })
    }
  }
  return changes.length ? { changes } : null
}

const indentListBy =
  (dir: 1 | -1, fallback: (view: EditorView) => boolean) => (view: EditorView) => {
    const spec = indentList(view.state, dir)
    if (!spec) return fallback(view)
    view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input.indent' })
    return true
  }
/** Tab: a list item nests; elsewhere the line indents (a code block). */
export const indentCommand = indentListBy(1, indentMore)
export const outdentCommand = indentListBy(-1, indentLess)

const ITEM = /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/

/**
 * Backspace at the start of a list item's text takes its bullet, box or number away whole:
 * the line goes on as text, its Markdown never shown. Null elsewhere.
 */
export function unlist(state: EditorState): TransactionSpec | null {
  const { main } = state.selection
  if (!main.empty) return null
  const line = state.doc.lineAt(main.head)
  const m = ITEM.exec(line.text)
  if (!m || main.head !== line.from + m[0].length) return null
  return { changes: { from: line.from, to: main.head } }
}

const EMPTY_ITEM = /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?$/

/**
 * Enter in a list item (issue feedback: a to-do list jumped two lines). Markdown's own Enter
 * moves an empty item down a line, which makes the list loose, and from then on puts a blank
 * line before every new item. Here an empty item ends the list (a nested one comes out a
 * level), and a new item always goes on the very next line. Null outside a list.
 */
export function listEnter(state: EditorState): TransactionSpec | null {
  const { main } = state.selection
  if (!main.empty || state.selection.ranges.length > 1) return null
  const line = state.doc.lineAt(main.head)
  const m = ITEM.exec(line.text)
  if (!m || main.head < line.from + m[0].length) return null
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
    main.head,
    -1,
  )
  while (node && node.name !== 'ListItem') node = node.parent
  if (!node) return null
  if (EMPTY_ITEM.test(line.text) && main.head === line.to)
    return indentList(state, -1) ?? { changes: { from: line.from, to: line.to } }
  let tr: Transaction | null = null
  if (!insertNewlineContinueMarkup({ state, dispatch: (t) => (tr = t) }) || !tr) return null
  const done: Transaction = tr
  const changes: ChangeSpec[] = []
  let cursor = done.newSelection.main.head
  done.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    const text = inserted.toString()
    const tight = text.replace(/^\n[ \t>]*\n/, '\n')
    if (tight !== text && toB <= cursor) cursor -= text.length - tight.length
    changes.push({ from: fromA, to: toA, insert: tight })
  })
  return {
    changes,
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

export const formatKeymap = keymap.of([
  {
    key: 'Enter',
    run: (view) => {
      const spec = listEnter(view.state)
      if (spec) view.dispatch(spec)
      return !!spec
    },
  },
  { key: 'Tab', run: indentCommand, shift: outdentCommand },
  {
    key: 'Backspace',
    run: (view) => {
      const spec = unlist(view.state)
      if (spec) view.dispatch({ ...spec, userEvent: 'delete.backward' })
      return !!spec
    },
  },
  { key: 'Mod-b', run: run('**') },
  { key: 'Mod-i', run: run('*') },
  { key: 'Mod-e', run: run('`') },
  { key: 'Mod-Shift-x', run: run('~~') },
  {
    key: 'Mod-k',
    // Selected text becomes a link; with nothing selected the key is Search's (owner's request).
    run: (view) => {
      if (view.state.selection.main.empty) return false
      view.dispatch(link(view.state))
      return true
    },
  },
])

/** What a typed character wraps a selection in. */
const PAIRS: Record<string, string> = {
  '*': '*',
  _: '_',
  '`': '`',
  '~': '~',
  '[': ']',
  '(': ')',
  '"': '"',
}

/** A mark typed over a selection wraps it. */
export const wrapTyped = EditorView.inputHandler.of((view, from, to, text) => {
  const close = PAIRS[text]
  if (!close || from === to) return false
  const { main } = view.state.selection
  if (main.from !== from || main.to !== to) return false
  view.dispatch(toggleWrap(view.state, text, close))
  return true
})

// Above markdown()'s own Backspace (itself high), which would leave the item's indent showing.
export const formatting = [Prec.highest(formatKeymap), wrapTyped]
