// Which part of a leaf's cover shows: line 2's `coverPosition`, a percentage from the top,
// as CSS object-position draws it.

import type { LeafMeta } from '../model/parse'

/** Which part of the cover shows: a percentage from the top (line 2's `coverPosition`). */
export function coverPosition(meta: LeafMeta | null | undefined): number {
  const y = meta?.coverPosition
  return typeof y === 'number' && Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50
}

/**
 * The position after dragging the image `dy` px down: the image follows the pointer.
 * `box` is the slot, `image` the picture's own size; it is drawn to cover the slot.
 */
export function dragCover(
  y: number,
  dy: number,
  box: { width: number; height: number },
  image: { width: number; height: number },
): number {
  const scale = Math.max(box.width / image.width, box.height / image.height)
  const hidden = image.height * scale - box.height
  if (hidden < 1) return y
  return Math.round(Math.min(100, Math.max(0, y - (dy / hidden) * 100)))
}

/** `"3:2"` as CSS `3 / 2`; null for anything else. */
function ratio(value: unknown): string | null {
  const m = typeof value === 'string' ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value) : null
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? `${m[1]} / ${m[2]}` : null
}

const COVER_ASPECTS: Record<string, string> = { slim: '5 / 1', tall: '2 / 1' }

/** The cover's CSS aspect ratio (line 2's `coverAspect`: slim, tall or "W:H"); null is the usual 3:1. */
export function coverAspect(meta: LeafMeta | null | undefined): string | null {
  const a = meta?.coverAspect
  return (typeof a === 'string' && COVER_ASPECTS[a]) || ratio(a)
}

/** The image icon's frame (line 2's `iconShape`): circle (as before), rounded, square or "W:H". */
export function iconShape(meta: LeafMeta | null | undefined): {
  radius: string
  aspect: string
} {
  const s = meta?.iconShape
  const aspect = ratio(s)
  if (aspect) return { radius: '12%', aspect }
  if (s === 'square') return { radius: '0', aspect: '1 / 1' }
  if (s === 'rounded') return { radius: '22%', aspect: '1 / 1' }
  return { radius: '50%', aspect: '1 / 1' }
}

/** Which part of the image icon shows (line 2's `iconFocus`: [x, y] in %), centred by default. */
export function iconFocus(meta: LeafMeta | null | undefined): [number, number] {
  const f = meta?.iconFocus
  const pct = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50
  return Array.isArray(f) ? [pct(f[0]), pct(f[1])] : [50, 50]
}

/** The icon's x after dragging `dx` px right: dragCover, sideways. */
export const dragSideways = (
  x: number,
  dx: number,
  box: { width: number; height: number },
  image: { width: number; height: number },
) =>
  dragCover(
    x,
    dx,
    { width: box.height, height: box.width },
    { width: image.height, height: image.width },
  )
