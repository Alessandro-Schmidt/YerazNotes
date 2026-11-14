// A formatting bar above the keyboard on touch screens (owner's request), where there is no
// Ctrl: bold, italic, code, a link, a bullet list, a to-do, indent and outdent (no Tab key). It appears while the text has the
// focus, just above the keyboard (the visual viewport's bottom edge), and keeps the focus in
// the text when tapped, so the keyboard stays. Elsewhere the shortcuts (format.ts) do this.
// With a hardware keyboard on a tablet there is no keyboard on screen, only the system's small
// shortcut bar: the bar then sits at the bottom of the page (owner's request), not floating
// above that bar, and leaves the middle free, where iPadOS draws it.

import { EditorView, ViewPlugin } from '@codemirror/view'
import { isTouch } from '../ui/platform'
import { indentCommand, link, outdentCommand, toggleWrap } from './format'
import { listChange } from './insertMenu'

const ITEMS: { label: string; text: string; run: (view: EditorView) => void }[] = [
  { label: 'Bold', text: 'B', run: (v) => v.dispatch(toggleWrap(v.state, '**')) },
  { label: 'Italic', text: 'I', run: (v) => v.dispatch(toggleWrap(v.state, '*')) },
  { label: 'Code', text: '‹›', run: (v) => v.dispatch(toggleWrap(v.state, '`')) },
  { label: 'Link', text: '', run: (v) => v.dispatch(link(v.state)) },
  { label: 'Bullet list', text: '•', run: (v) => v.dispatch(listChange(v.state, 'bullet')) },
  { label: 'To-do', text: '☐', run: (v) => v.dispatch(listChange(v.state, 'todo')) },
  { label: 'Indent', text: '⇥', run: (v) => void indentCommand(v) },
  { label: 'Outdent', text: '⇤', run: (v) => void outdentCommand(v) },
]

/** A chain link, the bar's only icon that no letter or sign draws. */
const LINK_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg>'

/**
 * Less than this hidden at the bottom is no keyboard on screen: at most a hardware keyboard's
 * shortcut bar (iPadOS's is about 55 px), never a touch keyboard (well over 200 px).
 */
const NO_KEYBOARD = 120
/** How long a touch keyboard takes to come up, and more: the bar is docked for good after it. */
const SETTLE_MS = 500

export const toolbar = ViewPlugin.define((view) => {
  if (!isTouch()) return {}
  const bar = document.createElement('div')
  bar.className = 'cm-toolbar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Formatting')
  for (const item of ITEMS) {
    const button = document.createElement('button')
    button.type = 'button'
    if (item.text) button.textContent = item.text
    else button.innerHTML = LINK_ICON
    button.setAttribute('aria-label', item.label)
    button.dataset.format = item.label
    // The text keeps the focus, and the keyboard stays.
    for (const type of ['pointerdown', 'mousedown', 'touchstart'])
      button.addEventListener(type, (e) => e.preventDefault())
    button.addEventListener('click', () => {
      item.run(view)
      view.focus()
    })
    bar.append(button)
    // The middle, left for the system's shortcut bar when the page's bottom is the bar's.
    if (item.label === 'Link')
      bar.append(Object.assign(document.createElement('span'), { className: 'cm-toolbar-gap' }))
  }
  const vv = window.visualViewport
  const root = document.documentElement.style
  let room: ReturnType<typeof setTimeout> | null = null
  /** The app has the page's whole height again. */
  const giveBack = () => {
    if (room !== null) clearTimeout(room)
    room = null
    root.removeProperty('--toolbar-dock')
  }
  /** Just above the keyboard: the bottom of what is visible, or the page's when none is on screen. */
  const place = () => {
    // The page's own height: iOS shortens `innerHeight` with the visible part at times.
    const page = document.documentElement.clientHeight
    const visible = vv ? vv.offsetTop + vv.height : page
    const docked = page - visible < NO_KEYBOARD
    bar.toggleAttribute('data-docked', docked)
    // Docked, the app ends above the bar (global.css): nothing of it is under the bar. Only
    // once it has stayed docked a moment: a touch keyboard on its way up starts out the same.
    if (docked)
      room ??= setTimeout(
        () => root.setProperty('--toolbar-dock', `${bar.offsetHeight}px`),
        SETTLE_MS,
      )
    else giveBack()
    const bottom = docked ? page : visible
    bar.style.top = `${bottom - bar.offsetHeight}px`
    bar.style.left = `${vv?.offsetLeft ?? 0}px`
    bar.style.width = `${vv?.width ?? window.innerWidth}px`
  }
  const show = () => {
    if (!bar.isConnected) document.body.append(bar)
    place()
    vv?.addEventListener('resize', place)
    vv?.addEventListener('scroll', place)
  }
  const hide = () => {
    bar.remove()
    giveBack()
    vv?.removeEventListener('resize', place)
    vv?.removeEventListener('scroll', place)
  }
  view.contentDOM.addEventListener('focus', show)
  view.contentDOM.addEventListener('blur', hide)
  if (view.hasFocus) show()
  return {
    destroy() {
      hide()
      view.contentDOM.removeEventListener('focus', show)
      view.contentDOM.removeEventListener('blur', hide)
    },
  }
})
