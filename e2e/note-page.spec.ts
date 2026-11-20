// A note to write in (owner's requests, 2026-11-20): no bar of project tabs (the Families menu
// has them); a note open as a page keeps only what writing needs; the note's column never
// widens or scrolls sideways (a wide table scrolls inside itself, a long address is cut
// short); a link written as text is underlined.

import type { Page } from '@playwright/test'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'
const row = (i: number) =>
  `| Cnam ${i} | Master EEA – High-frequency communication systems | Master 2 (Bac+5), 60 ECTS. You need an M1 in electronics or physics | 1 year as a package, with a 30-ECTS internship | Cnam Paris, 292 rue Saint-Martin (75003), in person and remote |`
const IDEAS =
  '# Ideas\n\n' +
  '[Master electronique energie electrique et automatique parcours systemes de communication hautes frequences](https://www.cnam.fr/formation/sciences/physique/master-electronique-energie-electrique-et-automatique-parcours-systemes-de-communication-hautes-frequences-1)\n\n' +
  'Prices are on [the Cnam site](https://www.cnam.fr/tarifs).\n\n' +
  "| School | Program | Level / degree | Timeframe | Where you'd study |\n|---|---|---|---|---|\n" +
  [1, 2, 3].map(row).join('\n') +
  '\n\nAfter the table.\n'

test.beforeEach(async ({ fake }) => {
  await fake.repo(REPO).commit({
    message: 'ideas',
    additions: [
      { path: 'ideas.md', contents: IDEAS },
      { path: 'README.md', contents: IDEAS.replace('# Ideas', '# Engineering') },
    ],
  })
})

/** Scrolling boxes in or around the note that are wider than they show, but for tables' own. */
const sideways = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((e) => {
        const { overflowX } = getComputedStyle(e)
        return (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          e.scrollWidth > e.clientWidth + 1 &&
          !e.matches('table, .cm-table-scroll') &&
          // The note's panel and what holds it; a row of chips may scroll on its own.
          (!!e.closest('[aria-label$="preview"]') || !!e.querySelector('[aria-label$="preview"]'))
        )
      })
      .map((e) => e.className.toString()),
  )

test('no bar of project tabs: the Families menu moves between them', async ({ page }) => {
  await page.goto(`./#/tree/${REPO}/ideas.md`)
  await signInHere(page)
  await expect(page.getByText('After the table.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Projects' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Families' }).click()
  await expect(page.getByRole('menu', { name: 'Families' })).toBeVisible()
})

test('a note open as a page keeps only what writing needs', async ({ page, isMobile }) => {
  test.skip(isMobile, 'A phone shows a note as a page already')
  await page.goto(`./#/tree/${REPO}/ideas.md`)
  await signInHere(page)
  await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible()
  await page.getByRole('button', { name: 'Open full page' }).click()

  await expect(page.getByRole('radiogroup', { name: 'View' })).toHaveCount(0)
  await expect(page.getByRole('banner').getByRole('button', { name: 'New note' })).toHaveCount(0)
  for (const name of ['Families', 'Refresh', 'Save now', /^Search/])
    await expect(page.getByRole('banner').getByRole('button', { name })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy path' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy content' })).toBeVisible()
  await expect(
    page
      .locator('main')
      .getByText(/^\d+ words$/)
      .last(),
  ).toBeVisible()

  // Back in the panel, the views and New note return.
  await page.getByRole('button', { name: 'Back to the map' }).click()
  await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'New note' })).toBeVisible()
})

test('the note never scrolls sideways: a wide table scrolls inside itself', async ({
  page,
  isMobile,
}) => {
  await page.goto(`./#/tree/${REPO}/ideas.md`)
  await signInHere(page)
  await expect(page.locator('.cm-content')).toContainText('After the table.')
  if (!isMobile) await page.getByRole('button', { name: 'Open full page' }).click()
  await expect(page.locator('.cm-table-scroll')).toBeVisible()
  expect(await sideways(page)).toEqual([])
  // The table keeps readable columns and scrolls in its own frame.
  const table = page.locator('.cm-table-scroll')
  await expect.poll(() => table.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
  // The bookmark's long address is cut short inside its card.
  const card = page.locator('.cm-embed-bookmark').first()
  const column = (await page.locator('.cm-content').boundingBox())!
  const box = (await card.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 1)
})

test('the read view keeps its column too, its tables scrolling inside themselves', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The Family’s panel is opened from the top bar on computers')
  await page.goto(`./#/tree/${REPO}`)
  await signInHere(page)
  await page.getByRole('button', { name: 'Show note panel' }).click()
  const table = page.locator('.reading table').first()
  await expect(table).toBeVisible()
  expect(await sideways(page)).toEqual([])
  await expect.poll(() => table.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
  // A link in the text is underlined there as well.
  const link = page.locator('.reading').getByRole('link', { name: 'the Cnam site' })
  await expect(link).toHaveCSS('text-decoration-line', 'underline')
})

test('a link written as text is underlined, with its address on hover', async ({ page }) => {
  await page.goto(`./#/tree/${REPO}/ideas.md`)
  await signInHere(page)
  const link = page.locator('.cm-link[data-href]', { hasText: 'the Cnam site' })
  await expect(link).toBeVisible()
  await expect(link).toHaveCSS('text-decoration-line', 'underline')
  await expect(link).toHaveCSS('cursor', 'pointer')
  await expect(link).toHaveAttribute('title', 'https://www.cnam.fr/tarifs')
})
