import { describe, expect, it } from 'vitest'
import { emptyInk, inkFromJson, inkFromSvg, inkToSvg, type Ink } from '../model/ink'
import {
  clipboardHtml,
  drawingMarkdown,
  inkCache,
  inkLinks,
  withOwnCopies,
  type InkHost,
} from './ink'

const sketch: Ink = {
  ...emptyInk(),
  strokes: [{ id: 'a1', tool: 'pen', color: 'blue', size: 5, pressure: true, points: [1, 2, 0.5] }],
}

/** A host over a map of files, naming new drawings drawing.ink.svg, drawing-2.ink.svg… */
function host(files: Record<string, string> = {}) {
  const saved = new Map(Object.entries(files))
  let n = 0
  const h: InkHost = {
    read: async (path) => saved.get(path) ?? null,
    save: (path, text) => void saved.set(path, text),
    create: () => `assets/drawing${++n > 1 ? `-${n}` : ''}.ink.svg`,
  }
  return { h, saved }
}

describe('drawings in the text', () => {
  it('writes a drawing as an image of its file', () => {
    expect(drawingMarkdown('assets/2026-11-20-drawing.ink.svg')).toBe(
      '![Drawing](/assets/2026-11-20-drawing.ink.svg)',
    )
  })

  it('finds the drawings an image links to, not other images or links', () => {
    const text =
      'A ![Sketch](/assets/a.ink.svg "width=50%") and ![Photo](/assets/b.png) ' +
      '[link](/assets/c.ink.svg) ![Far](https://example.com/d.ink.svg)'
    const links = inkLinks(text)
    expect(links.map((l) => l.path)).toEqual(['assets/a.ink.svg'])
    expect(text.slice(links[0]!.from, links[0]!.to)).toBe('/assets/a.ink.svg')
  })

  it('pastes a copy of each drawing into a file of its own', async () => {
    const { h, saved } = host({ 'assets/a.ink.svg': inkToSvg(sketch) })
    const pasted = await withOwnCopies(h, 'See ![Sketch](/assets/a.ink.svg) here', [])
    expect(pasted).toBe('See ![Sketch](/assets/drawing.ink.svg) here')
    expect(inkFromSvg(saved.get('assets/drawing.ink.svg')!)).toEqual(sketch)
    expect(inkCache(h).get('assets/drawing.ink.svg')).toEqual(sketch)
  })

  it('takes the strokes from the clipboard when the file is in another Family', async () => {
    const { h, saved } = host()
    const pasted = await withOwnCopies(h, '![Sketch](/assets/a.ink.svg)', [
      { path: 'assets/a.ink.svg', ink: sketch },
    ])
    expect(pasted).toBe('![Sketch](/assets/drawing.ink.svg)')
    expect(inkFromSvg(saved.get('assets/drawing.ink.svg')!)).toEqual(sketch)
  })

  it('keeps the link of a drawing it can find nowhere', async () => {
    const { h, saved } = host()
    expect(await withOwnCopies(h, '![Gone](/assets/gone.ink.svg)', [])).toBe(
      '![Gone](/assets/gone.ink.svg)',
    )
    expect(saved.size).toBe(0)
  })

  it('puts the strokes on the clipboard in an image other apps show', () => {
    const html = clipboardHtml([{ path: 'assets/a.ink.svg', ink: sketch }])
    expect(html).toMatch(/^<img alt="Drawing" src="data:image\/svg\+xml;base64,/)
    expect(html).toContain('data-yeraz-path="assets/a.ink.svg"')
    const json = /data-yeraz-ink="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"')
    expect(inkFromJson(json)).toEqual(sketch)
  })
})
