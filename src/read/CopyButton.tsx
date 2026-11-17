// Copies a node's path or its Markdown: the copy icon and a word naming which (owner's
// request: they replace the breadcrumbs). In the Peek's head and on a floating note.

import { useEffect, useState } from 'react'
import controls from '../ui/controls.module.css'
import { Icon } from '../ui/icons'
import styles from './CopyButton.module.css'

/**
 * Copies what `get` gives (the node's path, or its Markdown), shown as the copy icon and a tag
 * naming which (owner's request: they replace the breadcrumbs).
 */
export function CopyButton({
  tag,
  label,
  hint = label,
  get,
}: {
  tag: string
  label: string
  /** What hovering shows: the path itself, for the path's button (owner's request). */
  hint?: string
  get: () => Promise<string>
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className={`${controls.ghost} ${styles.copy}`}
      aria-label={copied ? 'Copied' : label}
      title={hint}
      onClick={(e) => {
        // The clipboard of the window the button is in: a floating note's own window has the
        // focus, and a browser only lets the focused document write to the clipboard.
        const clipboard = (e.currentTarget.ownerDocument.defaultView ?? window).navigator.clipboard
        void get()
          .then((text) => clipboard?.writeText(text))
          .then(
            () => setCopied(true),
            () => undefined,
          )
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      <span className={styles.copyTag}>{tag}</span>
    </button>
  )
}
