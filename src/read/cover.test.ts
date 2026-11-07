import { describe, expect, it } from 'vitest'
import { coverAspect, coverPosition, dragCover, dragSideways, iconFocus, iconShape } from './cover'

describe('coverPosition', () => {
  it('reads line 2’s position, a percentage from the top, centred by default', () => {
    expect(coverPosition({ cover: '/assets/a.png', coverPosition: 30 })).toBe(30)
    expect(coverPosition({ cover: '/assets/a.png' })).toBe(50)
    expect(coverPosition(null)).toBe(50)
  })

  it('ignores what isn’t a percentage', () => {
    expect(coverPosition({ coverPosition: '30' })).toBe(50)
    expect(coverPosition({ coverPosition: Number.NaN })).toBe(50)
    expect(coverPosition({ coverPosition: 140 })).toBe(100)
    expect(coverPosition({ coverPosition: -5 })).toBe(0)
  })
})

describe('dragCover', () => {
  // A 1500 × 1000 photo in a 600 × 200 slot: drawn 600 × 400, so 200 px are hidden.
  const box = { width: 600, height: 200 }
  const photo = { width: 1500, height: 1000 }

  it('moves the image with the pointer: dragging down shows more of the top', () => {
    expect(dragCover(50, 100, box, photo)).toBe(0)
    expect(dragCover(50, -50, box, photo)).toBe(75)
    expect(dragCover(50, -1000, box, photo)).toBe(100)
  })

  it('does nothing when the image has no hidden height', () => {
    expect(dragCover(50, 80, box, { width: 3000, height: 500 })).toBe(50)
  })
})

describe('cover and icon formats (line 2)', () => {
  it('reads coverAspect: named, a ratio, or the usual one', () => {
    expect(coverAspect({ coverAspect: 'slim' })).toBe('5 / 1')
    expect(coverAspect({ coverAspect: 'tall' })).toBe('2 / 1')
    expect(coverAspect({ coverAspect: '4:1' })).toBe('4 / 1')
    expect(coverAspect({ coverAspect: '0:1' })).toBeNull()
    expect(coverAspect({ coverAspect: 'huge' })).toBeNull()
    expect(coverAspect({})).toBeNull()
  })

  it('reads iconShape: a circle unless chosen', () => {
    expect(iconShape({})).toEqual({ radius: '50%', aspect: '1 / 1' })
    expect(iconShape({ iconShape: 'square' })).toEqual({ radius: '0', aspect: '1 / 1' })
    expect(iconShape({ iconShape: 'rounded' }).radius).toBe('22%')
    expect(iconShape({ iconShape: '3:2' }).aspect).toBe('3 / 2')
  })

  it('reads iconFocus as [x, y] percentages, centred by default', () => {
    expect(iconFocus({ iconFocus: [10, 90] })).toEqual([10, 90])
    expect(iconFocus({ iconFocus: [-5, 'a'] })).toEqual([0, 50])
    expect(iconFocus(null)).toEqual([50, 50])
  })

  it('drags sideways as the cover drags down', () => {
    // A 1000 × 1500 picture in a 200 × 600 slot: dragCover's case, turned.
    const box = { width: 200, height: 600 }
    expect(dragSideways(50, 100, box, { width: 1000, height: 1500 })).toBe(0)
  })
})
