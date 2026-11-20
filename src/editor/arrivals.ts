// A note changed on another device while open here (a Refresh, or any pull, brought it): the
// editor takes only what differs, and shows it. What is new fades in, lines with their
// images, videos and equations; what went away fades out where it was, then is gone.
// Not undoable: Undo is for this device's own typing. The changes don't count as an edit.

import { Annotation, StateEffect, StateField, Transaction, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ARRIVAL_MS, textChanges } from '../model/diff'

/** Marks the transaction that brought another device's version: not the person's typing. */
export const remote = Annotation.define<boolean>()

const show = StateEffect.define<Range<Decoration>[]>()
const clear = StateEffect.define<null>()

const arrived = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(clear)) next = Decoration.none
      if (e.is(show)) next = next.update({ add: e.value, sort: true })
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const arrivals = arrived

const arrivedLine = Decoration.line({ class: 'cm-arrived' })
const arrivedText = Decoration.mark({ class: 'cm-arrived' })

/** What went away, fading out where it was: lines as they were drawn, or a few words. */
class Departed extends WidgetType {
  constructor(
    readonly nodes: readonly Node[] | null,
    readonly text: string,
  ) {
    super()
  }
  override toDOM() {
    if (!this.nodes) {
      const span = document.createElement('span')
      span.className = 'cm-departed'
      span.textContent = this.text
      return span
    }
    // Rows that shrink to nothing as they fade (a grid row animates from 1fr to 0fr).
    const box = document.createElement('div')
    box.className = 'cm-departed cm-departed-block'
    const inner = document.createElement('div')
    for (const n of this.nodes) inner.append(n.cloneNode(true))
    box.append(inner)
    return box
  }
  override eq() {
    return false
  }
  override ignoreEvent() {
    return true
  }
}

/** The drawn lines and blocks of the editor that start in `[from, to)`, copied as they look. */
function drawn(view: EditorView, from: number, to: number): Node[] {
  const out: Node[] = []
  for (const child of view.contentDOM.children) {
    let at: number
    try {
      at = view.posAtDOM(child, 0)
    } catch {
      continue
    }
    if (at >= from && at < to) {
      const copy = child.cloneNode(true) as HTMLElement
      copy.removeAttribute('contenteditable')
      out.push(copy)
    }
  }
  return out
}

/** Every replaced range (an image, a video, an equation) the preview draws over `[from, to)`. */
function widened(view: EditorView, from: number, to: number): [number, number] {
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? source(view) : source
    set.between(from, to, (f, t, value) => {
      if (f < t && value.point && f < to && t > from) {
        from = Math.min(from, f)
        to = Math.max(to, t)
      }
    })
  }
  return [from, to]
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Brings the editor's text to `next`, changing only what differs, and fades the changes in
 * and out. False when there was nothing to change.
 */
export function receive(view: EditorView, next: string): boolean {
  const before = view.state.doc
  const changes = textChanges(before.toString(), next)
  if (!changes.length) return false
  const still = reduced()

  // What goes away, copied before it is gone: whole lines as drawn, else the words.
  const leaving = still
    ? []
    : changes
        .filter((c) => c.to > c.from)
        .map((c) => {
          const removed = before.sliceString(c.from, c.to)
          const first = before.lineAt(c.from)
          // Whole lines: from a line's start (or the break before it) to a line's end.
          const startsLine = c.from === first.from || c.from === first.to
          const last = before.lineAt(c.to)
          const endsLine = c.to === last.to || c.to === last.from
          // A line replaced by others counts too: it was drawn as a whole, so it leaves as one.
          const lines =
            startsLine &&
            endsLine &&
            (removed.includes('\n') || (c.from === first.from && c.to === last.to && c.to > c.from))
          const from = c.from === first.to && c.from < c.to ? c.from + 1 : c.from
          const nodes = lines ? drawn(view, from, Math.max(from + 1, c.to)) : null
          return { change: c, nodes: nodes?.length ? nodes : null, text: removed }
        })

  const tr = view.state.update({
    changes,
    annotations: [remote.of(true), Transaction.addToHistory.of(false)],
    // Line 2 is kept from typing (metaLine), not from another device's version of it.
    filter: false,
  })
  view.dispatch(tr)
  if (still) return true

  const doc = view.state.doc
  const marks: Range<Decoration>[] = []
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (toB <= fromB) return
    for (let pos = fromB; pos <= toB;) {
      const line = doc.lineAt(pos)
      const from = Math.max(fromB, line.from)
      const to = Math.min(toB, line.to)
      if (from === line.from && to === line.to && line.length > 0)
        marks.push(arrivedLine.range(line.from))
      else if (to > from) {
        const [a, b] = widened(view, from, to)
        marks.push(arrivedText.range(Math.max(a, line.from), Math.min(b, line.to)))
      }
      pos = line.to + 1
    }
  })
  for (const { change, nodes, text } of leaving) {
    if (!nodes && !text.trim()) continue
    const at = tr.changes.mapPos(change.from, -1)
    const line = doc.lineAt(at)
    const widget = new Departed(nodes, text.replace(/\n+/g, ' '))
    marks.push(
      nodes
        ? Decoration.widget({ widget, block: true, side: at === line.from ? -1 : 1 }).range(at)
        : Decoration.widget({ widget, side: -1 }).range(at),
    )
  }
  if (!marks.length) return true
  view.dispatch({ effects: show.of(marks) })
  // Blocks drawn in place of whole lines (diagrams, folded details) fade in as lines do.
  requestAnimationFrame(() => {
    tr.changes.iterChanges((_a, _b, fromB, toB) => {
      for (const child of view.contentDOM.children) {
        if (child.classList.contains('cm-line')) continue
        let at: number
        try {
          at = view.posAtDOM(child, 0)
        } catch {
          continue
        }
        if (at >= fromB && at < toB) child.classList.add('cm-arrived')
      }
    })
  })
  window.setTimeout(() => {
    // The editor may be gone by now (another leaf, closed).
    if (view.dom.isConnected) view.dispatch({ effects: clear.of(null) })
    for (const el of view.contentDOM.querySelectorAll('.cm-arrived'))
      el.classList.remove('cm-arrived')
  }, ARRIVAL_MS)
  return true
}
