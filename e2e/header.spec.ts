// Lines 1 and 2, the leaf's header (ARCHITECTURE.md §4): shown as the title and the look
// above the text, never as Markdown, and written in place, never twice.

import type { Page } from '@playwright/test'
import type { FakeGitHub } from '../test/fake-github/fakeGitHub'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'
const AMBER = '<!-- yeraz {"color":{"heading":"amber"}} -->'
const ARMENIA = `# 🇦🇲 Armenia\n${AMBER}\n\nMount Ararat.\n`

async function open(page: Page, fake: FakeGitHub, text: string) {
  await fake
    .repo(REPO)
    .commit({ message: 'Armenia', additions: [{ path: 'armenia.md', contents: text }] })
  await page.goto(`./#/tree/${REPO}/armenia.md`)
  await signInHere(page)
  const content = page.getByRole('region', { name: 'Note preview' }).locator('.cm-content')
  await expect(content).toContainText('Mount Ararat')
  return content
}

test.describe('the header', () => {
  test.skip(({ isMobile }) => isMobile, 'Typing tests run on desktop engines')

  test('line 2 never shows; Enter after the title starts the text below it', async ({
    page,
    fake,
  }) => {
    const content = await open(page, fake, ARMENIA)
    await expect(content).not.toContainText('yeraz')
    await content.getByText('Armenia').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Capital: Yerevan')
    await expect(content).not.toContainText('yeraz')
    await page.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() => fake.repo(REPO).read('armenia.md'))
      .toBe(`# 🇦🇲 Armenia\n${AMBER}\nCapital: Yerevan\n\nMount Ararat.\n`)
  })

  test('a cover and its position replace line 2', async ({ page, fake }) => {
    await open(page, fake, ARMENIA)
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1500
      canvas.height = 1000
      canvas.getContext('2d')!.fillRect(0, 0, 1500, 1000)
      return canvas.toDataURL('image/png')
    })
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add cover' }).click()
    await (
      await chooser
    ).setFiles({
      name: 'orbis-2026-10-02.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'),
    })
    // Reposition is in the cover's one button (with Upload and Remove).
    await page.getByRole('button', { name: 'Change cover' }).click()
    await page.getByRole('menuitem', { name: 'Reposition' }).click()
    await page.getByRole('slider', { name: 'Cover position' }).press('ArrowDown')
    await page.getByRole('button', { name: 'Save position' }).click()
    await page.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() => fake.repo(REPO).read('armenia.md'))
      .toMatch(
        /^# 🇦🇲 Armenia\n<!-- yeraz \{"color":\{"heading":"amber"\},"cover":"\/assets\/\d{4}-\d{2}-\d{2}-orbis-2026-10-02\.png","coverPosition":45\} -->\n\nMount Ararat\.\n$/,
      )
  })

  test('a header already repeated in the file shows once, and the next save repairs it', async ({
    page,
    fake,
  }) => {
    const cover = '<!-- yeraz {"color":{"heading":"amber"},"coverPosition":37} -->'
    const content = await open(
      page,
      fake,
      `# 🇦🇲 Armenia\n${AMBER}\n\n# 🇦🇲 Armenia\n${cover}\n\nMount Ararat.\n`,
    )
    await expect(content).not.toContainText('yeraz')
    await expect(content.getByText('Armenia')).toHaveCount(1)
    await content.getByText('Mount Ararat.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 5,165 m.')
    await page.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() => fake.repo(REPO).read('armenia.md'))
      .toBe(`# 🇦🇲 Armenia\n${cover}\n\nMount Ararat. 5,165 m.\n`)
  })
  test('the icon beside the title, and the cover’s format, are line-2 choices', async ({
    page,
    fake,
  }) => {
    const cover = '<!-- yeraz {"color":{"heading":"amber"},"cover":"https://example.com/c.png"} -->'
    const content = await open(page, fake, `# 🇦🇲 Armenia\n${cover}\n\nMount Ararat.\n`)
    const title = content.locator('.cm-title')
    const icon = page.getByRole('button', { name: 'Change icon 🇦🇲' })
    // Above the title, as before.
    expect((await icon.boundingBox())!.y + 20).toBeLessThan((await title.boundingBox())!.y)

    await icon.click()
    await page.getByRole('menuitemcheckbox', { name: 'Beside the title' }).click()
    const [a, t] = [(await icon.boundingBox())!, (await title.boundingBox())!]
    expect(Math.abs(a.y + a.height / 2 - (t.y + t.height / 2))).toBeLessThan(8)
    expect((await title.textContent())!.trim()).toBe('Armenia')

    await page.getByRole('button', { name: 'Change cover' }).click()
    await page.getByRole('menuitemradio', { name: 'Slim' }).click()
    await page.keyboard.press('ControlOrMeta+s')
    await expect
      .poll(() => fake.repo(REPO).read('armenia.md'))
      .toBe(
        '# 🇦🇲 Armenia\n<!-- yeraz {"color":{"heading":"amber"},"cover":"https://example.com/c.png","iconInline":true,"coverAspect":"slim"} -->\n\nMount Ararat.\n',
      )
  })
})
