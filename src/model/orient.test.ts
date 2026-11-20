import { describe, expect, it } from 'vitest'
import { emptyInk, type Ink } from './ink'
import {
  andThen,
  isMarked,
  markedOf,
  markupHeight,
  noEdit,
  strokesOf,
  transformInk,
} from './markup'
import {
  canvasTransform,
  compose,
  exifMatrix,
  exifOf,
  FLIP_ACROSS,
  IDENTITY,
  isIdentity,
  jpegOrientation,
  sizeAfter,
  TURN_LEFT,
  TURN_RIGHT,
  withJpegOrientation,
} from './orient'

/** A JPEG's first bytes: SOI, a JFIF APP0, then scan data (enough for the header code). */
const JFIF = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
])

describe('orientation', () => {
  it('turns right four times back to where it was, and left undoes right', () => {
    let m = IDENTITY
    for (let i = 0; i < 4; i++) m = compose(TURN_RIGHT, m)
    expect(isIdentity(m)).toBe(true)
    expect(isIdentity(compose(TURN_LEFT, TURN_RIGHT))).toBe(true)
    expect(isIdentity(compose(FLIP_ACROSS, FLIP_ACROSS))).toBe(true)
  })

  it('names every orientation as EXIF does', () => {
    expect(exifOf(TURN_RIGHT)).toBe(6)
    expect(exifOf(compose(TURN_RIGHT, TURN_RIGHT))).toBe(3)
    expect(exifOf(TURN_LEFT)).toBe(8)
    expect(exifOf(FLIP_ACROSS)).toBe(2)
    for (let v = 1; v <= 8; v++) expect(exifOf(exifMatrix(v))).toBe(v)
    // A photo stored on its side (6), turned left: upright.
    expect(exifOf(compose(TURN_LEFT, exifMatrix(6)))).toBe(1)
  })

  it('swaps the sides on a quarter turn', () => {
    expect(sizeAfter(TURN_RIGHT, 400, 300)).toEqual({ width: 300, height: 400 })
    expect(sizeAfter(FLIP_ACROSS, 400, 300)).toEqual({ width: 400, height: 300 })
  })

  it('draws a picture turned right into its new size', () => {
    const [a, b, c, d, e, f] = canvasTransform(TURN_RIGHT, 400, 300)
    const at = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f]
    // Its top-left corner goes to the top right; its bottom-left to the top left.
    expect(at(0, 0)).toEqual([300, 0])
    expect(at(0, 300)).toEqual([0, 0])
    expect(at(400, 300)).toEqual([0, 400])
  })
})

describe('a JPEG’s orientation', () => {
  it('is 1 without EXIF, and null for anything else', () => {
    expect(jpegOrientation(JFIF)).toBe(1)
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('gets EXIF after its JFIF header, and the pixels stay byte for byte', () => {
    const turned = withJpegOrientation(JFIF, 6)!
    expect(jpegOrientation(turned)).toBe(6)
    expect(turned.length).toBe(JFIF.length + 36)
    expect([...turned.subarray(0, 20)]).toEqual([...JFIF.subarray(0, 20)])
    expect([...turned.subarray(56)]).toEqual([...JFIF.subarray(20)])
    // Changed again: the value only, same length.
    const again = withJpegOrientation(turned, 3)!
    expect(jpegOrientation(again)).toBe(3)
    expect(again.length).toBe(turned.length)
  })

  it('reads little-endian EXIF too', () => {
    // SOI, APP1 with an "II" TIFF header and one orientation entry (8), then the scan.
    const ii = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a,
      0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
      0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9,
    ])
    expect(jpegOrientation(ii)).toBe(8)
    expect(jpegOrientation(withJpegOrientation(ii, 1)!)).toBe(1)
  })

  it('leaves a picture that isn’t a JPEG to be redrawn', () => {
    expect(withJpegOrientation(new Uint8Array([0x89, 0x50]), 6)).toBeNull()
  })
})

describe('markup', () => {
  it('names the marked-up copy and its strokes beside the original', () => {
    expect(markedOf('assets/2026-11-20-realm.png')).toBe('assets/2026-11-20-realm.marked.png')
    expect(markedOf('assets/photo.JPG')).toBe('assets/photo.marked.jpg')
    expect(markedOf('assets/diagram.webp')).toBe('assets/diagram.marked.png')
    expect(strokesOf('assets/photo.marked.jpg')).toBe('assets/photo.marked.ink.svg')
    expect(isMarked('assets/photo.marked.jpg')).toBe(true)
    expect(isMarked('assets/photo.jpg')).toBe(false)
  })

  it('makes the strokes as tall as the picture, at 1000 wide', () => {
    expect(markupHeight(4000, 3000)).toBe(750)
  })

  it('turns the strokes with the picture', () => {
    const ink: Ink = {
      ...emptyInk(500),
      strokes: [
        {
          id: 'a1',
          tool: 'rect',
          color: 'blue',
          size: 5,
          pressure: false,
          points: [0, 0, 0.5, 100, 50, 0.5],
        },
      ],
    }
    const turned = transformInk(ink, TURN_RIGHT)
    // 1000×500 turned right is 500×1000, scaled to 1000×2000.
    expect(turned.height).toBe(2000)
    // The top-left corner goes to the top right.
    expect(turned.strokes[0]!.points.slice(0, 2)).toEqual([1000, 0])
    expect(turned.strokes[0]!.points.slice(3, 5)).toEqual([900, 200])
    // Turning back gives the strokes as they were.
    expect(transformInk(turned, TURN_LEFT)).toEqual(ink)
  })

  it('keeps every turn made in the viewer, in order', () => {
    const edit = andThen(andThen(noEdit(emptyInk(750)), TURN_RIGHT), TURN_RIGHT)
    expect(exifOf(edit.turn)).toBe(3)
    expect(edit.ink.height).toBe(750)
  })
})
