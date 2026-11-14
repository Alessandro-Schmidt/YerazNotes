import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blockAt, draggedBlock, moveBlock } from './blockDrag'

const stateOf = (doc: string) => {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) })
  ensureSyntaxTree(state, state.doc.length)
  return state
}
const DOC = '# T\n\nFirst.\n\n```js\nx\n```\n\n- one\n- two\n\nLast.\n'

describe('blockAt: the block a position is in, whole lines', () => {
  it('finds paragraphs, code blocks and list items; never the title', () => {
    const state = stateOf(DOC)
    const text = (pos: number) => {
      const b = blockAt(state, pos)
      return b && state.sliceDoc(b.from, b.to)
    }
    expect(text(DOC.indexOf('First'))).toBe('First.')
    expect(text(DOC.indexOf('x\n'))).toBe('```js\nx\n```')
    expect(text(DOC.indexOf('two'))).toBe('- two')
    expect(text(1)).toBeNull()
  })
})

describe('moveBlock', () => {
  const move = (doc: string, what: string, onto: string, after: boolean) => {
    const state = stateOf(doc)
    const block = blockAt(state, doc.indexOf(what))!
    const spec = moveBlock(state, block, doc.indexOf(onto), after)
    return spec && state.update(spec).state.doc.toString()
  }

  it('moves a block before or after another, a blank line between', () => {
    expect(move(DOC, 'Last.', 'First.', false)).toBe(
      '# T\n\nLast.\n\nFirst.\n\n```js\nx\n```\n\n- one\n- two\n',
    )
    expect(move(DOC, 'First.', 'x\n', true)).toBe(
      '# T\n\n```js\nx\n```\n\nFirst.\n\n- one\n- two\n\nLast.\n',
    )
  })

  it('reorders list items within their list, line by line', () => {
    expect(move(DOC, 'two', 'one', false)).toBe(
      '# T\n\nFirst.\n\n```js\nx\n```\n\n- two\n- one\n\nLast.\n',
    )
  })

  it('does nothing when dropped on itself', () => {
    expect(move(DOC, 'First.', 'First.', true)).toBeNull()
  })
})

describe("draggedBlock: the selection over a handle's block moves with it", () => {
  const dragged = (anchor: string, head: string, grip: string) => {
    const base = stateOf(DOC)
    const state = base.update({
      selection: { anchor: DOC.indexOf(anchor), head: DOC.indexOf(head) },
    }).state
    ensureSyntaxTree(state, state.doc.length)
    const b = draggedBlock(state, blockAt(state, DOC.indexOf(grip))!)
    return { text: state.sliceDoc(b.from, b.to), item: b.item, state, b }
  }

  it('is every block the selection touches, whole, from any of their handles', () => {
    expect(dragged('rst.', 'x\n', 'First').text).toBe('First.\n\n```js\nx\n```')
    expect(dragged('rst.', 'x\n', 'x\n').text).toBe('First.\n\n```js\nx\n```')
    // Whole lines selected end at the next line's start: that line stays.
    expect(dragged('- one', '- two', '- one')).toMatchObject({ text: '- one', item: true })
    expect(dragged('one', 'wo', 'two')).toMatchObject({ text: '- one\n- two', item: true })
  })

  it("is the handle's own block when the selection is elsewhere or empty", () => {
    expect(dragged('rst.', 'x\n', 'Last').text).toBe('Last.')
    expect(dragged('First', 'First', 'First').text).toBe('First.')
  })

  it('moves as one block', () => {
    const { state, b } = dragged('rst.', 'x\n', 'First')
    const spec = moveBlock(state, b, DOC.indexOf('Last'), true)!
    expect(state.update(spec).state.doc.toString()).toBe(
      '# T\n\n- one\n- two\n\nLast.\n\nFirst.\n\n```js\nx\n```\n',
    )
  })
})
