// Panel widths (issue #80): the Explorer and the Peek (floating, or docked beside the
// Columns) are dragged wider or narrower by their inner edge, and each width is saved for
// this device, like the theme and the view. The page holds them as CSS variables.

/** A kept (pinned) note's column has its own width, by its place in the stack: `pin0`, `pin1`… */
export type Panel = 'explorer' | 'peek' | 'dock' | `pin${number}`
type Base = 'explorer' | 'peek' | 'dock'

/**
 * The height (px) of a phone's bottom sheet, as Peek.module.css draws it: 60% of the screen,
 * at most 520 px. The map keeps that much free below what it centres.
 */
export const SHEET_HEIGHT = () => Math.round(Math.min(window.innerHeight * 0.6, 520))

export const PANELS: Record<Base, { initial: number; min: number; max: number }> = {
  explorer: { initial: 272, min: 200, max: 520 },
  peek: { initial: 420, min: 320, max: 960 },
  dock: { initial: 640, min: 360, max: 1100 },
}

export type Widths = Record<Base, number> & Partial<Record<`pin${number}`, number>>

/** A panel's least, most and initial widths: a kept note's are the Peek's. */
export const limits = (panel: Panel) => PANELS[panel as Base] ?? PANELS.peek

/** A panel's width: saved, or its initial one. */
export const widthOf = (w: Widths, panel: Panel): number => w[panel] ?? limits(panel).initial

/** localStorage key of the device's panel widths. */
export const WIDTHS_KEY = 'yeraz-panels'

/** A width the panel can take: whole pixels, between its least and most. */
export const clampWidth = (panel: Panel, width: number) =>
  Math.round(Math.min(limits(panel).max, Math.max(limits(panel).min, width)))

const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined // blocked storage throws on access
  }
}

const initial = (): Widths => ({
  explorer: PANELS.explorer.initial,
  peek: PANELS.peek.initial,
  dock: PANELS.dock.initial,
})

/** The widths saved on this device; each one unsaved or unreadable is its initial width. */
export function savedWidths(store = storage()): Widths {
  const widths = initial()
  try {
    const saved = JSON.parse(store?.getItem(WIDTHS_KEY) ?? '{}') as Partial<Widths>
    const keys = Object.keys(saved).filter((k) => /^pin\d+$/.test(k))
    for (const panel of [...Object.keys(widths), ...keys] as Panel[]) {
      const w = saved[panel]
      if (typeof w === 'number' && Number.isFinite(w)) widths[panel] = clampWidth(panel, w)
    }
  } catch {
    // Unreadable: the initial widths.
  }
  return widths
}

const listeners = new Set<() => void>()
let current: Widths | null = null

/** Saves one panel's width (clamped); null puts it back to its initial width. */
export function saveWidth(panel: Panel, width: number | null, store = storage()): void {
  const next = {
    ...widthStore.get(),
    [panel]: width === null ? limits(panel).initial : clampWidth(panel, width),
  }
  try {
    store?.setItem(WIDTHS_KEY, JSON.stringify(next))
  } catch {
    // Private windows may refuse storage; the width still changes for this visit.
  }
  current = next
  for (const l of listeners) l()
}

/** For useSyncExternalStore: the widths, kept in memory once read, and their changes. */
export const widthStore = {
  get: (): Widths => (current ??= savedWidths()),
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** The CSS variable each panel's width is in. */
export const widthVar = (panel: Panel) => `--${panel}-w`

/** The widths as the page's CSS variables. */
export const widthVars = (w: Widths) =>
  Object.fromEntries((Object.keys(w) as Panel[]).map((p) => [widthVar(p), `${w[p]}px`]))

/** localStorage key of each note's own width, by its id: a note keeps its width wherever it shows. */
export const NOTE_WIDTHS_KEY = 'yeraz-note-widths'

const noteWidths = (store = storage()): Record<string, number> => {
  try {
    return JSON.parse(store?.getItem(NOTE_WIDTHS_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/** A note's own width, or null when it has none (the Peek's initial width). */
export const noteWidth = (id: string, store = storage()): number | null => {
  const w = noteWidths(store)[id]
  return typeof w === 'number' && Number.isFinite(w) ? clampWidth('peek', w) : null
}

/** Saves a note's own width; null forgets it. */
export function saveNoteWidth(id: string, width: number | null, store = storage()): void {
  const all = noteWidths(store)
  if (width === null) delete all[id]
  else all[id] = clampWidth('peek', width)
  try {
    store?.setItem(NOTE_WIDTHS_KEY, JSON.stringify(all))
  } catch {
    // Refused storage: the width holds for this visit only.
  }
}

/** Which side a kept (pinned) note stays on; new notes open on the other side. */
export type PinSide = 'left' | 'right'

/** localStorage key of the device's pinned side. */
export const PIN_SIDE_KEY = 'yeraz-pin-side'

/** The pinned side saved on this device: left unless saved right. */
export function savedPinSide(store = storage()): PinSide {
  try {
    return store?.getItem(PIN_SIDE_KEY) === 'right' ? 'right' : 'left'
  } catch {
    return 'left'
  }
}

export function savePinSide(side: PinSide, store = storage()): void {
  try {
    store?.setItem(PIN_SIDE_KEY, side)
  } catch {
    // Refused storage: the side still changes for this visit.
  }
}
