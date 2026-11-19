// Issue #63: Refresh and Save in the top bar, on phones too. Save commits pending edits now
// (as Ctrl/Cmd+S does); Refresh brings in what other devices committed.

import { treesOf } from '../src/map/family'
import { expect, isPhone, signIn, signInHere, test } from './fixtures'

const REPO = 'you/engineering'

test('Refresh and Save are on screen, on every device', async ({ page }) => {
  await signIn(page)
  const width = page.viewportSize()!.width
  const onScreen = async (name: string) => {
    const box = (await page.getByRole('button', { name }).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  }
  await onScreen('Refresh')
  // Nothing to save yet: a phone, short of room, hides Save until there is.
  const save = page.getByRole('button', { name: 'Save now' })
  if (isPhone(page)) await expect(save).toBeHidden()
  else await expect(save).toBeDisabled()

  await page.locator('header').getByRole('button', { name: 'New note' }).click()
  await page.getByRole('dialog').getByRole('textbox').first().fill('Written by hand')
  await page.getByRole('dialog').getByRole('button', { name: 'Create note' }).click()
  await expect(save).toBeEnabled()
  await onScreen('Save now')
})

test('Refresh shows a leaf another device committed', async ({ page, fake, graph }) => {
  await signIn(page)
  const branch = treesOf(graph).find((id) => graph.nodes.get(id)!.kind === 'branch')!
  const id = `${branch}/from-elsewhere.md`
  await fake.repo(REPO).commit({
    message: 'From another device',
    additions: [{ path: id, contents: '# From elsewhere\n\nWritten on a phone.\n' }],
  })
  const node = page.locator(`[data-node][data-id="${id}"]`)
  await expect(node).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(node).toHaveCount(1)
})

test('Save commits pending edits at once, without waiting two minutes', async ({
  page,
  fake,
  graph,
}) => {
  test.skip(isPhone(page), 'Typing tests run on desktop engines')
  await page.clock.install()
  const leaf = [...graph.nodes.values()].find((n) => n.kind === 'leaf' && !n.children.length)!
  await page.goto(`./#/tree/${REPO}/${leaf.id}`)
  await signInHere(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nSaved by hand.')
  await expect(page.getByRole('status')).toContainText('Unsaved edits')
  fake.resetLog()

  await page.getByRole('button', { name: 'Save now' }).click()
  await expect.poll(() => fake.log.filter((e) => e.operation === 'mutation').length).toBe(1)
  await expect(page.getByRole('status')).toContainText('Synced')
  expect(fake.repo(REPO).read(leaf.id)).toContain('Saved by hand.')
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled()
})

test('Refresh brings another device’s changes into the open note, fading only what changed', async ({
  page,
  fake,
  graph,
}) => {
  test.skip(isPhone(page), 'Typing tests run on desktop engines')
  const leaf = [...graph.nodes.values()].find((n) => n.kind === 'leaf' && !n.children.length)!
  const before = fake.repo(REPO).read(leaf.id)!
  const [title, ...rest] = before.split('\n')
  // A few words of the first paragraph (its links are drawn as chips).
  const kept = rest.find((l) => l.trim() && !l.startsWith('<!--'))!.slice(0, 30)
  await page.goto(`./#/tree/${REPO}/${leaf.id}`)
  await signInHere(page)
  const content = page.locator('.cm-content')
  await expect(content).toContainText(kept)

  // Another device: a new icon, a new paragraph, an equation, and the first paragraph taken away.
  const after = [
    title!.replace(/^# /, '# 🔑 '),
    '',
    'Written on another device.',
    '',
    '$$x^2$$',
    '',
  ].join('\n')
  await fake.repo(REPO).commit({
    message: 'From another device',
    additions: [{ path: leaf.id, contents: after }],
  })
  fake.resetLog()
  await page.getByRole('button', { name: 'Refresh' }).click()

  // The note stays open and takes the new version: the new parts fade in, the old fade out.
  await expect(content).toContainText('Written on another device.')
  await expect(content.locator('.cm-arrived').first()).toBeVisible()
  await expect(content.locator('.cm-departed').first()).toBeAttached()
  await expect(page.locator('[data-leaf] [data-arrived]')).toContainText('🔑')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  // Then the fades end, and only the new version is left.
  await expect(content.locator('.cm-arrived, .cm-departed')).toHaveCount(0)
  await expect(content).not.toContainText(kept)
  // Taking it isn't an edit: nothing to save, nothing committed back.
  await expect(page.getByRole('status')).toContainText('Synced')
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled()
  expect(fake.log.filter((e) => e.operation === 'mutation')).toHaveLength(0)
  // Undo is for this device's typing: it doesn't bring the old version back.
  await content.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(content).toContainText('Written on another device.')
})
