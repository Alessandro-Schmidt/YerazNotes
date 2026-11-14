import { expect, it, vi } from 'vitest'
import { printLeaf } from './print'

it("names the PDF after the leaf: the page's title while it prints, restored after", () => {
  const events = new EventTarget()
  const doc = {
    title: 'Yeraz',
    createElement: () => ({ append() {}, remove() {} }),
    body: { append() {} },
  }
  let printing = ''
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    print: () => void (printing = doc.title),
  })
  printLeaf({} as unknown as HTMLElement, 'Keycloak')
  expect(printing).toBe('Keycloak')
  events.dispatchEvent(new Event('afterprint'))
  expect(doc.title).toBe('Yeraz')
  vi.unstubAllGlobals()
})

it('takes away a copy left by a dialog given up on, before printing the next', () => {
  const events = new EventTarget()
  const roots: object[] = []
  const doc = {
    title: 'Yeraz',
    createElement: () => {
      const root = { append() {}, remove: () => void roots.splice(roots.indexOf(root), 1) }
      return root
    },
    body: { append: (root: object) => void roots.push(root) },
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    print: () => undefined,
  })
  // No `afterprint` after the first (iOS, cancelled).
  printLeaf({} as unknown as HTMLElement, 'One')
  printLeaf({} as unknown as HTMLElement, 'Two')
  expect(roots).toHaveLength(1)
  events.dispatchEvent(new Event('afterprint'))
  expect(roots).toHaveLength(0)
  expect(doc.title).toBe('Yeraz')
  vi.unstubAllGlobals()
})
