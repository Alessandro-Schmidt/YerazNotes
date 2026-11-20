// Ink (development-plan.md M5): a drawing from the insert menu, drawn with a pen (pointer events
// with pressure) and a mouse, saved as one `.ink.svg` in the leaf's commit; a finger once a pen
// was used draws nothing; undo, the eraser, and the lasso's strokes copied to another leaf as a
// file of their own.

import type { Page } from '@playwright/test'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'
const LEAF = 'sketches.md'
const OTHER = 'other.md'

interface Ink {
  height: number
  strokes: { id: string; color: string; pressure: boolean; points: number[] }[]
}
/** The strokes in a drawing's file (model/ink.ts writes them in its metadata). */
const inkFromSvg = (svg: string): Ink =>
  JSON.parse(/<metadata id="yeraz-ink">([\s\S]*?)<\/metadata>/.exec(svg)![1]!) as Ink

const mutations = (fake: { log: { operation?: string }[] }) =>
  fake.log.filter((e) => e.operation === 'mutation')

test.skip(({ isMobile }) => isMobile, 'Ctrl/Cmd opens the insert menu on desktop engines')

test.beforeEach(async ({ fake }) => {
  await fake.repo(REPO).commit({
    message: 'sketches',
    additions: [
      { path: LEAF, contents: '# Sketches\n\nThe realm, drawn.\n' },
      { path: OTHER, contents: '# Other\n\nSomewhere else.\n' },
    ],
  })
})

async function openEditor(page: Page, leaf = LEAF, signIn = true) {
  await page.goto(`./#/tree/${REPO}/${leaf}`)
  if (signIn) await signInHere(page)
  else await expect(page.locator('.cm-content')).toContainText('Somewhere else.')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
}

async function insertDrawing(page: Page) {
  await page.keyboard.down('Control')
  await page.waitForTimeout(1100)
  await page.keyboard.up('Control')
  await page.getByRole('menuitem', { name: 'Drawing' }).click()
  const drawing = page.locator('.cm-ink[data-drawing]')
  await expect(drawing).toBeVisible()
  return drawing
}

/** A stroke as a device sends it: pointer events of one type, in steps, with pressure. */
async function stroke(
  page: Page,
  type: 'pen' | 'touch',
  from: [number, number],
  to: [number, number],
  pointerId = 7,
) {
  const box = (await page.locator('.cm-ink-svg').first().boundingBox())!
  await page.evaluate(
    ({ type, box, from, to, pointerId }) => {
      const svg = document.querySelector('.cm-ink-svg')!
      const at = (t: number) => ({
        clientX: box.x + box.width * (from[0] + (to[0] - from[0]) * t),
        clientY: box.y + box.height * (from[1] + (to[1] - from[1]) * t),
      })
      const send = (name: string, t: number, pressure: number) =>
        svg.dispatchEvent(
          new PointerEvent(name, {
            pointerType: type,
            pointerId,
            isPrimary: true,
            pressure,
            bubbles: true,
            cancelable: true,
            ...at(t),
          }),
        )
      send('pointerdown', 0, 0.3)
      for (let i = 1; i <= 10; i++) send('pointermove', i / 10, 0.3 + i * 0.05)
      send('pointerup', 1, 0)
    },
    { type, box, from, to, pointerId },
  )
}

const strokesShown = (page: Page) => page.locator('.cm-ink-svg g path')

async function committedInk(fake: { repo(name: string): unknown }, prefix = 'assets/') {
  const repo = fake.repo(REPO) as {
    head: { files: Map<string, string> }
    blobs: Map<string, Uint8Array>
  }
  const paths = [...repo.head.files.keys()].filter(
    (p) => p.startsWith(prefix) && p.endsWith('.ink.svg'),
  )
  return paths.map((path) => ({
    path,
    ink: inkFromSvg(new TextDecoder().decode(repo.blobs.get(repo.head.files.get(path)!)!)),
  }))
}

test('a drawing from the insert menu: a pen and a mouse draw, one commit holds it and the leaf', async ({
  page,
  fake,
}) => {
  await openEditor(page)
  await insertDrawing(page)
  await stroke(page, 'pen', [0.1, 0.2], [0.5, 0.4])
  await expect(strokesShown(page)).toHaveCount(1)

  // A mouse draws too.
  const box = (await page.locator('.cm-ink-svg').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 6 })
  await page.mouse.up()
  await expect(strokesShown(page)).toHaveCount(2)

  // Colours are the theme's: the stroke is drawn with a token, never a fixed colour.
  await page.getByRole('button', { name: 'Blue' }).click()
  await stroke(page, 'pen', [0.2, 0.7], [0.4, 0.8])
  await expect(strokesShown(page).nth(2)).toHaveAttribute('style', /var\(--c-blue\)/)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.cm-ink[data-drawing]')).toHaveCount(0)

  fake.resetLog()
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => mutations(fake).length).toBe(1)
  const [drawing] = await committedInk(fake)
  expect(drawing!.path).toMatch(/^assets\/\d{4}-\d{2}-\d{2}-drawing\.ink\.svg$/)
  expect(drawing!.ink.strokes.map((s) => [s.pressure, s.color])).toEqual([
    [true, 'ink'],
    [false, 'ink'],
    [true, 'blue'],
  ])
  // The pen's pressure was kept with its points.
  expect(drawing!.ink.strokes[0]!.points[2]).toBeCloseTo(0.3)
  const leaf = (fake.repo(REPO) as { read(p: string): string }).read(LEAF)
  expect(leaf).toBe(`# Sketches\n\nThe realm, drawn.\n\n![Drawing](/${drawing!.path})\n`)

  // Read again from GitHub after a reload, it shows the same three strokes.
  await page.reload()
  await expect(page.locator('.cm-ink .cm-ink-svg g path')).toHaveCount(3)
})

test('once a pen was used a finger draws nothing; undo, redo and the eraser', async ({ page }) => {
  await openEditor(page)
  await insertDrawing(page)
  await stroke(page, 'pen', [0.1, 0.3], [0.9, 0.3])
  await expect(strokesShown(page)).toHaveCount(1)
  // A palm or a finger after the pen: it scrolls, it doesn't draw.
  await stroke(page, 'touch', [0.1, 0.7], [0.9, 0.7], 9)
  await expect(strokesShown(page)).toHaveCount(1)

  await stroke(page, 'pen', [0.1, 0.6], [0.9, 0.6])
  await expect(strokesShown(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(strokesShown(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(strokesShown(page)).toHaveCount(2)

  // The eraser takes whole strokes it crosses.
  await page.getByRole('button', { name: 'Eraser' }).click()
  await stroke(page, 'pen', [0.5, 0.2], [0.5, 0.4])
  await expect(strokesShown(page)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(strokesShown(page)).toHaveCount(2)
})

test('the lasso’s strokes, copied, paste into another leaf as a drawing of their own', async ({
  page,
  context,
  fake,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openEditor(page)
  await insertDrawing(page)
  await stroke(page, 'pen', [0.1, 0.2], [0.3, 0.3])
  await stroke(page, 'pen', [0.6, 0.6], [0.9, 0.8])
  await expect(strokesShown(page)).toHaveCount(2)

  // A loop around the first stroke only.
  await page.getByRole('button', { name: 'Lasso' }).click()
  const box = (await page.locator('.cm-ink-svg').boundingBox())!
  const loop = [
    [0.05, 0.1],
    [0.4, 0.1],
    [0.4, 0.4],
    [0.05, 0.4],
    [0.05, 0.12],
  ]
  await page.mouse.move(box.x + box.width * loop[0]![0]!, box.y + box.height * loop[0]![1]!)
  await page.mouse.down()
  for (const [x, y] of loop.slice(1))
    await page.mouse.move(box.x + box.width * x!, box.y + box.height * y!, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.cm-ink-svg g path.cm-ink-chosen')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+c')
  await page.getByRole('button', { name: 'Done' }).click()

  await openEditor(page, OTHER, false)
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('.cm-ink .cm-ink-svg g path')).toHaveCount(1)

  fake.resetLog()
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => mutations(fake).length).toBeGreaterThan(0)
  await expect.poll(async () => (await committedInk(fake)).length).toBe(2)
  const drawings = await committedInk(fake)
  const counts = drawings.map((d) => d.ink.strokes.length).sort()
  expect(counts).toEqual([1, 2])
  const other = (fake.repo(REPO) as { read(p: string): string }).read(OTHER)
  const copy = drawings.find((d) => d.ink.strokes.length === 1)!
  expect(other).toContain(`![Drawing](/${copy.path})`)
})

test('the read view draws a drawing from its strokes, in the theme’s colours', async ({
  page,
  fake,
}) => {
  const file =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400" width="1000" height="400">\n' +
    '<metadata id="yeraz-ink">{"v":1,"width":1000,"height":400,"strokes":[' +
    '{"id":"a1","tool":"pen","color":"green","size":5,"pressure":true,"points":[10,10,0.5,200,100,0.6]}' +
    ']}</metadata>\n</svg>\n'
  await fake.repo(REPO).commit({
    message: 'readme',
    additions: [
      { path: 'assets/realm.ink.svg', contents: file },
      { path: 'README.md', contents: '# Engineering\n\n![Realm](/assets/realm.ink.svg)\n' },
    ],
  })
  await page.goto(`./#/tree/${REPO}`)
  await signInHere(page)
  // The Family's Peek shows its README.md as it reads.
  await page.getByRole('button', { name: 'Show note panel' }).click()
  const drawing = page.getByRole('img', { name: 'Realm' })
  await expect(drawing).toBeVisible()
  await expect(drawing.locator('path')).toHaveAttribute('style', /var\(--c-green\)/)
})
