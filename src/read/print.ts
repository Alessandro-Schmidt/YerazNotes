// PDF export (ARCHITECTURE.md §8): the browser's print dialog ("Save as PDF") on a copy of
// the leaf at the top of the page, so nothing around it prints and nothing clips it.
// print.css hides the app and swaps players for links; theme.ts switches to Paper.

import './print.css'

/** Takes the copy being printed away; set while one is on the page. */
let clear: (() => void) | null = null

/**
 * Prints `leaf`, a copy made for this (its images already loaded: a clone of it would load
 * them again, and Safari lays the page out before they have a size, one over another).
 */
export function printLeaf(leaf: HTMLElement, title: string): void {
  // A dialog given up on doesn't always say so (iOS): the copy it left would print again,
  // stacked with this one.
  clear?.()
  // The PDF is named after the page's title: the leaf's while it prints.
  const before = document.title
  document.title = title
  const root = document.createElement('div')
  root.id = 'print-root'
  root.className = 'reading'
  root.append(leaf)
  document.body.append(root)
  const done = () => {
    root.remove()
    document.title = before
    window.removeEventListener('afterprint', done)
    clear = null
  }
  clear = done
  window.addEventListener('afterprint', done)
  window.print()
}
