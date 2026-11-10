// The Explorer and the Peek are dragged wider or narrower by their inner edge (issue #80);
// the widths are kept on this device.

import type { Locator, Page } from '@playwright/test'
import { expect, signInHere, test } from './fixtures'

test.skip(({ isMobile }) => isMobile, 'Phones show the panels as sheets')

/** Whole pixels: panels come in with a transform, which leaves fractions while it plays. */
const width = async (el: Locator) => Math.round((await el.boundingBox())!.width)

/** Drags a panel edge sideways by `dx` pixels. */
async function drag(page: Page, handle: Locator, dx: number) {
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y)
  await page.mouse.move(x + dx, y)
  await page.mouse.up()
}

test('the Explorer and the Peek resize by their edges, and keep their widths', async ({
  page,
  graph,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const leaf = [...graph.nodes.values()].find((n) => n.kind === 'leaf' && n.parent !== '')!
  await page.goto(`./#/tree/you/engineering/${leaf.id}`)
  await signInHere(page)
  const explorer = page.getByRole('complementary', { name: 'Explorer' })
  const peek = page.getByRole('region', { name: /preview$/ })
  await expect(peek).toBeVisible()
  await expect.poll(() => width(explorer)).toBe(272)
  await expect.poll(() => width(peek)).toBe(420)

  await drag(page, page.getByRole('separator', { name: 'Explorer width' }), 100)
  await expect.poll(() => width(explorer)).toBe(372)
  await drag(page, page.getByRole('separator', { name: 'Note panel width' }), -150)
  await expect.poll(() => width(peek)).toBe(570)

  // From the keyboard: arrows by 16 px, Home to the least.
  const edge = page.getByRole('separator', { name: 'Explorer width' })
  await edge.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => width(explorer)).toBe(356)
  await expect(edge).toHaveAttribute('aria-valuenow', '356')

  await page.reload()
  await expect(peek).toBeVisible()
  await expect.poll(() => width(explorer)).toBe(356)
  await expect.poll(() => width(peek)).toBe(570)

  // A double click puts a panel back as it was.
  await page.getByRole('separator', { name: 'Note panel width' }).dblclick()
  await expect.poll(() => width(peek)).toBe(420)
})

test('Keep open holds a leaf beside the next one picked; both are edited at once', async ({
  page,
  graph,
  fake,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const leaves = [...graph.nodes.values()]
    .filter((n) => n.kind === 'leaf' && n.parent !== '')
    .sort((a, b) => a.id.localeCompare(b.id))
  const [first, second] = [leaves[0]!, leaves[1]!]
  await page.goto(`./#/tree/you/engineering/${first.id}`)
  await signInHere(page)
  const peeks = page.getByRole('region', { name: 'Note preview' })
  await expect(peeks).toHaveCount(1)
  await peeks.getByRole('button', { name: 'Keep open' }).click()
  await expect(peeks.getByRole('button', { name: 'Keep open' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // The same leaf is not shown twice; picking another opens it beside the kept one.
  await expect(peeks).toHaveCount(1)
  await page.getByRole('treeitem', { name: new RegExp(second.title) }).click()
  await expect(peeks).toHaveCount(2)
  await expect(peeks.nth(0).getByRole('heading', { level: 2 })).toHaveText(first.title)
  await expect(peeks.nth(1).getByRole('heading', { level: 2 })).toHaveText(second.title)
  const left = (await peeks.nth(0).boundingBox())!
  const right = (await peeks.nth(1).boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  // The kept one's pin stays, pressed; the new one's is not.
  await expect(peeks.nth(0).getByRole('button', { name: 'Keep open' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(peeks.nth(1).getByRole('button', { name: 'Keep open' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  // Written in both, saved from both.
  for (const [i, word] of [
    [0, 'Kept.'],
    [1, 'Picked.'],
  ] as const) {
    await peeks.nth(i).locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(`\n${word}`)
  }
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => fake.repo('you/engineering').read(first.id)).toContain('Kept.')
  await expect.poll(() => fake.repo('you/engineering').read(second.id)).toContain('Picked.')

  // The kept one can move to the right of the new one; the side is saved on this device.
  await peeks.nth(0).getByRole('button', { name: 'Pin on the other side' }).click()
  const box = async (i: number) => (await peeks.nth(i).boundingBox())!
  expect((await box(1)).x + (await box(1)).width).toBeLessThanOrEqual((await box(0)).x)
  expect(await page.evaluate(() => localStorage.getItem('yeraz-pin-side'))).toBe('right')

  // Closing the kept one leaves the selection alone.
  await peeks.nth(0).getByRole('button', { name: 'Dismiss' }).click()
  await expect(peeks).toHaveCount(1)
  await expect(peeks.getByRole('heading', { level: 2 })).toHaveText(second.title)
})

test('each note has its own width: resizing one never changes another', async ({ page, graph }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const leaves = [...graph.nodes.values()]
    .filter((n) => n.kind === 'leaf' && n.parent !== '')
    .sort((a, b) => a.id.localeCompare(b.id))
  await page.goto(`./#/tree/you/engineering/${leaves[0]!.id}`)
  await signInHere(page)
  const peeks = page.getByRole('region', { name: 'Note preview' })
  await peeks.getByRole('button', { name: 'Keep open' }).click()
  await page.getByRole('treeitem', { name: new RegExp(leaves[1]!.title) }).click()
  await expect(peeks).toHaveCount(2)
  await expect.poll(() => width(peeks.nth(0))).toBe(420)
  await expect.poll(() => width(peeks.nth(1))).toBe(420)

  // Each edge resizes its own note, never the one beside it.
  await drag(page, peeks.nth(1).getByRole('separator', { name: 'Note panel width' }), -100)
  await expect.poll(() => width(peeks.nth(1))).toBe(520)
  await expect.poll(() => width(peeks.nth(0))).toBe(420)
  await drag(page, peeks.nth(0).getByRole('separator', { name: 'Note panel width' }), -60)
  await expect.poll(() => width(peeks.nth(0))).toBe(480)
  await expect.poll(() => width(peeks.nth(1))).toBe(520)

  // The width is the note's: kept on this device, and it follows the note wherever it opens.
  await page.reload()
  await expect(peeks).toHaveCount(1)
  await expect.poll(() => width(peeks)).toBe(520)
  await page.getByRole('treeitem', { name: new RegExp(leaves[0]!.title) }).click()
  await expect.poll(() => width(peeks)).toBe(480)
  await page.goto(`./#/tree/you/engineering/${leaves[2]!.id}`)
  await expect.poll(() => width(peeks)).toBe(420)
})
