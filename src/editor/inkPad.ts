// Drawing on a drawing (development-plan.md M5), and markup on an image in the viewer (M6): pen,
// highlighter, rectangle, ellipse, arrow, eraser and lasso, five colours, three sizes, undo and
// redo. A lazy chunk, loaded the first time a drawing or the viewer is shown.
//
// - A pen draws with its pressure; a finger or a mouse draws too, until a pen has been used
//   on this page: from then on a finger scrolls and a palm resting on the screen draws nothing.
// - Every event the pen sent is used (getCoalescedEvents), and the stroke in progress is
//   redrawn once a frame.
// - Each change is handed to `save` shortly after (a drawing: a pending file, committed with
//   the leaf; markup: the viewer, until Done).
// - A drawing is inline SVG in the theme's colours (inkVar): a theme switch costs nothing.
//   Markup on an image keeps the light theme's colours (inkHex), as the copy is drawn.

import './ink.css'
import {
  bounds,
  emptyInk,
  heightFor,
  HIGHLIGHTER_OPACITY,
  INK_COLORS,
  INK_SIZES,
  inkHex,
  inkVar,
  isShape,
  lassoed,
  moved,
  outline,
  pasteStrokes,
  strokeId,
  touches,
  type Ink,
  type InkColor,
  type Shape,
  type Stroke,
} from '../model/ink'
import { clipboardHtml, COPIED_TEXT, copiedHere, copyInk, inksInHtml } from './ink'

export type Tool = 'pen' | 'highlighter' | Shape | 'eraser' | 'lasso'

const SVG = 'http://www.w3.org/2000/svg'
/** How soon after a change it is saved as a pending edit. */
const SAVE_MS = 400
/** The eraser's reach, in drawing units. */
const ERASER = 12
const MAX_UNDO = 200

/** The pen's settings, the same for every drawing on the page: the last chosen stays. */
const settings: { tool: Tool; color: InkColor; size: number } = {
  tool: 'pen',
  color: 'ink',
  size: INK_SIZES[1],
}
/** A pen was used on this page: from then on a finger scrolls (palm rejection). */
let seenPen = false
/** The drawing open for drawing: one at a time. */
let active: Pad | null = null

export interface Pad {
  open(): void
  close(): void
  /** Copies the drawing (or the lasso's strokes) to the clipboard. */
  copy(): Promise<void>
  destroy(): void
  readonly drawing: boolean
  /** The strokes as they are now. */
  readonly ink: Ink
  /** Replaces the strokes (an image turned in the viewer): Undo starts again from here. */
  replace(ink: Ink): void
}

export interface PadOptions {
  label: string
  /** The drawing, when it is known at once. */
  initial?: Ink | undefined
  /** Reads it otherwise. */
  load?: (() => Promise<Ink>) | undefined
  /** Each change, shortly after it is made. */
  save(ink: Ink): void
  /** Escape was pressed while drawing: back to the text. */
  onEscape?: (() => void) | undefined
  /**
   * Markup on an image, in the viewer: its height is the picture's, its colours stay as the
   * copy is drawn, and the viewer opens and closes it (no tapping to open, no Done).
   */
  onImage?: boolean | undefined
}

const ICONS: Record<string, string> = {
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  highlighter: '<path d="M9 15l-4 4h6l2-2"/><path d="M9 15l7-11 4 3-7 11z"/>',
  eraser: '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-7 7H8z"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  lasso:
    '<ellipse cx="12" cy="10" rx="8" ry="5" stroke-dasharray="3 2.5"/><path d="M7 14c-1 3 1 5 3 5"/>',
  undo: '<path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 1 3 6"/>',
  redo: '<path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 0-3 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  delete: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
}
const icon = (name: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

const LABELS: Record<Tool, string> = {
  pen: 'Pen',
  highlighter: 'Highlighter',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  eraser: 'Eraser',
  lasso: 'Lasso',
}
const COLOUR_NAMES: Record<InkColor, string> = {
  ink: 'Ink',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  violet: 'Violet',
}
const SIZE_NAMES = ['Fine', 'Medium', 'Bold']

/** What scrolls the page around the drawing. */
function scroller(el: HTMLElement): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight)
      return p
  }
  return document.scrollingElement ?? document.documentElement
}

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K) =>
  document.createElementNS(SVG, name) as SVGElementTagNameMap[K]

/** A shape smaller than this (in units) was a tap, not a shape. */
const MIN_SHAPE = 4

export function mountPad(frame: HTMLElement, options: PadOptions): Pad {
  const { label, onImage } = options
  /** Markup keeps the colours its copy is drawn in; a drawing follows the theme. */
  const colour = (c: InkColor) => (onImage ? inkHex(c, 'light') : inkVar(c))
  const paint = (el: SVGPathElement, stroke: Stroke) => {
    el.setAttribute('d', outline(stroke))
    el.style.fill = colour(stroke.color)
    el.style.opacity = stroke.tool === 'highlighter' ? String(HIGHLIGHTER_OPACITY) : ''
  }
  let ink: Ink = options.initial ?? emptyInk()
  const undo: Ink[] = []
  let redo: Ink[] = []
  let selected = new Set<string>()
  let drawing = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const svg = svgEl('svg')
  svg.classList.add('cm-ink-svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', label || 'Drawing')
  const layer = svgEl('g')
  const live = svgEl('path')
  live.classList.add('cm-ink-live')
  const lassoLine = svgEl('path')
  lassoLine.classList.add('cm-ink-lasso')
  const box = svgEl('rect')
  box.classList.add('cm-ink-box')
  svg.append(layer, live, lassoLine, box)
  frame.prepend(svg)

  const drawn = new Map<string, { stroke: Stroke; el: SVGPathElement }>()
  function draw() {
    svg.setAttribute('viewBox', `0 0 ${ink.width} ${ink.height}`)
    frame.style.setProperty('--ink-ratio', `${ink.width} / ${ink.height}`)
    const ids = new Set(ink.strokes.map((s) => s.id))
    for (const [id, d] of drawn)
      if (!ids.has(id)) {
        d.el.remove()
        drawn.delete(id)
      }
    ink.strokes.forEach((stroke, i) => {
      let d = drawn.get(stroke.id)
      if (!d || d.stroke !== stroke) {
        const el = d?.el ?? svgEl('path')
        el.dataset.id = stroke.id
        paint(el, stroke)
        d = { stroke, el }
        drawn.set(stroke.id, d)
      }
      if (layer.children[i] !== d.el) layer.insertBefore(d.el, layer.children[i] ?? null)
      d.el.classList.toggle('cm-ink-chosen', selected.has(stroke.id))
    })
    const chosen = bounds(ink.strokes.filter((s) => selected.has(s.id)))
    box.style.display = chosen ? '' : 'none'
    if (chosen) {
      const pad = 8
      box.setAttribute('x', String(chosen.x - pad))
      box.setAttribute('y', String(chosen.y - pad))
      box.setAttribute('width', String(chosen.width + pad * 2))
      box.setAttribute('height', String(chosen.height + pad * 2))
    }
    frame.toggleAttribute('data-chosen', !!chosen)
    frame.toggleAttribute('data-empty', !ink.strokes.length)
    bar.querySelector<HTMLButtonElement>('[data-ink="undo"]')!.disabled = !undo.length
    bar.querySelector<HTMLButtonElement>('[data-ink="redo"]')!.disabled = !redo.length
  }

  function save() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = null
    if (!dirty) return
    dirty = false
    options.save(ink)
  }
  const later = () => {
    dirty = true
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_MS)
  }

  /** A change that Undo takes back: `from` is the drawing before it. */
  function commit(next: Ink, from: Ink = ink) {
    if (next === from) return
    undo.push(from)
    if (undo.length > MAX_UNDO) undo.shift()
    redo = []
    // A drawing grows as people draw near its bottom; markup is as tall as its picture.
    ink = onImage ? next : { ...next, height: heightFor(next) }
    draw()
    later()
  }
  function step(back: boolean) {
    const from = back ? undo : redo
    const to = back ? redo : undo
    const next = from.pop()
    if (!next) return
    to.push(ink)
    ink = next
    selected = new Set([...selected].filter((id) => ink.strokes.some((s) => s.id === id)))
    draw()
    later()
  }
  const chosenStrokes = () => ink.strokes.filter((s) => selected.has(s.id))
  function changeChosen(edit: (s: Stroke) => Stroke) {
    commit({ ...ink, strokes: ink.strokes.map((s) => (selected.has(s.id) ? edit(s) : s)) })
  }
  function deleteChosen() {
    if (!selected.size) return
    commit({ ...ink, strokes: ink.strokes.filter((s) => !selected.has(s.id)) })
    selected = new Set()
    draw()
  }
  function choose(ids: Iterable<string>) {
    selected = new Set(ids)
    draw()
  }

  // The bar: tools, colours, sizes, undo and redo, what to do with the lasso's strokes, Done.
  const bar = document.createElement('div')
  bar.className = 'cm-ink-bar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Drawing tools')
  const button = (name: string, text: string, run: () => void, html?: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', text)
    b.title = text
    if (html !== undefined) b.innerHTML = html
    else b.textContent = text
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      run()
      updateBar()
    })
    b.dataset.ink = name
    bar.append(b)
    return b
  }
  const group = () =>
    bar.append(Object.assign(document.createElement('span'), { className: 'cm-ink-sep' }))
  for (const tool of ['pen', 'highlighter', 'rect', 'ellipse', 'arrow', 'eraser', 'lasso'] as const)
    button(
      `tool-${tool}`,
      LABELS[tool],
      () => {
        settings.tool = tool
        if (tool !== 'lasso') choose([])
      },
      icon(tool),
    )
  group()
  for (const color of INK_COLORS) {
    const b = button(
      `color-${color}`,
      COLOUR_NAMES[color],
      () => {
        settings.color = color
        if (selected.size) changeChosen((s) => ({ ...s, color }))
        else if (settings.tool === 'eraser' || settings.tool === 'lasso') settings.tool = 'pen'
      },
      '<span class="cm-ink-swatch" aria-hidden="true"></span>',
    )
    b.querySelector<HTMLElement>('span')!.style.background = colour(color)
  }
  group()
  INK_SIZES.forEach((size, i) => {
    const b = button(
      `size-${i}`,
      SIZE_NAMES[i]!,
      () => {
        settings.size = size
        if (selected.size) changeChosen((s) => ({ ...s, size }))
      },
      '<span class="cm-ink-dot" aria-hidden="true"></span>',
    )
    b.querySelector<HTMLElement>('span')!.style.setProperty('--dot', `${4 + i * 4}px`)
  })
  group()
  button('undo', 'Undo', () => step(true), icon('undo'))
  button('redo', 'Redo', () => step(false), icon('redo'))
  button('copy', 'Copy', () => void pad.copy(), icon('copy'))
  button('delete', 'Delete strokes', deleteChosen, icon('delete'))
  bar.append(Object.assign(document.createElement('span'), { className: 'cm-ink-gap' }))
  if (!onImage) button('done', 'Done', () => pad.close())
  // Above the drawing, staying in view while a tall one scrolls (Editor.module.css).
  frame.prepend(bar)

  function updateBar() {
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-ink]')) {
      const name = b.dataset.ink!
      const on =
        name === `tool-${settings.tool}` ||
        name === `color-${settings.color}` ||
        name === `size-${INK_SIZES.indexOf(settings.size as never)}`
      if (name.includes('-')) b.setAttribute('aria-pressed', String(on))
    }
    frame.dataset.tool = settings.tool
  }

  // Drawing.
  let pointer: number | null = null
  let stroke: Stroke | null = null
  let lasso: number[] | null = null
  let dragging: { x: number; y: number; from: Ink } | null = null
  let erasing: Ink | null = null
  let scrolling: { id: number; y: number } | null = null
  let frameAsked = false

  const at = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect()
    const k = ink.width / (r.width || 1)
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]
  }
  const pressureOf = (e: PointerEvent) =>
    e.pointerType === 'pen' ? Math.max(0.05, Math.min(1, e.pressure || 0.5)) : 0.5
  const repaint = () => {
    if (frameAsked) return
    frameAsked = true
    requestAnimationFrame(() => {
      frameAsked = false
      live.setAttribute('d', stroke ? outline(stroke) : '')
      if (stroke) {
        live.style.fill = colour(stroke.color)
        live.style.opacity = stroke.tool === 'highlighter' ? String(HIGHLIGHTER_OPACITY) : ''
      }
      lassoLine.setAttribute('d', lasso ? `M ${lasso.join(' ')} Z` : '')
    })
  }
  function eraseAt(x: number, y: number) {
    const left = ink.strokes.filter((s) => !touches(s, x, y, ERASER))
    if (left.length === ink.strokes.length) return
    ink = { ...ink, strokes: left }
    draw()
  }

  svg.addEventListener('pointerdown', (e) => {
    if (!drawing) return
    if (e.pointerType === 'pen') seenPen = true
    // A finger once a pen was used, or while the pen is down: it scrolls, it never draws.
    if (e.pointerType === 'touch' && (seenPen || pointer !== null)) {
      scrolling = { id: e.pointerId, y: e.clientY }
      return
    }
    if (pointer !== null || e.button > 0) return
    e.preventDefault()
    try {
      svg.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the browser doesn't know (synthetic events): moves still reach the drawing.
    }
    pointer = e.pointerId
    const [x, y] = at(e)
    const tool = settings.tool
    if (isShape(tool)) {
      if (selected.size) choose([])
      stroke = {
        id: strokeId(),
        tool,
        color: settings.color,
        size: settings.size,
        pressure: false,
        points: [x, y, 0.5],
      }
      while (ink.strokes.some((s) => s.id === stroke!.id)) stroke.id = strokeId()
    } else if (tool === 'pen' || tool === 'highlighter') {
      if (selected.size) choose([])
      stroke = {
        id: strokeId(),
        tool,
        color: settings.color,
        size: settings.size,
        pressure: e.pointerType === 'pen',
        points: [x, y, pressureOf(e)],
      }
      while (ink.strokes.some((s) => s.id === stroke!.id)) stroke.id = strokeId()
      repaint()
    } else if (tool === 'eraser') {
      erasing = ink
      eraseAt(x, y)
    } else {
      const chosen = bounds(chosenStrokes())
      const pad = 8
      if (
        chosen &&
        x >= chosen.x - pad &&
        x <= chosen.x + chosen.width + pad &&
        y >= chosen.y - pad &&
        y <= chosen.y + chosen.height + pad
      )
        dragging = { x, y, from: ink }
      else {
        choose([])
        lasso = [x, y]
      }
    }
  })
  svg.addEventListener('pointermove', (e) => {
    if (scrolling && e.pointerId === scrolling.id) {
      scroller(frame).scrollBy(0, scrolling.y - e.clientY)
      scrolling.y = e.clientY
      return
    }
    if (e.pointerId !== pointer) return
    const events = e.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e]) {
      const [x, y] = at(ev)
      // A shape is its first point and where the pointer is now.
      if (stroke && isShape(stroke.tool)) stroke.points = [...stroke.points.slice(0, 3), x, y, 0.5]
      else if (stroke) stroke.points.push(x, y, pressureOf(ev))
      else if (erasing) eraseAt(x, y)
      else if (lasso) lasso.push(x, y)
    }
    if (dragging) {
      const [x, y] = at(e)
      const [dx, dy] = [x - dragging.x, y - dragging.y]
      ink = {
        ...dragging.from,
        strokes: dragging.from.strokes.map((s) => (selected.has(s.id) ? moved(s, dx, dy) : s)),
      }
      draw()
    }
    repaint()
  })
  const end = (e: PointerEvent) => {
    if (scrolling && e.pointerId === scrolling.id) scrolling = null
    if (e.pointerId !== pointer) return
    pointer = null
    if (stroke) {
      const done = stroke
      stroke = null
      const p = done.points
      const tiny =
        isShape(done.tool) && (p.length < 6 || Math.hypot(p[3]! - p[0]!, p[4]! - p[1]!) < MIN_SHAPE)
      if (!tiny) commit({ ...ink, strokes: [...ink.strokes, done] })
    } else if (erasing) {
      const from = erasing
      erasing = null
      if (ink !== from) {
        const after = ink
        ink = from
        commit(after, from)
      }
    } else if (lasso) {
      const polygon = lasso
      lasso = null
      choose(lassoed(ink.strokes, polygon))
    } else if (dragging) {
      const from = dragging.from
      dragging = null
      if (ink !== from) {
        const after = ink
        ink = from
        commit(after, from)
      }
    }
    repaint()
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
  // iPadOS: a pen's touch must not start a scroll or a text selection.
  svg.addEventListener(
    'touchstart',
    (e) => {
      if (
        drawing &&
        [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
      )
        e.preventDefault()
    },
    { passive: false },
  )

  // Tapping a drawing opens it; tapping anywhere else closes it.
  frame.addEventListener('click', (e) => {
    if (!onImage && !drawing && !(e.target as Element).closest('.cm-more')) pad.open()
  })
  const outside = (e: PointerEvent) => {
    const target = e.target as Node
    if (!frame.contains(target) && !(target as Element).closest?.('.cm-tooltip')) pad.close()
  }

  frame.tabIndex = -1
  frame.addEventListener('keydown', (e) => {
    if (!drawing) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z') step(!e.shiftKey)
    else if (mod && key === 'y') step(false)
    else if (mod && key === 'a') {
      settings.tool = 'lasso'
      choose(ink.strokes.map((s) => s.id))
      updateBar()
    } else if (e.key === 'Escape' && !onImage) {
      pad.close()
      options.onEscape?.()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) deleteChosen()
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  const copyEvent = (e: ClipboardEvent) => {
    if (!drawing || !e.clipboardData) return
    const strokes = selected.size ? chosenStrokes() : ink.strokes
    e.clipboardData.setData('text/html', clipboardHtml([{ path: null, ink: { ...ink, strokes } }]))
    e.clipboardData.setData('text/plain', COPIED_TEXT)
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'cut' && selected.size) deleteChosen()
  }
  frame.addEventListener('copy', copyEvent)
  frame.addEventListener('cut', copyEvent)
  frame.addEventListener('paste', (e) => {
    if (!drawing || !e.clipboardData) return
    const text = e.clipboardData.getData('text/plain')
    const pasted =
      inksInHtml(e.clipboardData.getData('text/html'))[0]?.ink ??
      (text === COPIED_TEXT ? copiedHere() : null)
    e.preventDefault()
    e.stopPropagation()
    if (pasted) paste(pasted)
  })
  /** Strokes copied from any drawing, pasted a little lower than where they were. */
  function paste(from: Ink) {
    const place = bounds(from.strokes)
    if (!place) return
    const { ink: next, ids } = pasteStrokes(ink, from.strokes, { x: place.x + 20, y: place.y + 20 })
    settings.tool = 'lasso'
    commit(next)
    choose(ids)
    updateBar()
  }

  const pad: Pad = {
    get drawing() {
      return drawing
    },
    open() {
      if (drawing) return
      if (active && active !== pad) active.close()
      active = pad
      drawing = true
      frame.dataset.drawing = ''
      if (!onImage) document.addEventListener('pointerdown', outside, true)
      updateBar()
      frame.focus({ preventScroll: true })
    },
    close() {
      if (!drawing) return
      drawing = false
      if (active === pad) active = null
      delete frame.dataset.drawing
      document.removeEventListener('pointerdown', outside, true)
      choose([])
      save()
    },
    async copy() {
      const strokes = selected.size ? chosenStrokes() : ink.strokes
      await copyInk({ ...ink, strokes })
    },
    destroy() {
      pad.close()
      save()
    },
    get ink() {
      return ink
    },
    replace(next) {
      ink = next
      undo.length = 0
      redo = []
      selected = new Set()
      draw()
      later()
    },
  }

  draw()
  updateBar()
  if (!options.initial && options.load)
    void options.load().then((read) => {
      if (undo.length || dirty) return // drawn on meanwhile: what is drawn stays
      ink = read
      draw()
    })
  return pad
}
