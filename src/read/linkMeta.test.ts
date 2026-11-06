import { describe, expect, it, vi } from 'vitest'
import { linkMeta, parseMeta } from './linkMeta'

describe('parseMeta', () => {
  it('prefers og:, falls back to <title> and description, text only', () => {
    expect(
      parseMeta(
        '<title>Plain</title><meta property="og:title" content="OG <b>t</b>"><meta name="description" content="  A   page\n">',
      ),
    ).toEqual({ title: 'OG <b>t</b>', description: 'A page' })
    expect(parseMeta('<title>Plain</title><script>alert(1)</script>')).toEqual({
      title: 'Plain',
      description: undefined,
    })
  })
})

describe('linkMeta', () => {
  it('fetches an https page once and caches it; nothing without a fetcher', async () => {
    const fetchPage = vi.fn(async () => '<meta property="og:description" content="Hi">')
    const url = 'https://example.com/a'
    expect(await linkMeta(url, fetchPage)).toEqual({ title: undefined, description: 'Hi' })
    await linkMeta(url, fetchPage)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(await linkMeta('http://example.com', fetchPage)).toBeNull()
    expect(await linkMeta('https://example.com/b', undefined)).toBeNull()
  })
})
