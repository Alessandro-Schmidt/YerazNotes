// Ink in the editor (development-plan.md M5): a drawing is an image whose file ends in
// `.ink.svg` (model/ink.ts), shown as a block between paragraphs and drawn on in place
// (inkPad.ts, loaded the first time a drawing is shown). Here: what the page provides (reading
// and saving the files), inserting a new drawing, and copying and pasting drawings, so a copy
// is always a file of its own and never changes the original.

import { type EditorState, Facet, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  emptyInk,
  inkFromJson,
  inkFromSvg,
  inkJson,
  inkToSvg,
  isInkPath,
  type Ink,
} from '../model/ink'
import { destination } from '../model/links'
import { META, ownPath } from '../model/parse'

/** What the page does for drawings: read a file's text, save one as a pending edit, name a new one. */
export interface InkHost {
  read(path: string): Promise<string | null>
  save(path: string, text: string): void
  /** A free path in `assets/` for a new drawing. */
  create(): string
}

export const inkHost = Facet.define<InkHost, InkHost | null>({
  combine: (values) => values[0] ?? null,
})

/** The drawings this page has read or written, per host: shown and copied without waiting. */
const known = new WeakMap<InkHost, Map<string, Ink>>()
export function inkCache(host: InkHost): Map<string, Ink> {
  let cache = known.get(host)
  if (!cache) known.set(host, (cache = new Map()))
  return cache
}

/** The drawing in a file; an empty one when the file is missing or isn't a drawing. */
export async function readInk(host: InkHost, path: string): Promise<Ink> {
  const cache = inkCache(host)
  const cached = cache.get(path)
  if (cached) return cached
  const text = await host.read(path).catch(() => null)
  const ink = (text && inkFromSvg(text)) || emptyInk()
  // A drawing written meanwhile (on this page) wins over what was read.
  return cache.get(path) ?? (cache.set(path, ink), ink)
}

export function writeInk(host: InkHost, path: string, ink: Ink): void {
  inkCache(host).set(path, ink)
  host.save(path, inkToSvg(ink))
}

/** A drawing just inserted opens for drawing as soon as it is shown. */
export const toOpen = new WeakMap<EditorView, string>()

export const drawingMarkdown = (path: string, alt = 'Drawing') =>
  `![${alt.replace(/[[\]\\]/g, '')}](${destination(path)})`

/** `text` on the cursor's empty line, or on a line of its own below it (and below line 2's metadata). */
function blockAt(state: EditorState, text: string): TransactionSpec {
  let line = state.doc.lineAt(state.selection.main.head)
  if (line.number === 1 && state.doc.lines > 1 && META.test(state.doc.line(2).text))
    line = state.doc.line(2)
  const empty = line.number > 2 && !line.text.trim()
  // A blank line before it, or Markdown would take it as part of the paragraph above.
  const above = empty && state.doc.line(line.number - 1).text.trim() ? '\n' : ''
  const insert = empty ? `${above}${text}\n` : `\n\n${text}\n`
  const from = empty ? line.from : line.to
  return {
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  }
}

/** A new drawing at the cursor, opened for drawing; false when the page has no drawings. */
export function insertDrawing(view: EditorView, ink: Ink = emptyInk(), open = true): boolean {
  const host = view.state.facet(inkHost)
  if (!host) return false
  const path = host.create()
  writeInk(host, path, ink)
  if (open) toOpen.set(view, path)
  view.dispatch(blockAt(view.state, drawingMarkdown(path)))
  return true
}

// The clipboard. A drawing goes on it three ways: its strokes (for Yeraz, in an HTML image's
// attribute, so they survive between Families and windows), as a picture for other apps (the
// same image, and a PNG where the browser allows), and as text for plain-text fields.

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
const attr = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export interface Copied {
  /** The file it came from, when it is a whole drawing copied with the text. */
  path: string | null
  ink: Ink
}

/** The HTML for drawings on the clipboard. */
export function clipboardHtml(copied: readonly Copied[]): string {
  return copied
    .map(
      ({ path, ink }) =>
        `<img alt="Drawing" src="data:image/svg+xml;base64,${toBase64(inkToSvg(ink, { lightOnly: true }))}" data-yeraz-ink="${attr(inkJson(ink))}"${path ? ` data-yeraz-path="${attr(path)}"` : ''}>`,
    )
    .join('')
}

/** The drawings in pasted HTML (parsed inert: nothing in it runs). */
export function inksInHtml(html: string): Copied[] {
  if (!html.includes('data-yeraz-ink')) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('img[data-yeraz-ink]')].flatMap((img) => {
    const ink = inkFromJson(img.getAttribute('data-yeraz-ink') ?? '')
    return ink ? [{ path: img.getAttribute('data-yeraz-path'), ink }] : []
  })
}

/** What plain-text fields get for a drawing copied alone. */
export const COPIED_TEXT = '✍️ Drawing'

/** The last drawing copied here: pasting works even where the browser drops the HTML. */
let lastCopied: Ink | null = null
export const copiedHere = () => lastCopied

/** A picture of the drawing for other apps; null where it can't be drawn. */
async function picture(ink: Ink): Promise<Blob> {
  const image = new Image()
  image.src = `data:image/svg+xml;base64,${toBase64(inkToSvg(ink, { lightOnly: true }))}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = ink.width
  canvas.height = ink.height
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/png'),
  )
}

/** Puts a drawing (or the strokes chosen in it) on the clipboard. */
export async function copyInk(ink: Ink): Promise<void> {
  lastCopied = ink
  const html = clipboardHtml([{ path: null, ink }])
  const blob = (text: string, type: string) => new Blob([text], { type })
  try {
    if (typeof ClipboardItem === 'undefined') throw new Error('No ClipboardItem')
    const items: Record<string, Blob | Promise<Blob>> = {
      'text/html': blob(html, 'text/html'),
      'text/plain': blob(COPIED_TEXT, 'text/plain'),
    }
    if (ClipboardItem.supports?.('image/png') !== false) items['image/png'] = picture(ink)
    await navigator.clipboard.write([new ClipboardItem(items)])
  } catch {
    // Without the picture (a browser that refuses it): the strokes and the text.
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob(html, 'text/html'),
          'text/plain': blob(COPIED_TEXT, 'text/plain'),
        }),
      ])
    } catch {
      await navigator.clipboard?.writeText(COPIED_TEXT).catch(() => undefined)
    }
  }
}

const INK_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^\s()]+)(\s+"[^"]*")?\s*\)/g

/** The own drawings an image link in `text` points to, with where each link's address is. */
export function inkLinks(text: string): { path: string; from: number; to: number }[] {
  const out: { path: string; from: number; to: number }[] = []
  for (const m of text.matchAll(INK_IMAGE)) {
    const path = ownPath(m[2]!)
    if (path === null || !isInkPath(path)) continue
    const from = m.index + m[0].indexOf(m[2]!, m[1]!.length + 3)
    out.push({ path, from, to: from + m[2]!.length })
  }
  return out
}

/**
 * Pasted text with every drawing it links to copied into a file of its own, so the copy and
 * the original never change each other. The strokes come from the clipboard (another Family)
 * or this Family's file; a drawing found in neither keeps its link.
 */
export async function withOwnCopies(
  host: InkHost,
  text: string,
  copied: readonly Copied[],
): Promise<string> {
  let out = ''
  let at = 0
  for (const link of inkLinks(text)) {
    const ink =
      copied.find((c) => c.path === link.path)?.ink ??
      (await host
        .read(link.path)
        .catch(() => null)
        .then((t) => (t ? inkFromSvg(t) : null)))
    if (!ink) continue
    const path = host.create()
    writeInk(host, path, ink)
    out += text.slice(at, link.from) + destination(path)
    at = link.to
  }
  return out + text.slice(at)
}

/** Copying text that holds drawings also copies their strokes, for pasting in another Family. */
function copyHandler(event: ClipboardEvent, view: EditorView): boolean {
  const host = view.state.facet(inkHost)
  const { from, to } = view.state.selection.main
  if (!host || from === to || !event.clipboardData) return false
  const text = view.state.sliceDoc(from, to)
  const links = inkLinks(text)
  if (!links.length) return false
  const cache = inkCache(host)
  const copied = links.flatMap(({ path }) => {
    const ink = cache.get(path)
    return ink ? [{ path, ink }] : []
  })
  event.clipboardData.setData('text/plain', text)
  if (copied.length) event.clipboardData.setData('text/html', clipboardHtml(copied))
  event.preventDefault()
  if (event.type === 'cut') view.dispatch({ changes: { from, to }, userEvent: 'delete.cut' })
  return true
}

/** Pasting: drawings in the text become copies; a drawing copied alone becomes a new block. */
function pasteHandler(event: ClipboardEvent, view: EditorView): boolean {
  const host = view.state.facet(inkHost)
  const data = event.clipboardData
  if (!host || !data || data.files.length) return false
  const text = data.getData('text/plain')
  const copied = inksInHtml(data.getData('text/html'))
  const links = inkLinks(text)
  const alone = !links.length && (copied[0]?.ink ?? (text === COPIED_TEXT ? copiedHere() : null))
  if (!links.length && !alone) return false
  event.preventDefault()
  if (alone) {
    insertDrawing(view, alone, false)
    return true
  }
  void withOwnCopies(host, text, copied).then((pasted) => {
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: pasted },
      selection: { anchor: from + pasted.length },
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
  })
  return true
}

export const inkClipboard = EditorView.domEventHandlers({
  copy: copyHandler,
  cut: copyHandler,
  paste: pasteHandler,
})
