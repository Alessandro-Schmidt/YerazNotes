// The image viewer (development-plan.md M6): an image on the whole screen, to look at closely
// (zoom, pan, pinch) and, from a note being written, to turn, flip and mark up (inkPad.ts:
// pen, highlighter, shapes, eraser, lasso). Cancel leaves the note as it was; Done saves
// (imageEdit.ts). A lazy chunk, loaded the first time an image is expanded.

import './imageViewer.css'
import { emptyInk, type Ink } from '../model/ink'
import { andThen, markupHeight, noEdit, type ImageEdit } from '../model/markup'
import { FLIP_ACROSS, FLIP_DOWN, TURN_LEFT, TURN_RIGHT, type Matrix } from '../model/orient'
import type { Opened } from './imageEdit'
import { mountPad, type Pad } from './inkPad'

export interface ViewerOptions {
  label: string
  /** The picture as the note shows it, for looking only. */
  url?: string | null
  /** From a note being written: the image to edit, and what Done does with the edit. */
  edit?: {
    open(): Promise<Opened>
    done(opened: Opened, edit: ImageEdit): Promise<void>
  }
}

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6]

const ICONS: Record<string, string> = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M4 9a8 8 0 1 1 2 8"/><path d="M4 4v5h5"/>',
  right: '<path d="M20 9a8 8 0 1 0-2 8"/><path d="M20 4v5h-5"/>',
  across: '<path d="M12 3v18"/><path d="M8 7L3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
  down: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5H7z"/><path d="M7 16l5 5 5-5H7z"/>',
  draw: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  out: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>',
  in: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-4-4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
}
const icon = (name: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

/** The viewer that is open: one at a time. */
let shown: { close(): void } | null = null

export function openViewer(options: ViewerOptions): void {
  shown?.close()
  const before = document.activeElement as HTMLElement | null
  const root = document.createElement('div')
  root.className = 'yz-viewer'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', options.label || 'Image')

  const top = document.createElement('div')
  top.className = 'yz-viewer-top'
  const tools = document.createElement('div')
  tools.className = 'yz-viewer-tools'
  const stage = document.createElement('div')
  stage.className = 'yz-viewer-stage'
  const frame = document.createElement('div')
  frame.className = 'yz-viewer-frame'
  stage.append(frame)
  root.append(top, tools, stage)

  const button = (name: string, label: string, run: () => void, text?: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.viewer = name
    b.setAttribute('aria-label', label)
    b.title = label
    if (text) b.textContent = text
    else b.innerHTML = icon(name)
    b.addEventListener('click', run)
    return b
  }
  const title = document.createElement('span')
  title.className = 'yz-viewer-title'
  title.textContent = options.label

  // Zoom: a share of the size that fits the screen; the stage scrolls when it is larger.
  let zoom = 1
  let size = { width: 4, height: 3 }
  const fit = () => {
    const box = stage.getBoundingClientRect()
    const margin = 32
    return Math.max(
      0.01,
      Math.min((box.width - margin) / size.width, (box.height - margin) / size.height),
    )
  }
  const layout = () => {
    const k = fit() * zoom
    frame.style.width = `${Math.round(size.width * k)}px`
    frame.style.height = `${Math.round(size.height * k)}px`
    root.toggleAttribute('data-zoomed', zoom > 1)
  }
  const zoomTo = (next: number) => {
    const z = Math.min(ZOOMS.at(-1)!, Math.max(ZOOMS[0]!, next))
    if (z === zoom) return
    // The middle of what is seen stays in the middle.
    const [cx, cy] = [
      (stage.scrollLeft + stage.clientWidth / 2) / (stage.scrollWidth || 1),
      (stage.scrollTop + stage.clientHeight / 2) / (stage.scrollHeight || 1),
    ]
    zoom = z
    layout()
    stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2
    stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2
  }
  const step = (by: number) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6)
    zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + by))]!)
  }

  // Pinch with two fingers, and Ctrl/⌘ with the wheel or a trackpad's pinch.
  const fingers = new Map<number, { x: number; y: number }>()
  let pinch: { distance: number; zoom: number } | null = null
  const spread = () => {
    const [a, b] = [...fingers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size === 2) pinch = { distance: spread(), zoom }
  })
  stage.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pinch.distance) zoomTo((pinch.zoom * spread()) / pinch.distance)
  })
  const lift = (e: PointerEvent) => {
    fingers.delete(e.pointerId)
    if (fingers.size < 2) pinch = null
  }
  stage.addEventListener('pointerup', lift)
  stage.addEventListener('pointercancel', lift)
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(zoom * Math.exp(-e.deltaY / 200))
    },
    { passive: false },
  )

  const close = () => {
    pad?.destroy()
    root.remove()
    document.removeEventListener('keydown', keys, true)
    resized.disconnect()
    if (shown === viewer) shown = null
    before?.focus?.({ preventScroll: true })
  }
  const viewer = { close }
  shown = viewer
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if ((e.key === '+' || e.key === '=') && !pad?.drawing) step(1)
    else if (e.key === '-' && !pad?.drawing) step(-1)
  }
  document.addEventListener('keydown', keys, true)
  // The picture fits what is left of the screen: the window resized, the tools shown or hidden.
  const resized = new ResizeObserver(() => layout())
  resized.observe(stage)

  const zoomButtons = [
    button('out', 'Zoom out', () => step(-1)),
    button('fit', 'Fit to screen', () => zoomTo(1)),
    button('in', 'Zoom in', () => step(1)),
  ]
  const closeButton = button('close', options.edit ? 'Cancel' : 'Close', close)
  top.append(closeButton, title, ...zoomButtons)

  let pad: Pad | null = null
  document.body.append(root)

  if (!options.edit) {
    // Looking only: the picture as the note shows it.
    const img = document.createElement('img')
    img.alt = options.label
    img.decoding = 'async'
    img.onload = () => {
      size = { width: img.naturalWidth || 4, height: img.naturalHeight || 3 }
      layout()
    }
    if (options.url) img.src = options.url
    frame.append(img)
    layout()
    closeButton.focus()
    return
  }

  // Editing: the original upright on a canvas, the strokes over it.
  const { edit: host } = options
  root.dataset.edit = ''
  root.setAttribute('aria-busy', 'true')
  const canvas = document.createElement('canvas')
  canvas.className = 'yz-viewer-picture'
  frame.append(canvas)
  const padFrame = document.createElement('span')
  padFrame.className = 'cm-ink'
  frame.append(padFrame)

  let opened: Opened | null = null
  let edit: ImageEdit = noEdit(emptyInk())
  const paintPicture = async (turn: Matrix) => {
    if (!opened) return
    const { turnedCanvas } = await import('./imageEdit')
    // At the screen's size, twice over for sharpness: the original stays as it is.
    const view = turnedCanvas(opened.picture, turn, Math.max(screen.width, screen.height) * 2)
    canvas.width = view.width
    canvas.height = view.height
    canvas.getContext('2d')!.drawImage(view, 0, 0)
    size = { width: view.width, height: view.height }
    layout()
  }
  const turn = (m: Matrix) => {
    if (!opened || !pad) return
    edit = andThen({ ...edit, ink: pad.ink }, m)
    pad.replace(edit.ink)
    void paintPicture(edit.turn)
  }

  const drawButton = button('draw', 'Draw', () => {
    if (!pad) return
    if (pad.drawing) pad.close()
    else pad.open()
    drawButton.setAttribute('aria-pressed', String(pad.drawing))
    root.toggleAttribute('data-drawing', pad.drawing)
  })
  drawButton.setAttribute('aria-pressed', 'false')
  const done = button('done', 'Done', () => void finish(), 'Done')
  done.className = 'yz-viewer-done'
  top.append(
    button('left', 'Turn left', () => turn(TURN_LEFT)),
    button('right', 'Turn right', () => turn(TURN_RIGHT)),
    button('across', 'Flip horizontally', () => turn(FLIP_ACROSS)),
    button('down', 'Flip vertically', () => turn(FLIP_DOWN)),
    drawButton,
    done,
  )
  for (const b of top.querySelectorAll<HTMLButtonElement>('button')) b.disabled = b !== closeButton

  const finish = async () => {
    if (!opened || !pad) return
    for (const b of top.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true
    done.textContent = 'Saving…'
    try {
      await host.done(opened, { turn: edit.turn, ink: pad.ink })
      close()
    } catch (error) {
      for (const b of top.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false
      done.textContent = 'Done'
      window.alert(`The image couldn’t be saved: ${(error as Error).message}`)
    }
  }

  void host.open().then(
    async (o) => {
      opened = o
      const { width, height } = o.picture
      const ink: Ink = o.ink ?? emptyInk(markupHeight(width, height))
      edit = noEdit(ink)
      await paintPicture(edit.turn)
      pad = mountPad(padFrame, {
        label: `Marks on ${options.label || 'the image'}`,
        initial: ink,
        save: () => undefined, // kept until Done
        onImage: true,
      })
      // The pad's tools sit in the viewer's second row, shown while drawing.
      const bar = padFrame.querySelector('.cm-ink-bar')
      if (bar) tools.append(bar)
      for (const b of top.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false
      root.removeAttribute('aria-busy')
      done.focus()
    },
    (error) => {
      title.textContent = `${options.label} couldn’t be opened: ${(error as Error).message}`
      root.removeAttribute('aria-busy')
    },
  )
  layout()
  closeButton.focus()
}
