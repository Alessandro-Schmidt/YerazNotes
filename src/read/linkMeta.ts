// A bookmark's page title and description (og:title, og:description, description), shown
// under its card. Only the desktop app can read another site's page (the browser's CORS and
// the web build's Content-Security-Policy refuse it), so the web shows the card as it was.
// The page is untrusted: only text is read out of it, by pattern, and shown as text.

import { openStore, type KeyValueStore } from '../store/db'
import { desktopInvoke } from '../store/token'

export interface LinkMeta {
  title?: string
  description?: string
}

const MAX = 300
const clean = (s: string | null | undefined) =>
  s?.replace(/\s+/g, ' ').trim().slice(0, MAX) || undefined

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
}
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]!)

/** The title and description in a page's HTML, read as text: nothing in it is parsed or run. */
export function parseMeta(html: string): LinkMeta {
  const head = html.slice(0, 200_000)
  const metas = new Map<string, string>()
  for (const [tag] of head.matchAll(/<meta\s(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    const attr = (name: string) =>
      new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
        .exec(tag)
        ?.slice(1)
        .find((v) => v !== undefined)
    const key = (attr('property') ?? attr('name'))?.toLowerCase()
    const content = attr('content')
    if (key && content !== undefined && !metas.has(key)) metas.set(key, decode(content))
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]
  return {
    title: clean(metas.get('og:title')) ?? clean(title && decode(title)),
    description: clean(metas.get('og:description')) ?? clean(metas.get('description')),
  }
}

let store: KeyValueStore | undefined
const asked = new Map<string, Promise<LinkMeta | null>>()

/** A page's metadata, from this device's cache or (desktop) fetched once; null when unknown. */
export function linkMeta(
  url: string,
  fetchPage = desktopInvoke &&
    ((u: string) => desktopInvoke!('fetch_page', { url: u }) as Promise<string>),
): Promise<LinkMeta | null> {
  if (!fetchPage || !url.startsWith('https://')) return Promise.resolve(null)
  let run = asked.get(url)
  if (!run) {
    store ??= openStore()
    const kv = store
    run = (async () => {
      const cached = await kv.get<LinkMeta>(`meta:${url}`)
      if (cached) return cached
      try {
        const found = parseMeta(await fetchPage(url))
        await kv.set(`meta:${url}`, found)
        return found
      } catch {
        return null
      }
    })()
    asked.set(url, run)
  }
  return run
}

/**
 * Fills a bookmark card: its title when the link had none of its own (its text is the
 * address), and a description line. Text only.
 */
export function fillBookmark(card: Element, url: string) {
  void linkMeta(url).then((meta) => {
    if (!meta) return
    const title = card.querySelector('strong')
    if (title && meta.title && /^https?:\/\//.test(title.textContent ?? ''))
      title.textContent = meta.title
    if (meta.description && !card.querySelector('.bookmark-desc')) {
      const desc = document.createElement('small')
      desc.className = 'bookmark-desc'
      desc.textContent = meta.description
      title?.after(desc)
    }
  })
}
