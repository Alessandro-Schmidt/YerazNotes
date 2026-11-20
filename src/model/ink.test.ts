import { describe, expect, it } from 'vitest'
import {
  bounds,
  cleanInk,
  emptyInk,
  heightFor,
  inkFromJson,
  inkFromSvg,
  inkJson,
  inkMarkup,
  inkToSvg,
  isInkPath,
  lassoed,
  mergeInk,
  mergeInkFiles,
  moved,
  outline,
  pasteStrokes,
  strokeId,
  touches,
  type Ink,
  type Stroke,
} from './ink'

const stroke = (id: string, points: number[], extra: Partial<Stroke> = {}): Stroke => ({
  id,
  tool: 'pen',
  color: 'ink',
  size: 5,
  pressure: true,
  points,
  ...extra,
})

const line = stroke('a1', [10, 10, 0.5, 50, 20, 0.6, 90, 40, 0.7])
const dot = stroke('b2', [200, 100, 0.5], { color: 'blue', tool: 'highlighter', pressure: false })
const ink = (...strokes: Stroke[]): Ink => ({ ...emptyInk(), strokes })

describe('ink files', () => {
  it('knows its files by name', () => {
    expect(isInkPath('assets/2026-11-20-sketch.ink.svg')).toBe(true)
    expect(isInkPath('assets/2026-11-20-sketch.svg')).toBe(false)
  })

  it('round-trips a drawing byte for byte', () => {
    const file = inkToSvg(ink(line, dot))
    const read = inkFromSvg(file)
    expect(read).toEqual(ink(line, dot))
    expect(inkToSvg(read!)).toBe(file)
  })

  it('is a picture GitHub shows: an SVG with each stroke as a path, light and dark colours', () => {
    const file = inkToSvg(ink(line, dot))
    expect(file).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1000 400"/)
    expect(file.match(/<path /g)).toHaveLength(2)
    expect(file).toContain('class="blue hl"')
    expect(file).toContain('@media (prefers-color-scheme:dark)')
    expect(file).not.toMatch(/<script|on\w+=/i)
  })

  it('draws a single tap as a dot, and a stroke as a closed shape', () => {
    expect(outline(dot)).toMatch(/^M .* Z$/)
    expect(outline(line)).toMatch(/^M .* Z$/)
  })

  it('reads nothing from an SVG Yeraz did not write', () => {
    expect(inkFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBeNull()
    expect(inkFromSvg('<svg><metadata id="yeraz-ink">not json</metadata></svg>')).toBeNull()
  })

  it('cleans what it reads: unknown colours and tools, bad numbers, duplicate ids', () => {
    const cleaned = cleanInk({
      v: 1,
      height: 99999,
      strokes: [
        { id: 'a1', tool: 'spray', color: 'red', size: 900, points: [1.234, 2.345, 3] },
        { id: 'a1', points: [1, 1, 1] },
        { id: 'BAD ID', points: [1, 1, 1] },
        { id: 'c3', points: [1, 'x', 1] },
        { id: 'd4', points: [1, 2] },
        { id: 'e5', points: [] },
      ],
    })
    expect(cleaned).toEqual({
      width: 1000,
      height: 20000,
      strokes: [
        { id: 'a1', tool: 'pen', color: 'ink', size: 100, pressure: true, points: [1.2, 2.3, 1] },
      ],
    })
    expect(cleanInk({ v: 2, strokes: [] })).toBeNull()
    expect(cleanInk('strokes')).toBeNull()
  })

  it('keeps markup out of the metadata', () => {
    const json = inkJson(ink(line))
    expect(json).not.toMatch(/[<>&]/)
    expect(inkFromJson(json)).toEqual(ink(line))
    // A file whose metadata hides a script is read as strokes only, and written without it.
    const evil = `<svg><metadata id="yeraz-ink">{"v":1,"height":400,"strokes":[],"x":"</metadata><script>alert(1)</script>"}</metadata></svg>`
    const read = inkFromSvg(evil)
    if (read) expect(inkToSvg(read)).not.toContain('script')
  })

  it('makes ids of eight letters and digits', () => {
    expect(strokeId()).toMatch(/^[a-z0-9]{8}$/)
  })
})

describe('merging two devices’ drawings', () => {
  const base = ink(line)
  it('keeps both sides’ new strokes', () => {
    const ours = ink(line, stroke('o1', [1, 1, 0.5]))
    const theirs = ink(line, stroke('t1', [2, 2, 0.5]))
    expect(mergeInk(base, ours, theirs).strokes.map((s) => s.id)).toEqual(['a1', 't1', 'o1'])
  })

  it('erases what either side erased', () => {
    expect(mergeInk(base, ink(), ink(line)).strokes).toEqual([])
    expect(mergeInk(base, ink(line), ink()).strokes).toEqual([])
  })

  it('keeps a stroke one side changed and the other erased', () => {
    const recoloured = { ...line, color: 'green' as const }
    expect(mergeInk(base, ink(), ink(recoloured)).strokes).toEqual([recoloured])
    expect(mergeInk(base, ink(recoloured), ink()).strokes).toEqual([recoloured])
  })

  it('takes ours when both changed the same stroke, and the taller height', () => {
    const a = { ...line, color: 'green' as const }
    const b = { ...line, color: 'amber' as const }
    const merged = mergeInk(base, { ...ink(a), height: 600 }, { ...ink(b), height: 800 })
    expect(merged.strokes).toEqual([a])
    expect(merged.height).toBe(800)
  })

  it('merges files, and refuses when one side is not a drawing', () => {
    const ours = inkToSvg(ink(line, stroke('o1', [1, 1, 0.5])))
    const theirs = inkToSvg(ink(line, stroke('t1', [2, 2, 0.5])))
    const merged = inkFromSvg(mergeInkFiles(inkToSvg(base), ours, theirs)!)
    expect(merged?.strokes.map((s) => s.id)).toEqual(['a1', 't1', 'o1'])
    expect(mergeInkFiles(null, ours, theirs)).not.toBeNull()
    expect(mergeInkFiles(null, ours, '<svg/>')).toBeNull()
  })
})

describe('geometry', () => {
  it('finds a stroke near a point, and misses one far away', () => {
    expect(touches(line, 50, 22, 3)).toBe(true)
    expect(touches(line, 50, 80, 3)).toBe(false)
    expect(touches(dot, 205, 100, 1)).toBe(true)
  })

  it('takes the strokes mostly inside a lasso', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100]
    expect(lassoed([line, dot], square)).toEqual(['a1'])
    expect(lassoed([line], [0, 0, 1, 1])).toEqual([])
  })

  it('boxes strokes with their width', () => {
    expect(bounds([line])).toEqual({ x: 7.5, y: 7.5, width: 85, height: 35 })
    expect(bounds([])).toBeNull()
  })

  it('moves a stroke, keeping its pressure', () => {
    expect(moved(line, 5, -5).points).toEqual([15, 5, 0.5, 55, 15, 0.6, 95, 35, 0.7])
  })

  it('grows to keep room below the lowest stroke, never shrinking', () => {
    expect(heightFor(ink(stroke('x', [10, 390, 0.5])))).toBe(600)
    expect(heightFor(ink(line))).toBe(400)
  })

  it('pastes strokes with new ids where asked, growing the drawing', () => {
    let n = 0
    const random = () => (n++ % 36) / 36
    const { ink: next, ids } = pasteStrokes(ink(line), [line], { x: 100, y: 500 }, random)
    expect(ids).toHaveLength(1)
    expect(ids[0]).not.toBe('a1')
    const pasted = next.strokes[1]!
    expect(bounds([pasted])).toMatchObject({ x: 100, y: 500 })
    expect(next.height).toBeGreaterThanOrEqual(540)
  })
})

describe('shown in the app', () => {
  it('draws in the theme’s colours, with no markup from the file', () => {
    const shown = inkMarkup(ink(line, dot), 'Realm <b>')
    expect(shown).toContain('style="fill:var(--text)"')
    expect(shown).toContain('fill:var(--c-blue);opacity:0.35')
    expect(shown).toContain('aria-label="Realm b"')
  })

  it('copies to other apps in the light colours only', () => {
    expect(inkToSvg(ink(line), { lightOnly: true })).not.toContain('prefers-color-scheme')
  })
})
