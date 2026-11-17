// A note taken out of Yeraz (src/read/float.ts): it floats in an always-on-top window where
// the browser has one (Document Picture-in-Picture), else over the app, until put back.

import type { Page } from '@playwright/test'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'
const peek = (page: Page) => page.getByRole('region', { name: /preview$/ })

test('a note floats in a window of its own, with its copies, and goes back to Yeraz', async ({
  page,
  graph,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Document Picture-in-Picture is Chromium only')
  const leaf = [...graph.nodes.values()].find((n) => n.kind === 'leaf')!
  await page.goto(`./#/tree/${REPO}/${leaf.id}`)
  await signInHere(page)
  const opened = page.context().waitForEvent('page')
  await peek(page).getByRole('button', { name: 'Float this note' }).click()
  const float = await opened
  const note = float.getByRole('region', { name: 'Floating note' })
  await expect(note.locator('.cm-content')).toContainText(leaf.title)
  // Only the note: its path and content to copy, and the way back.
  await expect(note.locator('[data-grip]').getByRole('button')).toHaveText(['Path', 'Content', ''])
  await expect(peek(page)).toHaveCount(0)

  await note.getByRole('button', { name: 'Put back in Yeraz' }).click()
  await expect.poll(() => float.isClosed()).toBe(true)
  await expect(peek(page)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/tree/${REPO}/${leaf.id}$`))
})

test('without that window, the note floats over the app and is dragged by its head', async ({
  page,
  graph,
}) => {
  await page.addInitScript(() => {
    delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture
  })
  const leaf = [...graph.nodes.values()].find((n) => n.kind === 'leaf')!
  await page.goto(`./#/tree/${REPO}/${leaf.id}`)
  await signInHere(page)
  await peek(page).getByRole('button', { name: 'Float this note' }).click()
  const note = page.getByRole('region', { name: 'Floating note' })
  await expect(note.locator('.cm-content')).toContainText(leaf.title)
  const before = (await note.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + 20)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 100, before.y + 120, { steps: 5 })
  await page.mouse.up()
  const after = (await note.boundingBox())!
  expect(Math.round(after.x - before.x)).toBe(-100)
  expect(Math.round(after.y - before.y)).toBe(100)

  await note.getByRole('button', { name: 'Put back in Yeraz' }).click()
  await expect(note).toHaveCount(0)
  await expect(peek(page)).toBeVisible()
})
