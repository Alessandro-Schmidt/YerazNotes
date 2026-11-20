// Ink on touch screens (development-plan.md M5): the pencil on the bar above the keyboard opens
// a new drawing, and on a device where no pen was used a finger draws.

import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'

test.skip(({ isMobile }) => !isMobile, 'The bar above the keyboard is for touch screens')

test('the pencil opens a drawing, and a finger draws in it', async ({ page, fake }) => {
  await fake.repo(REPO).commit({
    message: 'phone',
    additions: [{ path: 'phone.md', contents: '# Phone\n\nA quick sketch.\n' }],
  })
  await page.goto(`./#/tree/${REPO}/phone.md`)
  await signInHere(page)
  await page.locator('.cm-content').getByText('A quick sketch.').tap()
  await page
    .getByRole('toolbar', { name: 'Formatting' })
    .getByRole('button', { name: 'Draw' })
    .click()
  const svg = page.locator('.cm-ink[data-drawing] .cm-ink-svg')
  await expect(svg).toBeVisible()
  const box = (await svg.boundingBox())!
  await page.evaluate((box) => {
    const target = document.querySelector('.cm-ink-svg')!
    const send = (name: string, t: number) =>
      target.dispatchEvent(
        new PointerEvent(name, {
          pointerType: 'touch',
          pointerId: 3,
          isPrimary: true,
          pressure: 0.5,
          bubbles: true,
          cancelable: true,
          clientX: box.x + box.width * (0.2 + 0.6 * t),
          clientY: box.y + box.height * 0.5,
        }),
      )
    send('pointerdown', 0)
    for (let i = 1; i <= 8; i++) send('pointermove', i / 8)
    send('pointerup', 1)
  }, box)
  await expect(page.locator('.cm-ink-svg g path')).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText(/Unsaved/)
})
