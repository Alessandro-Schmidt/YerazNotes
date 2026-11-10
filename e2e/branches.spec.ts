// Text on branches (issue #14): a branch's text is the README.md in its folder. It shows in
// the branch's Peek above what the branch holds, always in the leaf editor (no button to
// start writing), without its heading, and is never a leaf itself. The folders here are at the top of the Family, so each is a Tree: a Tree's
// text works the same way.

import type { Page } from '@playwright/test'
import type { FakeGitHub } from '../test/fake-github/fakeGitHub'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/notes'
const FILES = {
  '.yeraz.json': '{"name":"Notes"}',
  'AI Agents/README.md':
    '# 🤖 Agents handbook\n\nWhat this branch is for. Start with [Prompting](</AI Agents/prompting.md>).\n',
  'AI Agents/prompting.md': '# Prompting\n\nWrite clearly.\n',
  'Cloud/docker.md': '# Docker\n\nSee [the agents](</AI Agents/README.md>).\n',
}

const peekOf = (page: Page, kind: 'Project' | 'Note') =>
  page.getByRole('region', { name: `${kind} preview` })
const mutations = (fake: FakeGitHub) => fake.log.filter((e) => e.operation === 'mutation')

test.beforeEach(async ({ fake }) => {
  await fake.addRepo(REPO, FILES)
})

test("a branch's README.md is its text, above what is inside, and never a leaf", async ({
  page,
}) => {
  await page.goto(`./#/tree/${REPO}/AI%20Agents`)
  await signInHere(page)
  const peek = peekOf(page, 'Project')
  // The README's heading is the group's title, written like a note's (owner's decision).
  await expect(peek.locator('.cm-title')).toHaveText('Agents handbook')
  const text = peek.getByText('What this branch is for.')
  await expect(text).toBeVisible()
  const inside = peek.getByRole('heading', { name: 'Inside this project' })
  expect((await text.boundingBox())!.y).toBeLessThan((await inside.boundingBox())!.y)
  await expect(peek.getByRole('button', { name: 'Add text' })).toHaveCount(0)
  await expect(peek.locator('.cm-hint')).toHaveCount(0)
  // Not a node on the map, nor a row in the Explorer.
  await expect(page.locator('[data-map] > svg [data-tree="AI Agents"] [data-core]')).toBeVisible()
  await expect(page.locator('[data-id$="README.md"], [data-row$="README.md"]')).toHaveCount(0)

  // A mention in the branch's text opens the leaf; a link to the README opens the branch.
  await peek.locator('.cm-mention', { hasText: 'Prompting' }).click()
  await expect(peekOf(page, 'Note').getByRole('heading', { name: 'Prompting' })).toBeVisible()
  await page.goto(`./#/tree/${REPO}/Cloud/docker.md`)
  // The leaf is in its editor there, where the link is a chip.
  await peekOf(page, 'Note').locator('.cm-mention', { hasText: 'the agents' }).click()
  await expect(peekOf(page, 'Project').getByText('What this branch is for.')).toBeVisible()
})

test.describe('writing a branch’s text', () => {
  test.skip(({ isMobile }) => isMobile, 'Typing tests run on desktop engines')

  test('an empty text says how to write it; the first save commits README.md, in one commit', async ({
    page,
    fake,
  }) => {
    await page.goto(`./#/tree/${REPO}/Cloud`)
    await signInHere(page)
    const peek = peekOf(page, 'Project')
    await expect(peek.locator('.cm-hint')).toHaveText(
      /^→Click to write, hold (⌘|Ctrl) to see options$/,
    )
    // The text starts from the group's name, its title, written like a note's.
    await expect(peek.locator('.cm-title')).toHaveText('Cloud')
    // A branch's icon, cover and colours are its text's (icons.spec.ts); none here yet.
    await expect(peek.getByRole('button', { name: 'Add cover' })).toBeVisible()
    expect(fake.repo(REPO).read('Cloud/README.md')).toBeUndefined()

    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('Containers and where they run.')
    await expect(peek.locator('.cm-hint')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Unsaved edits')
    fake.resetLog()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => mutations(fake).length).toBe(1)
    expect(fake.repo(REPO).read('Cloud/README.md')).toBe(
      '# Cloud\n\nContainers and where they run.',
    )

    await expect(peek.getByText('Containers and where they run.')).toBeVisible()
    await expect(peek.getByRole('button', { name: 'Add text' })).toHaveCount(0)
    await expect(page.locator('[data-id$="README.md"], [data-row$="README.md"]')).toHaveCount(0)
  })
})

test("a group's title is its text's heading: retitled there, renamed on the map and in the Explorer", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'typing')
  await page.goto(`./#/tree/${REPO}/AI%20Agents`)
  await signInHere(page)
  const title = peekOf(page, 'Project').locator('.cm-title')
  await expect(title).toHaveText('Agents handbook')
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 2')
  await expect(page.locator('[data-map] > svg [data-tree="AI Agents"]').first()).toContainText(
    'Agents handbook 2',
  )
})
