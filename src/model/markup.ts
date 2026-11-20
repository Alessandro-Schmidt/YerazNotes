// Markup on an image (development-plan.md M6, ARCHITECTURE.md §4): the original stays as it is;
// the note shows a copy with the strokes drawn in (`photo.marked.png`, or `.jpg` for a photo),
// and the strokes are kept beside it as a drawing (`photo.marked.ink.svg`) whose `image` names
// the original, so they can be changed again. Pure.

import { compose, IDENTITY, swapsSides, type Matrix } from './orient'
import { INK_WIDTH, type Ink } from './ink'

/** `assets/x.marked.png` (or `.jpg`): a marked-up copy. */
export const MARKED = /\.marked\.(png|jpe?g)$/i

export const isMarked = (path: string) => MARKED.test(path)

/** The drawing that holds a marked-up copy's strokes. */
export const strokesOf = (marked: string) => marked.replace(MARKED, '.marked.ink.svg')

/** The marked-up copy of an original: a photo stays a JPEG, anything else becomes a PNG. */
export function markedOf(original: string): string {
  const jpeg = /\.jpe?g$/i.test(original)
  return `${original.replace(/\.[^./]+$/, '')}.marked.${jpeg ? 'jpg' : 'png'}`
}

/** Strokes for a picture of this aspect: 1000 units wide, as tall as the picture is. */
export const markupHeight = (width: number, height: number) =>
  Math.max(1, Math.round((INK_WIDTH * height) / Math.max(1, width)))

/**
 * The strokes turned or flipped with their picture: each point is moved as the picture is,
 * then the whole drawing is scaled back to 1000 units wide.
 */
export function transformInk(ink: Ink, m: Matrix): Ink {
  const [w, h] = [ink.width, ink.height]
  const swap = swapsSides(m)
  const [w2, h2] = swap ? [h, w] : [w, h]
  const k = INK_WIDTH / w2
  const r = (v: number) => Math.round(v * 10) / 10 || 0
  const strokes = ink.strokes.map((s) => {
    const points = s.points.slice()
    for (let i = 0; i + 1 < points.length; i += 3) {
      const [x, y] = [points[i]! - w / 2, points[i + 1]! - h / 2]
      points[i] = r((m[0][0] * x + m[0][1] * y + w2 / 2) * k)
      points[i + 1] = r((m[1][0] * x + m[1][1] * y + h2 / 2) * k)
    }
    return { ...s, points }
  })
  return { ...ink, width: INK_WIDTH, height: Math.round(h2 * k), strokes }
}

/** What the viewer hands back: the turn to apply, and the strokes as they are now. */
export interface ImageEdit {
  /** Applied after the picture's own orientation; the identity when it wasn't turned. */
  turn: Matrix
  /** Strokes on the turned picture (none: no markup). */
  ink: Ink
}

export const noEdit = (ink: Ink): ImageEdit => ({ turn: IDENTITY, ink })

/** One more turn or flip, after what was already done. */
export const andThen = (edit: ImageEdit, m: Matrix): ImageEdit => ({
  turn: compose(m, edit.turn),
  ink: transformInk(edit.ink, m),
})
