import { describe, expect, it } from 'vitest'
import { textChanges, type TextChange } from './diff'

const apply = (text: string, changes: TextChange[]) => {
  let out = ''
  let at = 0
  for (const c of changes) {
    expect(c.from).toBeGreaterThanOrEqual(at)
    out += text.slice(at, c.from) + c.insert
    at = c.to
  }
  return out + text.slice(at)
}

describe('textChanges', () => {
  it('is nothing for the same text', () => {
    expect(textChanges('# T\n\nbody', '# T\n\nbody')).toEqual([])
  })

  it('keeps a changed word to the characters that differ', () => {
    expect(textChanges('# T\n\nthe cat sat\nend', '# T\n\nthe dog sat\nend')).toEqual([
      { from: 9, to: 12, insert: 'dog' },
    ])
  })

  it('adds and removes whole lines, at the end of the text too', () => {
    expect(textChanges('a', 'a\nb')).toEqual([{ from: 1, to: 1, insert: '\nb' }])
    expect(textChanges('a\nb', 'a')).toEqual([{ from: 1, to: 3, insert: '' }])
    expect(textChanges('', 'a')).toEqual([{ from: 0, to: 0, insert: 'a' }])
  })

  it('gives separate changes in order, which turn the old text into the new', () => {
    const before = '# 🔐 Keycloak\n\none\ntwo\nthree\n\n$$x^2$$\n![a](/assets/a.png)\n'
    const after =
      '# 🔑 Keycloak\n<!-- yeraz {"cover":"/assets/c.png"} -->\n\none\nthree\nfour\n\n$$x^3$$\n'
    const changes = textChanges(before, after)
    expect(changes.length).toBeGreaterThan(2)
    expect(apply(before, changes)).toBe(after)
  })

  it('turns random edits of a text back into the edited text', () => {
    let seed = 7
    const random = (n: number) => (((seed = (seed * 16807) % 2147483647) % n) + n) % n
    const words = ['a', 'b', 'c', '\n', '# h', '$x$', ' ']
    const text = (n: number) =>
      Array.from({ length: n }, () => words[random(words.length)]).join('')
    for (let i = 0; i < 200; i++) {
      const before = text(random(30))
      const after = text(random(30))
      expect(apply(before, textChanges(before, after))).toBe(after)
    }
  })
})
