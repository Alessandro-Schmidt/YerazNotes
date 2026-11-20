// Drawings in the read view (development-plan.md M5): an image of a `.ink.svg` file is drawn
// from its strokes in the theme's colours (model/ink.ts inkMarkup), not shown as the file's
// own picture, whose colours are GitHub's. The drawing code is loaded only when one is shown.

/** Whether a read view's image is a drawing, by its file (as model/ink.ts, kept out of the first load). */
export const isDrawing = (el: HTMLElement) => /\.ink\.svg$/i.test(el.dataset.asset ?? '')

/** Puts the drawing in place of its image; the image stays when the file can't be read. */
export async function showDrawing(
  el: HTMLElement,
  bytes: (path: string) => Promise<Uint8Array | null>,
): Promise<void> {
  const path = el.dataset.asset!
  const [{ inkFromSvg, inkMarkup }, data] = await Promise.all([
    import('../model/ink'),
    bytes(path).catch(() => null),
  ])
  const ink = data && inkFromSvg(new TextDecoder().decode(data))
  if (!ink || !el.isConnected) return
  const frame = document.createElement('span')
  frame.className = 'ink'
  frame.dataset.inkPath = path
  const width = el.getAttribute('width')
  if (width) frame.style.width = width
  frame.innerHTML = inkMarkup(ink, el.getAttribute('alt') ?? 'Drawing')
  el.replaceWith(frame)
}
