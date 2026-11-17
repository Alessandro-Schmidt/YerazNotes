// A note taken out of Yeraz (owner's request): it floats above everything, anywhere on the
// screen, until it is put back. Where the browser can (Chrome, Edge: Document Picture-in-
// Picture) it is a small window of its own, always on top, that the system lets the writer
// drag anywhere on the computer; elsewhere a card over the app, dragged by its head.
// One note floats at a time: floating another puts the first back.

import { useSyncExternalStore } from 'react'

export interface Floated {
  repo: string
  /** The note's (or group's) node id. */
  id: string
  /** The file its text is in: the note itself, or the group's README.md. */
  file: string
  /** Its path from the Family's root, for the copy button. */
  path: string
  /** Where "back in Yeraz" opens it: the URL hash of its node in the view it left. */
  back: string
  /** The always-on-top window, when the browser gives one. */
  window: Window | null
}

interface PipApi {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
}
const pip = (): PipApi | undefined =>
  (globalThis as { documentPictureInPicture?: PipApi }).documentPictureInPicture

let current: Floated | null = null
const listeners = new Set<() => void>()
const set = (next: Floated | null) => {
  current = next
  listeners.forEach((l) => l())
}

/**
 * Takes a note out of Yeraz. Call it from the click: the browser opens the window only for
 * a gesture. Without the window (no API, refused), the note floats over the app instead.
 */
export async function floatNote(note: Omit<Floated, 'window'>): Promise<void> {
  putBack(false)
  const win = await (pip()?.requestWindow({ width: 400, height: 560 }) ?? null)?.catch(() => null)
  set({ ...note, window: win ?? null })
}

/** Puts the floating note back; `open` shows it in Yeraz again, where it was. */
export function putBack(open = true): void {
  const was = current
  if (!was) return
  set(null)
  if (was.window && !was.window.closed) was.window.close()
  if (open) {
    window.location.hash = was.back.replace(/^#/, '')
    window.focus()
    // The URL may already be the note's (its Peek was only closed): the view reopens it.
    returned.forEach((l) => l())
  }
}

/** The window closed by the system (its own close button): the note is simply back. */
export function closed(win: Window): void {
  if (current?.window === win) set(null)
}

const returned = new Set<() => void>()
/** Calls `show` when a note is put back, for the view to open its Peek again. */
export function onPutBack(show: () => void): () => void {
  returned.add(show)
  return () => void returned.delete(show)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useFloated = () => useSyncExternalStore(subscribe, () => current)
