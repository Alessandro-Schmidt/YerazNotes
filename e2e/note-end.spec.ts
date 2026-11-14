// The end of a note (owner's request): a bar at its end fills with the accent as the end
// comes near, and the app itself never scrolls, even under a note too short to scroll.

import { expect, isPhone, signInHere, test } from './fixtures'

const REPO = 'you/notes'
const LONG = `# Long\n\n${Array.from({ length: 120 }, (_, i) => `Line ${i}.`).join('\n\n')}\n`

test.beforeEach(async ({ fake }) => {
  await fake.addRepo(REPO, {
    '.yeraz.json': '{"name":"Notes"}',
    'Tree/short.md': '# Short\n\nA line.\n',
    'Tree/long.md': LONG,
  })
})

const end = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-end]')
    .evaluate((bar) => Number(getComputedStyle(bar.parentElement!).getPropertyValue('--end')))

test('a short note shows its end; scrolling over it never moves the app', async ({ page }) => {
  await page.goto(`./#/tree/${REPO}/Tree%2Fshort.md`)
  await signInHere(page)
  await expect(page.locator('.cm-content')).toContainText('A line.')
  await expect.poll(() => end(page)).toBe(1)
  await page.locator('.cm-content').hover()
  await page.mouse.wheel(40, 400)
  const moved = await page.evaluate(() => {
    window.scrollTo(50, 50)
    document.getElementById('root')!.scrollTop = 50
    const root = document.getElementById('root')!
    return [window.scrollX, window.scrollY, root.scrollTop, root.scrollLeft]
  })
  expect(moved).toEqual([0, 0, 0, 0])
})

test('a long note’s bar fills as its end comes near', async ({ page }) => {
  await page.goto(`./#/tree/${REPO}/Tree%2Flong.md`)
  await signInHere(page)
  await expect(page.locator('.cm-content')).toContainText('Line 0.')
  await expect.poll(() => end(page)).toBe(0)
  // Half way through the last stretch. (A phone's sheet grows to the full page as it scrolls.)
  if (!isPhone(page)) {
    await page.locator('[data-end]').evaluate((bar) => {
      const s = bar.parentElement!
      s.scrollTop = s.scrollHeight - s.clientHeight - 120
    })
    await expect.poll(() => end(page)).toBeCloseTo(0.5, 1)
  }
  await page.locator('[data-end]').evaluate((bar) => {
    bar.parentElement!.scrollTop = bar.parentElement!.scrollHeight
  })
  await expect.poll(() => end(page)).toBe(1)
  await expect(page.locator('[data-end]')).toBeInViewport()
})
