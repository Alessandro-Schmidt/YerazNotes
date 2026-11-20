// Turning and flipping an image (development-plan.md M6) without losing anything. Pure.
//
// An orientation is one of the eight a picture can have (EXIF's 1–8): a 2×2 matrix of 0s and
// ±1s acting on screen coordinates centred on the picture (y down). Turning or flipping is a
// matrix multiplied in front. A JPEG keeps its pixels and only its EXIF orientation changes,
// so it is never compressed again; other images are redrawn turned, losslessly (editor/imageEdit.ts).

/** [[a, b], [c, d]]: (x, y) → (a·x + b·y, c·x + d·y). */
export type Matrix = readonly [readonly [number, number], readonly [number, number]]

export const IDENTITY: Matrix = [
  [1, 0],
  [0, 1],
]
/** A quarter turn clockwise, as the screen shows it (y down). */
export const TURN_RIGHT: Matrix = [
  [0, -1],
  [1, 0],
]
export const TURN_LEFT: Matrix = [
  [0, 1],
  [-1, 0],
]
export const FLIP_ACROSS: Matrix = [
  [-1, 0],
  [0, 1],
]
export const FLIP_DOWN: Matrix = [
  [1, 0],
  [0, -1],
]

/** EXIF's orientation values, each as the matrix that shows the stored pixels upright. */
const EXIF: Record<number, Matrix> = {
  1: IDENTITY,
  2: FLIP_ACROSS,
  3: [
    [-1, 0],
    [0, -1],
  ],
  4: FLIP_DOWN,
  5: [
    [0, 1],
    [1, 0],
  ],
  6: TURN_RIGHT,
  7: [
    [0, -1],
    [-1, 0],
  ],
  8: TURN_LEFT,
}

/** `first`, then `then`. */
export const compose = (then: Matrix, first: Matrix): Matrix => [
  [
    then[0][0] * first[0][0] + then[0][1] * first[1][0],
    then[0][0] * first[0][1] + then[0][1] * first[1][1],
  ],
  [
    then[1][0] * first[0][0] + then[1][1] * first[1][0],
    then[1][0] * first[0][1] + then[1][1] * first[1][1],
  ],
]

const same = (a: Matrix, b: Matrix) =>
  a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1]

export const isIdentity = (m: Matrix) => same(m, IDENTITY)

/** Whether the matrix swaps width and height (a quarter turn, or a transpose). */
export const swapsSides = (m: Matrix) => m[0][0] === 0

export const exifMatrix = (orientation: number): Matrix => EXIF[orientation] ?? IDENTITY

/** The EXIF orientation value for a matrix. */
export function exifOf(m: Matrix): number {
  for (const [value, matrix] of Object.entries(EXIF)) if (same(matrix, m)) return Number(value)
  return 1
}

/** The size of a `width`×`height` picture once `m` is applied. */
export const sizeAfter = (m: Matrix, width: number, height: number) =>
  swapsSides(m) ? { width: height, height: width } : { width, height }

/**
 * The canvas transform (a, b, c, d, e, f) that draws a `width`×`height` picture with `m`
 * applied, into a canvas of the size `sizeAfter` gives.
 */
export function canvasTransform(m: Matrix, width: number, height: number) {
  const out = sizeAfter(m, width, height)
  // Centre to the origin, apply m, centre in the new size.
  const [a, b, c, d] = [m[0][0], m[1][0], m[0][1], m[1][1]]
  const e = out.width / 2 - (a * width) / 2 - (c * height) / 2
  const f = out.height / 2 - (b * width) / 2 - (d * height) / 2
  return [a, b, c, d, e, f] as const
}

// EXIF in a JPEG: APP1 "Exif\0\0", a TIFF header, IFD0, tag 0x0112 (orientation, a SHORT).

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8

interface Found {
  /** Where the orientation's value is, or null when the EXIF has none. */
  at: number | null
  little: boolean
  /** Whether the file has EXIF at all. */
  exif: boolean
}

function findOrientation(bytes: Uint8Array): Found {
  const none: Found = { at: null, little: false, exif: false }
  if (!isJpeg(bytes)) return none
  let i = 2
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]!
    if (marker === 0xda || marker === 0xd9) break // the image data starts: no more headers
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!
    const body = i + 4
    if (
      marker === 0xe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.subarray(body, body + 4)) === 'Exif' &&
      bytes[body + 4] === 0 &&
      bytes[body + 5] === 0
    ) {
      const tiff = body + 6
      const little = bytes[tiff] === 0x49
      const u16 = (at: number) =>
        little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!
      const u32 = (at: number) =>
        little
          ? (bytes[at]! |
              (bytes[at + 1]! << 8) |
              (bytes[at + 2]! << 16) |
              (bytes[at + 3]! << 24)) >>>
            0
          : ((bytes[at]! << 24) |
              (bytes[at + 1]! << 16) |
              (bytes[at + 2]! << 8) |
              bytes[at + 3]!) >>>
            0
      const ifd = tiff + u32(tiff + 4)
      if (ifd + 2 > bytes.length) return { at: null, little, exif: true }
      const count = u16(ifd)
      for (let n = 0; n < count; n++) {
        const entry = ifd + 2 + n * 12
        if (entry + 12 > bytes.length) break
        if (u16(entry) === 0x0112) return { at: entry + 8, little, exif: true }
      }
      return { at: null, little, exif: true }
    }
    i = body + length - 2
  }
  return none
}

/** A JPEG's EXIF orientation (1 when it has none); null for anything that isn't a JPEG. */
export function jpegOrientation(bytes: Uint8Array): number | null {
  if (!isJpeg(bytes)) return null
  const { at, little } = findOrientation(bytes)
  if (at === null) return 1
  const v = little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!
  return v >= 1 && v <= 8 ? v : 1
}

/**
 * The JPEG with its orientation set: the pixels stay as they are, byte for byte. A JPEG with
 * no EXIF gets a small one; null when its EXIF has no orientation to change (the caller then
 * redraws the picture).
 */
export function withJpegOrientation(bytes: Uint8Array, orientation: number): Uint8Array | null {
  if (!isJpeg(bytes)) return null
  const { at, little, exif } = findOrientation(bytes)
  if (at !== null) {
    const out = bytes.slice()
    out[at] = little ? orientation : 0
    out[at + 1] = little ? 0 : orientation
    return out
  }
  if (exif) return null
  // APP1: "Exif\0\0", a big-endian TIFF header, IFD0 with one entry (orientation), no next IFD.
  const app1 = [
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]
  // After a JFIF header (APP0) if there is one: readers expect it first.
  const after = bytes[2] === 0xff && bytes[3] === 0xe0 ? 4 + ((bytes[4]! << 8) | bytes[5]!) : 2
  const out = new Uint8Array(bytes.length + app1.length)
  out.set(bytes.subarray(0, after), 0)
  out.set(app1, after)
  out.set(bytes.subarray(after), after + app1.length)
  return out
}
