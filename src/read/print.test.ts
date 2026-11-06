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
  printLeaf({ cloneNode: () => ({}) } as unknown as HTMLElement, 'Keycloak')
  expect(printing).toBe('Keycloak')
  events.dispatchEvent(new Event('afterprint'))
  expect(doc.title).toBe('Yeraz')
  vi.unstubAllGlobals()
})
