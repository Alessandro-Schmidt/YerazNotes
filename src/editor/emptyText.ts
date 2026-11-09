// An empty text, in the editor: what to do with it, in place of a body (owner's wording).

import { syntaxTree } from '@codemirror/language'
import type { Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { HEADING, META } from '../model/parse'
import { isMac, isTouch } from '../ui/platform'

/** The first line of the body: after the title, its metadata line and one blank line. */
export function bodyStart(doc: Text): number {
  let n = 1
  if (HEADING.test(doc.line(1).text)) n++
  if (n <= doc.lines && META.test(doc.line(n).text)) n++
  if (n > 1 && n < doc.lines && !doc.line(n).text.trim()) n++
  return n
}

/** Nothing written below the title. */
export function isEmpty(doc: Text): boolean {
  for (let n = bodyStart(doc); n <= doc.lines; n++) if (doc.line(n).text.trim()) return false
  return true
}

/** The hint's words: holding Ctrl or ⌘ opens the insert menu; on touch, typing / does. */
export function hintParts(touch: boolean, mac: boolean): [string, string, string] {
  if (touch) return ['Tap to write, type ', '/', ' to see options']
  return ['Click to write, hold ', mac ? '⌘' : 'Ctrl', ' to see options']
}

class Hint extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const hint = document.createElement('span')
    hint.className = 'cm-hint'
    hint.setAttribute('aria-hidden', 'true')
    const arrow = document.createElement('span')
    arrow.className = 'cm-hint-arrow'
    arrow.textContent = '→'
    const [before, key, after] = hintParts(isTouch(), isMac)
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    // The words are one block after the arrow: a narrow panel wraps them, never under it.
    const words = document.createElement('span')
    words.append(before, kbd, after)
    hint.append(arrow, words)
    return hint
  }
  // Clicks reach the editor, which puts the cursor there to write.
  ignoreEvent() {
    return false
  }
}

const hint = Decoration.widget({ widget: new Hint(), side: 1 })

/** A new line's hint's words (issue #68): on touch, tap and hold or `/` opens the menu. */
export function lineHintParts(touch: boolean, mac: boolean): [string, string, string] {
  if (touch) return ['Tap and hold, or type ', '/', ', to see options']
  return ['Hold ', mac ? '⌘' : 'Ctrl', ' to see options']
}

class LineHint extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-line-hint'
    el.setAttribute('aria-hidden', 'true')
    const [before, key, after] = lineHintParts(isTouch(), isMac)
    const kbd = document.createElement('kbd')
    kbd.textContent = key
    el.append(before, kbd, after)
    return el
  }
}

const lineHint = Decoration.widget({ widget: new LineHint(), side: 1 })

/** Where the new line's hint goes: the empty body line being written on, outside code. */
function newLine(view: EditorView): DecorationSet {
  const { state } = view
  const { main } = state.selection
  if (!view.hasFocus || !main.empty || state.selection.ranges.length > 1) return Decoration.none
  const line = state.doc.lineAt(main.head)
  if (line.text !== '' || line.number < bodyStart(state.doc) || isEmpty(state.doc))
    return Decoration.none
  for (let n = syntaxTree(state).resolveInner(line.from, 1); n.parent; n = n.parent)
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return Decoration.none
  return Decoration.set(lineHint.range(line.from))
}

/** A faint hint at the start of each new line: how to open the insert menu. */
export const newLineHint = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = newLine(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged)
        this.decorations = newLine(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

/** The hint at the end of an empty text, where the cursor goes to write. */
export const emptyHint = EditorView.decorations.compute(['doc'], (state) =>
  isEmpty(state.doc) ? Decoration.set(hint.range(state.doc.length)) : Decoration.none,
)
