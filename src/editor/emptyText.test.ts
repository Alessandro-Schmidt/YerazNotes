import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { bodyStart, hintParts, isEmpty } from './emptyText'

const doc = (text: string) => Text.of(text.split('\n'))
const META = '<!-- yeraz {"color":{"heading":"amber"}} -->'

describe('isEmpty: nothing written below the title', () => {
  it('a new leaf or branch text, a heading and a blank line, is empty', () => {
    expect(isEmpty(doc('# Cloud\n\n'))).toBe(true)
    expect(isEmpty(doc(`# Cloud\n${META}\n\n`))).toBe(true)
    expect(isEmpty(doc(''))).toBe(true)
  })

  it('any text below the title is not', () => {
    expect(isEmpty(doc('# Cloud\n\nContainers.'))).toBe(false)
    expect(isEmpty(doc('# Cloud\nContainers.'))).toBe(false)
    expect(isEmpty(doc('No heading at all.'))).toBe(false)
  })

  it('the body starts after the title, its metadata and one blank line', () => {
    expect(bodyStart(doc('# Cloud\n\nText'))).toBe(3)
    expect(bodyStart(doc(`# Cloud\n${META}\n\nText`))).toBe(4)
    expect(bodyStart(doc('# Cloud\nText'))).toBe(2)
    expect(bodyStart(doc('Text'))).toBe(1)
  })
})

describe('hintParts: the key to hold is the device’s own', () => {
  it('⌘ on a Mac, Ctrl elsewhere, and / on touch screens', () => {
    expect(hintParts(false, true).join('')).toBe('Click to write, hold ⌘ to see options')
    expect(hintParts(false, false).join('')).toBe('Click to write, hold Ctrl to see options')
    expect(hintParts(true, true).join('')).toBe('Tap to write, type / to see options')
  })
})
