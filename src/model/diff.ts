// A line diff for reading: what changed between two versions of a leaf, with long runs of
// unchanged lines folded. The LCS comes from node-diff3, already used for merging.

import { diffComm } from 'node-diff3'

export type DiffLine =
  | { kind: 'same' | 'removed' | 'added'; text: string }
  /** `count` unchanged lines, folded. */
  | { kind: 'skip'; count: number }

type Chunk = { common: string[] } | { buffer1: string[]; buffer2: string[] }

/** `before` → `after`, line by line; unchanged runs keep `context` lines around each change. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const chunks = diffComm(before.split('\n'), after.split('\n')) as Chunk[]
  const out: DiffLine[] = []
  chunks.forEach((chunk, i) => {
    if (!('common' in chunk)) {
      for (const text of chunk.buffer1) out.push({ kind: 'removed', text })
      for (const text of chunk.buffer2) out.push({ kind: 'added', text })
      return
    }
    const lines = chunk.common
    const head = i === 0 ? 0 : context
    const tail = i === chunks.length - 1 ? 0 : context
    if (lines.length <= head + tail + 1) {
      for (const text of lines) out.push({ kind: 'same', text })
      return
    }
    for (const text of lines.slice(0, head)) out.push({ kind: 'same', text })
    out.push({ kind: 'skip', count: lines.length - head - tail })
    for (const text of lines.slice(lines.length - tail)) out.push({ kind: 'same', text })
  })
  return out
}

/** How long a change from another device fades in or out on screen (the editor's CSS too). */
export const ARRIVAL_MS = 1400

/** One change to a text, in the old text's offsets: `[from, to)` becomes `insert`. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * The smallest changes that turn `before` into `after`, in order and apart: lines are matched
 * first (the LCS, as above), then each changed run is trimmed to the characters that differ.
 * For showing only what is new when a note changes on another device.
 */
export function textChanges(before: string, after: string): TextChange[] {
  if (before === after) return []
  // Each line keeps its line break, so the last line (which has none) differs from itself
  // followed by more, and the change is the break plus what comes after it.
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const chunks = diffComm(split(before), split(after)) as Chunk[]
  const out: TextChange[] = []
  let at = 0
  for (const chunk of chunks) {
    if ('common' in chunk) {
      at += chunk.common.join('').length
      continue
    }
    const removed = chunk.buffer1.join('')
    const added = chunk.buffer2.join('')
    let head = 0
    const most = Math.min(removed.length, added.length)
    while (head < most && removed[head] === added[head]) head++
    let tail = 0
    while (
      tail < most - head &&
      removed[removed.length - 1 - tail] === added[added.length - 1 - tail]
    )
      tail++
    if (removed.length - head - tail > 0 || added.length - head - tail > 0)
      out.push({
        from: at + head,
        to: at + removed.length - tail,
        insert: added.slice(head, added.length - tail),
      })
    at += removed.length
  }
  return out
}
