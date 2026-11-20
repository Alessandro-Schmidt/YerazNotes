// The image viewer (development-plan.md M6): an image expanded to the whole screen, turned,
// flipped and marked up (pen, highlighter, shapes), the note then showing the marked-up copy,
// the original kept. A JPEG turns by its EXIF orientation alone.

import { deflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { jpegOrientation } from '../src/model/orient'
import { expect, signInHere, test } from './fixtures'

const REPO = 'you/engineering'
const LEAF = 'pictures.md'
const PNG = 'assets/2026-11-20-realm.png'

/** A PNG of one colour, `width`×`height`. */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rows.set([40, 120, 200], y * (width * 3 + 1) + 1 + x * 3)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/** A PNG's width and height, from its header. */
const sizeOf = (bytes: Uint8Array) => {
  const view = Buffer.from(bytes)
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) }
}

type Repo = {
  head: { files: Map<string, string> }
  blobs: Map<string, Uint8Array>
  read(path: string): string
}
const at = (repo: Repo, path: string) => {
  const sha = repo.head.files.get(path)
  return sha ? repo.blobs.get(sha)! : null
}
const mutations = (fake: { log: { operation?: string }[] }) =>
  fake.log.filter((e) => e.operation === 'mutation')

async function commitLeaf(
  fake: { repo(name: string): { commit(c: unknown): Promise<unknown> } },
  size: [number, number] = [80, 40],
) {
  await fake.repo(REPO).commit({
    message: 'pictures',
    additions: [
      { path: PNG, contents: png(...size) },
      { path: LEAF, contents: `# Pictures\n\nThe realm:\n\n![Realm](/${PNG})\n` },
    ],
  })
}

async function openLeaf(page: Page) {
  await page.goto(`./#/tree/${REPO}/${LEAF}`)
  await signInHere(page)
  await expect(page.locator('.cm-image img')).toHaveJSProperty('complete', true)
}

async function expand(page: Page) {
  const image = page.locator('.cm-image').first()
  await image.hover()
  await image.getByRole('button', { name: 'Expand Realm' }).click()
  const viewer = page.getByRole('dialog', { name: 'Realm' })
  await expect(viewer).toBeVisible({ timeout: 15_000 })
  await expect(viewer.getByRole('button', { name: 'Done' })).toBeEnabled({ timeout: 15_000 })
  return viewer
}

/** A drag across the picture, in fractions of its size. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator('.yz-viewer .cm-ink-svg').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 6 })
  await page.mouse.up()
}

test.describe('on a computer', () => {
  test.skip(({ isMobile }) => isMobile, 'The expand button shows on hover')

  test('turned right in the viewer, the image is turned in the note, in one commit', async ({
    page,
    fake,
  }) => {
    await commitLeaf(fake)
    await openLeaf(page)
    const viewer = await expand(page)
    await viewer.getByRole('button', { name: 'Turn right' }).click()
    await viewer.getByRole('button', { name: 'Done' }).click()
    await expect(viewer).toHaveCount(0)

    fake.resetLog()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => mutations(fake).length).toBe(1)
    const repo = fake.repo(REPO) as unknown as Repo
    expect(sizeOf(at(repo, PNG)!)).toEqual({ width: 40, height: 80 })
    // The note still links to the same file.
    expect(repo.read(LEAF)).toContain(`![Realm](/${PNG})`)
  })

  test('marked up: the note shows a copy with the marks, the original kept; erased, it is back', async ({
    page,
    fake,
  }) => {
    await commitLeaf(fake)
    await openLeaf(page)
    let viewer = await expand(page)
    await viewer.getByRole('button', { name: 'Draw' }).click()
    const tools = page.getByRole('toolbar', { name: 'Drawing tools' })
    await tools.getByRole('button', { name: 'Rectangle' }).click()
    await drag(page, [0.2, 0.2], [0.6, 0.7])
    await tools.getByRole('button', { name: 'Highlighter' }).click()
    await drag(page, [0.1, 0.9], [0.9, 0.9])
    await expect(viewer.locator('.cm-ink-svg g path')).toHaveCount(2)
    await viewer.getByRole('button', { name: 'Done' }).click()
    await expect(viewer).toHaveCount(0)

    const marked = PNG.replace('.png', '.marked.png')
    await expect(page.locator(`.cm-image[data-src="/${marked}"]`)).toBeVisible()
    fake.resetLog()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => mutations(fake).length).toBe(1)
    const repo = fake.repo(REPO) as unknown as Repo
    expect(repo.read(LEAF)).toContain(`![Realm](/${marked})`)
    // The original is untouched; the copy is its size, with the marks drawn in.
    expect(at(repo, PNG)).toEqual(png(80, 40))
    expect(sizeOf(at(repo, marked)!)).toEqual({ width: 80, height: 40 })
    const strokes = repo.read(PNG.replace('.png', '.marked.ink.svg'))
    expect(strokes).toContain(`"image":"${PNG}"`)
    expect(strokes).toContain('"tool":"rect"')
    expect(strokes).toContain('"tool":"highlighter"')

    // Opened again, the marks are there to change: all of them deleted, the note shows the
    // original again and the copy goes.
    viewer = await expand(page)
    await expect(viewer.locator('.cm-ink-svg g path')).toHaveCount(2)
    await viewer.getByRole('button', { name: 'Draw' }).click()
    await page.locator('.yz-viewer .cm-ink').focus()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await expect(viewer.locator('.cm-ink-svg g path')).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator(`.cm-image[data-src="/${PNG}"]`)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => (fake.repo(REPO) as unknown as Repo).read(LEAF)).toContain(`(/${PNG})`)
    const after = fake.repo(REPO) as unknown as Repo
    expect(at(after, marked)).toBeNull()
    expect(at(after, PNG.replace('.png', '.marked.ink.svg'))).toBeNull()
  })

  test('Cancel leaves the note and the image as they were', async ({ page, fake }) => {
    await commitLeaf(fake)
    await openLeaf(page)
    const viewer = await expand(page)
    await viewer.getByRole('button', { name: 'Turn left' }).click()
    await viewer.getByRole('button', { name: 'Cancel' }).click()
    await expect(viewer).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Synced')
  })

  test('a JPEG turns by its EXIF orientation: its pixels stay byte for byte', async ({
    page,
    fake,
  }) => {
    await page.goto('./')
    const jpeg = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 60
      canvas.height = 30
      const c = canvas.getContext('2d')!
      c.fillStyle = 'teal'
      c.fillRect(0, 0, 60, 30)
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9))
      return [...new Uint8Array(await blob.arrayBuffer())]
    })
    const original = new Uint8Array(jpeg)
    const path = 'assets/photo.jpg'
    await fake.repo(REPO).commit({
      message: 'photo',
      additions: [
        { path, contents: original },
        { path: LEAF, contents: `# Pictures\n\n![Realm](/${path})\n` },
      ],
    })
    await openLeaf(page)
    const viewer = await expand(page)
    await viewer.getByRole('button', { name: 'Turn right' }).click()
    await viewer.getByRole('button', { name: 'Done' }).click()
    await page.keyboard.press('ControlOrMeta+s')
    const repo = fake.repo(REPO) as unknown as Repo
    await expect.poll(() => jpegOrientation(at(repo, path) ?? original)).toBe(6)
    const turned = at(repo, path)!
    // The scan data, from its start marker on, is unchanged.
    const scan = (b: Uint8Array) => {
      for (let i = 2; i < b.length - 1; i++)
        if (b[i] === 0xff && b[i + 1] === 0xda) return b.subarray(i)
      return b
    }
    expect(Buffer.from(scan(turned)).equals(Buffer.from(scan(original)))).toBe(true)
  })

  test('the read view expands an image to look at, without tools', async ({ page, fake }) => {
    await fake.repo(REPO).commit({
      message: 'readme',
      additions: [
        { path: PNG, contents: png(80, 40) },
        { path: 'README.md', contents: `# Engineering\n\n![Realm](/${PNG})\n` },
      ],
    })
    await page.goto(`./#/tree/${REPO}`)
    await signInHere(page)
    await page.getByRole('button', { name: 'Show note panel' }).click()
    await page.locator('.reading').getByRole('img', { name: 'Realm' }).click()
    const viewer = page.getByRole('dialog', { name: 'Realm' })
    await expect(viewer.getByRole('img', { name: 'Realm' })).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Draw' })).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Zoom in' }).click()
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
  })
})

test.describe('on a touch screen', () => {
  test.skip(({ isMobile }) => !isMobile, 'A tap opens the image on touch screens')

  test('a tap on the image opens it, and a finger draws on it', async ({ page, fake }) => {
    // Large enough that its middle is clear of its buttons.
    await commitLeaf(fake, [400, 200])
    await openLeaf(page)
    await page.locator('.cm-image img').tap()
    const viewer = page.getByRole('dialog', { name: 'Realm' })
    // The viewer's code and the picture load on the first tap: slow on a busy phone.
    await expect(viewer.getByRole('button', { name: 'Done' })).toBeEnabled({ timeout: 15_000 })
    await viewer.getByRole('button', { name: 'Draw' }).click()
    const box = (await page.locator('.yz-viewer .cm-ink-svg').boundingBox())!
    await page.evaluate((box) => {
      const svg = document.querySelector('.yz-viewer .cm-ink-svg')!
      const send = (name: string, t: number) =>
        svg.dispatchEvent(
          new PointerEvent(name, {
            pointerType: 'touch',
            pointerId: 4,
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
    await expect(viewer.locator('.cm-ink-svg g path')).toHaveCount(1)
    await viewer.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.cm-image[data-src$=".marked.png"]')).toBeVisible()
  })
})
