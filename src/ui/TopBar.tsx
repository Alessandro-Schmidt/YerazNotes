import type { ReactNode } from 'react'
import { Mark } from './Mark'
import styles from './TopBar.module.css'

/**
 * The 56 px bar: the leaf and "Yeraz", then whatever the screen puts after it. The leaf
 * opens the introduction (`#/welcome`); `home` shows it instead, where the address must stay.
 */
export function TopBar({ children, home }: { children?: ReactNode; home?: () => void }) {
  return (
    <header className={styles.top}>
      <a
        className={styles.skip}
        href="#main"
        onClick={(e) => {
          // Not a route: the hash is the router's (App.tsx).
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <a
        className={styles.brand}
        href="#/welcome"
        aria-label="Yeraz"
        onClick={
          home &&
          ((e) => {
            e.preventDefault()
            home()
          })
        }
      >
        <Mark className={styles.mark} />
        <span className={styles.word}>Yeraz</span>
      </a>
      {children}
    </header>
  )
}

export function Divider() {
  return <span className={styles.divider} aria-hidden="true" />
}
