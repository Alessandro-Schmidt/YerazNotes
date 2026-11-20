// Saving what was done in the image viewer (development-plan.md M6): a turn or a flip, and
// markup. Browser only (canvas); loaded with the viewer.
//
// - A JPEG is turned by its EXIF orientation alone: its pixels are kept byte for byte.
// - Any other picture is redrawn turned, losslessly (PNG; WebP where the browser writes it
//   losslessly). A GIF or an SVG turned becomes a PNG, a new file beside it.
// - Markup: the original stays as it is; the note shows a copy with the strokes drawn in
//   (`.marked.png`, or `.marked.jpg` for a photo), and the strokes are kept beside it
//   (`.marked.ink.svg`, with `image` naming the original) to be changed again. No strokes left:
//   the note shows the original again, and the copy and its strokes are deleted.

import { HIGHLIGHTER_OPACITY, inkFromSvg, inkHex, inkToSvg, outline, type Ink } from '../model/ink'
import { isMarked, markedOf, strokesOf, type ImageEdit } from '../model/markup'
import {
  canvasTransform,
  compose,
  exifMatrix,
  exifOf,
  isIdentity,
  jpegOrientation,
  sizeAfter,
  withJpegOrientation,
  type Matrix,
} from '../model/orient'
import { mimeOf, objectUrl } from '../sync/assets'
import type { InkHost } from './ink'
import { MAX_EDGE } from './images'

/** The host with what images need: their bytes, and writing files. */
export type ImageHost = Required<InkHost>

export const canEditImages = (host: InkHost | null): host is ImageHost =>
  !!host?.bytes && !!host.write && !!host.taken

/** A picture ready to draw, upright (its EXIF orientation applied). */
export interface Picture {
  source: CanvasImageSource
  width: number
  height: number
}

/** The picture in `bytes`, upright. */
export async function loadPicture(bytes: Uint8Array, path: string): Promise<Picture> {
  const blob = new Blob([bytes as BlobPart], { type: mimeOf(path) })
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height }
  } catch {
    // An SVG, in browsers that can't make a bitmap of one.
    const img = new Image()
    img.src = objectUrl(bytes, path)
    await img.decode()
    return { source: img, width: img.naturalWidth || 1000, height: img.naturalHeight || 750 }
  }
}

/** A canvas holding the picture with `turn` applied, at most MAX_EDGE on its long side. */
export function turnedCanvas(picture: Picture, turn: Matrix, max = MAX_EDGE): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(picture.width, picture.height))
  const [w, h] = [Math.round(picture.width * scale), Math.round(picture.height * scale)]
  const out = sizeAfter(turn, w, h)
  const canvas = document.createElement('canvas')
  canvas.width = out.width
  canvas.height = out.height
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.setTransform(...canvasTransform(turn, w, h))
  context.drawImage(picture.source, 0, 0, w, h)
  return canvas
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality),
  )
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/** The picture turned: its bytes and the extension they need. */
export async function turnBytes(
  bytes: Uint8Array,
  path: string,
  turn: Matrix,
): Promise<{ bytes: Uint8Array; ext: string }> {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? 'png'
  const current = jpegOrientation(bytes)
  if (current !== null) {
    const kept = withJpegOrientation(bytes, exifOf(compose(turn, exifMatrix(current))))
    if (kept) return { bytes: kept, ext }
  }
  const canvas = turnedCanvas(await loadPicture(bytes, path), turn, Infinity)
  if (current !== null)
    return { bytes: await bytesOf(await encode(canvas, 'image/jpeg', 0.95)), ext }
  if (ext === 'webp') {
    // Chromium writes WebP losslessly at quality 1; elsewhere it becomes a PNG.
    const webp = await encode(canvas, 'image/webp', 1)
    if (webp.type === 'image/webp') return { bytes: await bytesOf(webp), ext }
  }
  return { bytes: await bytesOf(await encode(canvas, 'image/png')), ext: 'png' }
}

/** The strokes drawn into the picture, in the light theme's colours, as the copy shows them. */
export async function bake(picture: Picture, ink: Ink, jpeg: boolean): Promise<Uint8Array> {
  const canvas = turnedCanvas(picture, [
    [1, 0],
    [0, 1],
  ])
  const context = canvas.getContext('2d')!
  const k = canvas.width / ink.width
  context.setTransform(k, 0, 0, k, 0, 0)
  for (const stroke of ink.strokes) {
    context.globalAlpha = stroke.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1
    context.fillStyle = inkHex(stroke.color, 'light')
    context.fill(new Path2D(outline(stroke)))
  }
  const blob = jpeg ? await encode(canvas, 'image/jpeg', 0.92) : await encode(canvas, 'image/png')
  return bytesOf(blob)
}

/** What the viewer opens: the original, and the strokes on it if the note shows a copy. */
export interface Opened {
  /** The original's path. */
  source: string
  bytes: Uint8Array
  picture: Picture
  ink: Ink | null
}

/** The image a note links to, as the viewer edits it: its original, and any markup. */
export async function openImage(host: ImageHost, link: string): Promise<Opened> {
  let source = link
  let ink: Ink | null = null
  if (isMarked(link)) {
    const kept = await host.read(strokesOf(link)).catch(() => null)
    const read = kept ? inkFromSvg(kept) : null
    if (read?.image && (await host.bytes(read.image))) {
      source = read.image
      ink = read
    }
  }
  const bytes = await host.bytes(source)
  if (!bytes) throw new Error(`No file at ${source}`)
  return { source, bytes, picture: await loadPicture(bytes, source), ink }
}

/** `assets/x.webp` → `assets/x.png` (then -2…): the picture under another extension. */
function withExt(path: string, ext: string, taken: (path: string) => boolean): string {
  const base = path.replace(/\.[^./]+$/, '')
  let candidate = `${base}.${ext}`
  for (let n = 2; taken(candidate); n++) candidate = `${base}-${n}.${ext}`
  return candidate
}

/**
 * Saves an edit as pending files (committed with the leaf) and returns the path the note
 * should link to now: the original (turned), or its marked-up copy.
 */
export async function applyEdit(
  host: ImageHost,
  link: string,
  opened: Opened,
  edit: ImageEdit,
): Promise<string> {
  let source = opened.source
  let picture = opened.picture
  if (!isIdentity(edit.turn)) {
    const turned = await turnBytes(opened.bytes, source, edit.turn)
    const ext = /\.([^./]+)$/.exec(source)?.[1]?.toLowerCase()
    if (turned.ext !== ext) source = withExt(source, turned.ext, host.taken)
    await host.write(source, turned.bytes)
    picture = await loadPicture(turned.bytes, source)
  }
  let next = source
  if (edit.ink.strokes.length) {
    next = markedOf(source)
    await host.write(next, await bake(picture, edit.ink, /\.jpe?g$/i.test(next)))
    host.save(strokesOf(next), inkToSvg({ ...edit.ink, image: source }))
  }
  // A copy the note no longer shows goes, with its strokes.
  if (isMarked(link) && link !== next) {
    await host.write(link, null)
    await host.write(strokesOf(link), null)
  }
  return next
}
