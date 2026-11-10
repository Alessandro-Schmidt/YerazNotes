// The app's version, and whether a newer one is out: the latest published GitHub Release of
// Yeraz's own repository, asked without a token and only when someone presses the button on
// the introduction (owner's request, PRIVACY.md). The web app updates itself by reloading
// into the new build; the desktop app has no updater, so it links to the release's installers.

import { githubApi } from '../github/endpoint'

/** This build's version: the desktop app's (src-tauri/tauri.conf.json), set by vite.config.ts. */
export const VERSION: string = __YERAZ_VERSION__
export const YERAZ_REPO = 'Alessandro-Schmidt/YerazNotes'

export interface Release {
  version: string
  /** The release's page on GitHub: its notes and installers. */
  url: string
}

const numbers = (v: string) =>
  v
    .replace(/^v/, '')
    .split('-')[0]!
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)

/** `a` is a later version than `b` (dotted numbers; a leading v and a `-suffix` aside). */
export function isNewer(a: string, b: string): boolean {
  const x = numbers(a)
  const y = numbers(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** The newest published release (GitHub leaves out drafts and pre-releases). */
export async function latestRelease(api = githubApi(), doFetch = fetch): Promise<Release> {
  let res: Response
  try {
    res = await doFetch(`${api}/repos/${YERAZ_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
  } catch {
    throw new Error("Couldn't reach GitHub to check.")
  }
  if (res.status === 404) throw new Error('GitHub lists no release yet.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  const body = (await res.json()) as { tag_name: string; html_url: string }
  return { version: body.tag_name.replace(/^v/, ''), url: body.html_url }
}

/**
 * The web app: fetch the new build through the service worker, then reload into it. Edits not
 * committed yet are kept on this device, so they survive the reload.
 */
export async function reloadIntoUpdate(): Promise<void> {
  const workers = navigator.serviceWorker
  const registration = await workers?.getRegistration().catch(() => undefined)
  if (registration) {
    await registration.update().catch(() => undefined)
    // The new worker takes over by itself (vite.config.ts: autoUpdate); wait for it, a while.
    if (registration.installing ?? registration.waiting)
      await new Promise<void>((done) => {
        workers.addEventListener('controllerchange', () => done(), { once: true })
        setTimeout(done, 10_000)
      })
  }
  location.reload()
}
