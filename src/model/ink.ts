// Ink (development-plan.md M5, ARCHITECTURE.md §4): handwriting and drawings, written with a pen,
// a finger or a mouse, kept as an SVG file in `assets/` whose name ends in `.ink.svg`. GitHub
// shows the SVG as a picture; its `<metadata>` holds the strokes, so Yeraz edits them again.
// Reading a file and writing it back gives the same bytes.
//
// Coordinates are in a space 1000 units wide, whatever the screen: a drawing scales with its
// column. Colours are the theme's names; the file carries their light and dark values for
// GitHub (prefers-color-scheme), and the app draws them with the theme's tokens. Pure.
//
// M6 adds shapes (rectangle, ellipse, arrow: two points, the corners or the ends) and markup:
// the strokes drawn on an image, kept beside the marked-up copy the note shows, with `image`
// naming the original (model/markup.ts).

import getStroke from 'perfect-freehand'
import themes from '../../design/themes/themes.json'

export const INK_COLORS = ['ink', 'blue', 'green', 'amber', 'violet'] as const
export type InkColor = (typeof INK_COLORS)[number]
export const SHAPES = ['rect', 'ellipse', 'arrow'] as const
export type Shape = (typeof SHAPES)[number]
export const INK_TOOLS = ['pen', 'highlighter', ...SHAPES] as const
export type InkTool = (typeof INK_TOOLS)[number]
export const isShape = (tool: string): tool is Shape => (SHAPES as readonly string[]).includes(tool)

export interface Stroke {
  /** Unique within its drawing; two devices' strokes merge by it. */
  id: string
  tool: InkTool
  color: InkColor
  /** The pen's width, in drawing units. */
  size: number
  /** Whether the points carry the pen's pressure; otherwise the shape simulates it. */
  pressure: boolean
  /** x, y and pressure (0–1) of each point, one after the other. */
  points: number[]
}

export interface Ink {
  width: number
  height: number
  strokes: Stroke[]
  /** Markup only: the original image the strokes are drawn on (`assets/…`). */
  image?: string
}

/** Every drawing is this wide, in its own units. */
export const INK_WIDTH = 1000
/** A new drawing's height; it grows as people draw near its bottom. */
export const INK_HEIGHT = 400
export const MAX_HEIGHT = 20000
const MAX_STROKES = 10000
const MAX_POINTS = 20000
/** The pen sizes offered, in drawing units: fine, medium, bold. */
export const INK_SIZES = [2.5, 5, 10] as const
/** A highlighter is this much wider than the pen at the same size, and translucent. */
export const HIGHLIGHTER_SCALE = 4
export const HIGHLIGHTER_OPACITY = 0.35

export const isInkPath = (path: string) => /\.ink\.svg$/i.test(path)

export const emptyInk = (height = INK_HEIGHT): Ink => ({ width: INK_WIDTH, height, strokes: [] })

/** A new stroke id: eight base-36 characters. */
export function strokeId(random: () => number = Math.random): string {
  let id = ''
  for (let i = 0; i < 8; i++) id += Math.floor(random() * 36).toString(36)
  return id
}

const round = (x: number, places: number) => {
  const f = 10 ** places
  const r = Math.round(x * f) / f
  return r === 0 ? 0 : r // never -0
}
const num = (x: number) => String(round(x, 1))

/** The theme's value for a colour name, in light or dark mode, from themes.json. */
export function inkHex(color: InkColor, mode: 'light' | 'dark'): string {
  if (color === 'ink')
    return mode === 'light' ? themes.bases.paper.tokens.text : themes.bases.vanta.tokens.text
  return themes.accents[color][mode]
}

/** The colour as the app draws it: the theme's text, or a named colour (ui/theme.ts). */
export const inkVar = (color: InkColor) => (color === 'ink' ? 'var(--text)' : `var(--c-${color})`)

/** The stroke's drawn width: a highlighter is a broad marker. */
export const strokeWidth = (stroke: Pick<Stroke, 'tool' | 'size'>) =>
  stroke.tool === 'highlighter' ? stroke.size * HIGHLIGHTER_SCALE : stroke.size

/** A shape's sides are followed at a point every this many units. */
const SHAPE_STEP = 6
/** Points of an ellipse's outline, and of an arrow's head. */
const ELLIPSE_STEPS = 72
const ARROW_ANGLE = (28 * Math.PI) / 180

/**
 * The lines a stroke draws, each as x, y pairs: a pen's own points, a rectangle's four sides,
 * an ellipse inside its box, an arrow's shaft and head.
 */
export function lines(stroke: Stroke): number[][] {
  const p = stroke.points
  if (!isShape(stroke.tool) || p.length < 6) {
    const xy: number[] = []
    for (let i = 0; i + 1 < p.length; i += 3) xy.push(p[i]!, p[i + 1]!)
    return [xy]
  }
  const [x0, y0, x1, y1] = [p[0]!, p[1]!, p[3]!, p[4]!]
  if (stroke.tool === 'rect') return [[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]]
  if (stroke.tool === 'ellipse') {
    const [cx, cy, rx, ry] = [
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      Math.abs(x1 - x0) / 2,
      Math.abs(y1 - y0) / 2,
    ]
    const xy: number[] = []
    for (let i = 0; i <= ELLIPSE_STEPS; i++) {
      const a = (i / ELLIPSE_STEPS) * Math.PI * 2
      xy.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
    }
    return [xy]
  }
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const head = Math.min(Math.hypot(x1 - x0, y1 - y0) / 2, Math.max(14, stroke.size * 4))
  const wing = (side: number) => [
    x1 - head * Math.cos(angle + side * ARROW_ANGLE),
    y1 - head * Math.sin(angle + side * ARROW_ANGLE),
  ]
  return [
    [x0, y0, x1, y1],
    [...wing(1), x1, y1, ...wing(-1)],
  ]
}

/** An outline from perfect-freehand as an SVG subpath. */
function subpath(shape: number[][]): string {
  if (!shape.length) return ''
  const d = ['M', num(shape[0]![0]!), num(shape[0]![1]!), 'Q']
  for (let i = 0; i < shape.length; i++) {
    const [x0, y0] = shape[i]!
    const [x1, y1] = shape[(i + 1) % shape.length]!
    d.push(num(x0!), num(y0!), num((x0! + x1!) / 2), num((y0! + y1!) / 2))
  }
  d.push('Z')
  return d.join(' ')
}

/**
 * The stroke's outline as an SVG path: a filled shape whose width follows the pressure; a
 * shape's lines are an even width, with sharp corners.
 */
export function outline(stroke: Stroke): string {
  if (isShape(stroke.tool) && stroke.points.length >= 6) {
    return lines(stroke)
      .map((xy) => {
        // Points every few units along each side: perfect-freehand follows them closely, with
        // sharp corners, where a side given only by its ends would bow.
        const pts: [number, number, number][] = []
        for (let i = 0; i + 1 < xy.length; i += 2) {
          const [x, y] = [xy[i]!, xy[i + 1]!]
          if (i >= 2) {
            const [px, py] = [xy[i - 2]!, xy[i - 1]!]
            const steps = Math.min(200, Math.ceil(Math.hypot(x - px, y - py) / SHAPE_STEP))
            for (let k = 1; k < steps; k++)
              pts.push([px + ((x - px) * k) / steps, py + ((y - py) * k) / steps, 0.5])
          }
          pts.push([x, y, 0.5])
        }
        return subpath(
          getStroke(pts, {
            size: stroke.size,
            thinning: 0,
            smoothing: 0,
            streamline: 0,
            simulatePressure: false,
            last: true,
          }),
        )
      })
      .join(' ')
  }
  const pts: [number, number, number][] = []
  for (let i = 0; i + 2 < stroke.points.length; i += 3)
    pts.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2]!])
  if (!pts.length) return ''
  const highlighter = stroke.tool === 'highlighter'
  return subpath(
    getStroke(pts, {
      size: strokeWidth(stroke),
      thinning: highlighter ? 0 : 0.6,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: !highlighter && !stroke.pressure,
      last: true,
    }),
  )
}

/** A stroke as it is stored: numbers rounded, so reading and writing give the same bytes. */
function cleanStroke(value: unknown): Stroke | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (typeof s.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(s.id)) return null
  const tool = (INK_TOOLS as readonly unknown[]).includes(s.tool) ? (s.tool as InkTool) : 'pen'
  const color = (INK_COLORS as readonly unknown[]).includes(s.color) ? (s.color as InkColor) : 'ink'
  const size = typeof s.size === 'number' && Number.isFinite(s.size) ? s.size : INK_SIZES[1]
  if (!Array.isArray(s.points) || s.points.length % 3 || s.points.length > MAX_POINTS * 3)
    return null
  const points: number[] = []
  for (let i = 0; i < s.points.length; i++) {
    const v = s.points[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    points.push(i % 3 === 2 ? round(Math.min(1, Math.max(0, v)), 2) : round(v, 1))
  }
  if (!points.length) return null
  // A shape is its two points: the corners of its box, or an arrow's ends.
  if (isShape(tool) && points.length !== 6) return null
  return {
    id: s.id,
    tool,
    color,
    size: round(Math.min(100, Math.max(0.5, size)), 1),
    pressure: s.pressure !== false,
    points,
  }
}

/** A drawing from untrusted data (a file, the clipboard): checked and cleaned, or null. */
export function cleanInk(value: unknown): Ink | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.v !== undefined && v.v !== 1) return null
  if (!Array.isArray(v.strokes) || v.strokes.length > MAX_STROKES) return null
  const strokes: Stroke[] = []
  const ids = new Set<string>()
  for (const raw of v.strokes) {
    const stroke = cleanStroke(raw)
    if (!stroke || ids.has(stroke.id)) continue
    ids.add(stroke.id)
    strokes.push(stroke)
  }
  const height =
    typeof v.height === 'number' && Number.isFinite(v.height)
      ? Math.round(Math.min(MAX_HEIGHT, Math.max(50, v.height)))
      : INK_HEIGHT
  // Markup's original: a file of the Family's own, never an address elsewhere.
  const image =
    typeof v.image === 'string' && /^assets\/[^\0\\]+$/.test(v.image) && !v.image.includes('..')
      ? v.image
      : undefined
  return { width: INK_WIDTH, height, strokes, ...(image && { image }) }
}

/** The strokes as JSON that can sit inside XML: `<`, `>` and `&` escaped. */
export function inkJson(ink: Ink): string {
  return JSON.stringify({
    v: 1,
    width: ink.width,
    height: ink.height,
    ...(ink.image && { image: ink.image }),
    strokes: ink.strokes,
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/** Ink from its JSON (the clipboard's copy); null when it isn't ink. */
export function inkFromJson(text: string): Ink | null {
  try {
    return cleanInk(JSON.parse(text))
  } catch {
    return null
  }
}

/** The colour classes, light first, dark for GitHub's dark mode. */
function styleSheet(lightOnly: boolean): string {
  const rules = (mode: 'light' | 'dark') =>
    INK_COLORS.map((c) => `.${c}{fill:${inkHex(c, mode)}}`).join('')
  const light = `${rules('light')}.hl{opacity:${HIGHLIGHTER_OPACITY}}`
  return lightOnly ? light : `${light}@media (prefers-color-scheme:dark){${rules('dark')}}`
}

/**
 * The drawing as the app shows it: inline SVG in the theme's colours, so a theme switch
 * repaints it with no code. Built from checked numbers and names only, never from the file's
 * own markup, so it is safe to put in the page.
 */
export function inkMarkup(ink: Ink, label = 'Drawing'): string {
  const paths = ink.strokes
    .map(
      (s) =>
        `<path data-id="${s.id}" d="${outline(s)}" style="fill:${inkVar(s.color)}${s.tool === 'highlighter' ? `;opacity:${HIGHLIGHTER_OPACITY}` : ''}"/>`,
    )
    .join('')
  const name = label.replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ink-drawing" viewBox="0 0 ${ink.width} ${ink.height}" role="img" aria-label="${name}">${paths}</svg>`
}

/**
 * The file for a drawing: a picture anywhere, and its strokes for Yeraz. `lightOnly` leaves
 * out the dark colours, for a picture copied to another app (always the light theme's).
 */
export function inkToSvg(ink: Ink, { lightOnly = false } = {}): string {
  const paths = ink.strokes
    .map(
      (s) => `<path class="${s.color}${s.tool === 'highlighter' ? ' hl' : ''}" d="${outline(s)}"/>`,
    )
    .join('\n')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ink.width} ${ink.height}" width="${ink.width}" height="${ink.height}">\n` +
    `<metadata id="yeraz-ink">${inkJson(ink)}</metadata>\n` +
    `<style>${styleSheet(lightOnly)}</style>\n` +
    (paths ? `${paths}\n` : '') +
    `</svg>\n`
  )
}

/** The strokes in a drawing's file; null when it isn't one Yeraz wrote (or is damaged). */
export function inkFromSvg(text: string): Ink | null {
  const match = /<metadata id="yeraz-ink">([\s\S]*?)<\/metadata>/.exec(text)
  return match ? inkFromJson(match[1]!) : null
}

const same = (a: Stroke | undefined, b: Stroke | undefined) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * Two devices' edits of one drawing, stroke by stroke: a stroke we left alone takes theirs
 * (changed, or gone); one we drew, changed or erased is ours. A stroke changed on one side and
 * erased on the other is kept: nothing drawn is lost to a merge.
 */
export function mergeInk(base: Ink, ours: Ink, theirs: Ink): Ink {
  const b = new Map(base.strokes.map((s) => [s.id, s]))
  const o = new Map(ours.strokes.map((s) => [s.id, s]))
  const t = new Map(theirs.strokes.map((s) => [s.id, s]))
  const pick = (id: string): Stroke | undefined => {
    const [bs, os, ts] = [b.get(id), o.get(id), t.get(id)]
    if (same(os, bs)) return ts
    if (!os) return same(ts, bs) ? undefined : ts
    return os
  }
  const strokes: Stroke[] = []
  const done = new Set<string>()
  for (const id of [...t.keys(), ...o.keys()]) {
    if (done.has(id)) continue
    done.add(id)
    const s = pick(id)
    if (s) strokes.push(s)
  }
  const height = Math.max(ours.height, theirs.height)
  return { width: INK_WIDTH, height, strokes }
}

/** `mergeInk` on files' texts; null when ours or theirs isn't a drawing. */
export function mergeInkFiles(base: string | null, ours: string, theirs: string): string | null {
  const [o, t] = [inkFromSvg(ours), inkFromSvg(theirs)]
  if (!o || !t) return null
  return inkToSvg(mergeInk((base && inkFromSvg(base)) || emptyInk(0), o, t))
}

// Geometry, for the eraser and the lasso.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The box around strokes' points, widened by their width; null for none. */
export function bounds(strokes: readonly Stroke[]): Box | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of strokes) {
    const r = strokeWidth(s) / 2
    for (const xy of [s.points.filter((_, i) => i % 3 !== 2), ...lines(s)])
      for (let i = 0; i + 1 < xy.length; i += 2) {
        const [x, y] = [xy[i]!, xy[i + 1]!]
        x0 = Math.min(x0, x - r)
        y0 = Math.min(y0, y - r)
        x1 = Math.max(x1, x + r)
        y1 = Math.max(y1, y + r)
      }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The stroke moved by (dx, dy). */
export function moved(stroke: Stroke, dx: number, dy: number): Stroke {
  const points = stroke.points.map((v, i) =>
    i % 3 === 0 ? round(v + dx, 1) : i % 3 === 1 ? round(v + dy, 1) : v,
  )
  return { ...stroke, points }
}

const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const [dx, dy] = [bx - ax, by - ay]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Whether the point (x, y) is within `radius` of the stroke's line. */
export function touches(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + strokeWidth(stroke) / 2
  // Along the lines it draws: a rectangle is touched on its sides, not across its middle.
  for (const p of lines(stroke)) {
    if (p.length === 2 && Math.hypot(x - p[0]!, y - p[1]!) <= reach) return true
    for (let i = 0; i + 3 < p.length; i += 2)
      if (distanceToSegment(x, y, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= reach) return true
  }
  return false
}

/** Whether (x, y) is inside the polygon (x, y pairs one after the other). */
export function inside(polygon: readonly number[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [polygon[i]!, polygon[i + 1]!, polygon[j]!, polygon[j + 1]!]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The strokes the lasso holds: at least half of each stroke's points inside it. */
export function lassoed(strokes: readonly Stroke[], polygon: readonly number[]): string[] {
  if (polygon.length < 6) return []
  return strokes
    .filter((s) => {
      const xy = lines(s).flat()
      let count = 0
      for (let i = 0; i + 1 < xy.length; i += 2) if (inside(polygon, xy[i]!, xy[i + 1]!)) count++
      return count * 2 >= xy.length / 2
    })
    .map((s) => s.id)
}

/** The height the drawing needs: room below its lowest stroke, never less than it has. */
export function heightFor(ink: Ink, room = INK_HEIGHT / 2): number {
  const box = bounds(ink.strokes)
  if (!box) return ink.height
  return Math.min(
    MAX_HEIGHT,
    Math.max(ink.height, Math.ceil((box.y + box.height + room) / 50) * 50),
  )
}

/**
 * Strokes pasted into a drawing: new ids (no clash with what is there), moved so their top
 * left sits at (x, y), the drawing grown to hold them.
 */
export function pasteStrokes(
  ink: Ink,
  strokes: readonly Stroke[],
  at: { x: number; y: number },
  random: () => number = Math.random,
): { ink: Ink; ids: string[] } {
  const box = bounds(strokes)
  if (!box) return { ink, ids: [] }
  const taken = new Set(ink.strokes.map((s) => s.id))
  const ids: string[] = []
  const added = strokes.map((s) => {
    let id = strokeId(random)
    while (taken.has(id)) id = strokeId(random)
    taken.add(id)
    ids.push(id)
    return { ...moved(s, at.x - box.x, at.y - box.y), id }
  })
  const next = { ...ink, strokes: [...ink.strokes, ...added] }
  return { ink: { ...next, height: heightFor(next, 20) }, ids }
}
