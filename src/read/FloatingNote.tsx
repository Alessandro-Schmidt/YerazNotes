// The floating note (float.ts): only the note, as it is written, with its path and its
// content to copy and a way back to Yeraz (owner's request: no options, no new notes, no
// counts, no pin, no full page). Drawn in its own always-on-top window when there is one,
// else as a card over the app, moved by its head.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { LeafEditor } from '../editor/LeafEditor'
import { session } from '../store/session'
import { Mark } from '../ui/Mark'
import { treeHref } from '../ui/paths'
import { CopyButton } from './CopyButton'
import { closed, putBack, type Floated } from './float'
import styles from './FloatingNote.module.css'

export default function FloatingNote({ note }: { note: Floated }) {
  const win = note.window
  useEffect(() => (win ? mirror(win) : undefined), [win])
  const body = <Note note={note} />
  return win ? createPortal(body, win.document.body) : <Card>{body}</Card>
}

function Note({ note }: { note: Floated }) {
  const content = async () => {
    const { files, textOf } = session.getState()
    return files(note.repo).includes(note.file) ? textOf(note.repo, note.file) : ''
  }
  return (
    <section className={styles.note} aria-label="Floating note">
      <div className={styles.head} data-grip="">
        <CopyButton
          tag="Path"
          label="Copy path"
          hint={`${note.path}\nClick to copy`}
          get={() => Promise.resolve(note.path)}
        />
        <CopyButton tag="Content" label="Copy content" get={content} />
        <button
          type="button"
          className={styles.back}
          aria-label="Put back in Yeraz"
          title="Put back in Yeraz"
          onClick={() => putBack()}
        >
          <Mark size={20} />
        </button>
      </div>
      <div className={styles.scroll}>
        <LeafEditor
          key={`${note.repo} ${note.file}`}
          repo={note.repo}
          path={note.file}
          source={false}
          // A mention opens in Yeraz, where the map is; the note keeps floating.
          onOpen={(id) => {
            window.location.hash = treeHref(note.repo, id)
            window.focus()
          }}
        />
      </div>
    </section>
  )
}

/** Without a window of its own: a card over the app, dragged by its head, kept on screen. */
function Card({ children }: { children: React.ReactNode }) {
  const [at, setAt] = useState(() => ({
    x: Math.max(16, window.innerWidth - 420),
    y: Math.max(16, window.innerHeight - 580),
  }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const grip = (e.target as HTMLElement).closest('[data-grip]')
    if (!grip || (e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const box = e.currentTarget.getBoundingClientRect()
    setAt({
      x: clamp(e.clientX - drag.current.dx, 0, window.innerWidth - box.width),
      y: clamp(e.clientY - drag.current.dy, 0, window.innerHeight - 48),
    })
  }
  return (
    <div
      className={styles.card}
      style={{ left: at.x, top: at.y }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {children}
    </div>
  )
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max))

/**
 * Dresses the floating window as the app: its styles (and those loaded later, as chunks
 * arrive), its theme, followed as it changes. Returns the clean-up.
 */
function mirror(win: Window): () => void {
  const doc = win.document
  doc.title = 'Yeraz'
  const copy = (node: Node) => {
    if (
      node instanceof HTMLStyleElement ||
      (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
    )
      doc.head.append(node.cloneNode(true))
  }
  document.head.childNodes.forEach(copy)
  const theme = () => {
    const from = document.documentElement
    const to = doc.documentElement
    for (const { name } of [...to.attributes])
      if (name.startsWith('data-')) to.removeAttribute(name)
    for (const { name, value } of [...from.attributes])
      if (name.startsWith('data-') || name === 'style') to.setAttribute(name, value)
  }
  theme()
  const styles = new MutationObserver((records) =>
    records.forEach((r) => r.addedNodes.forEach(copy)),
  )
  styles.observe(document.head, { childList: true })
  const looks = new MutationObserver(theme)
  looks.observe(document.documentElement, { attributes: true })
  const gone = () => closed(win)
  win.addEventListener('pagehide', gone)
  return () => {
    styles.disconnect()
    looks.disconnect()
    win.removeEventListener('pagehide', gone)
  }
}
