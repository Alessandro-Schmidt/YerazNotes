import { useRef, useState } from 'react'
import type { LeafMeta } from '../model/parse'
import {
  coverAspect,
  coverPosition,
  dragCover,
  dragSideways,
  iconFocus,
  iconShape,
} from '../read/cover'
import { Cover } from '../read/LeafLook'
import controls from '../ui/controls.module.css'
import styles from './LeafEditor.module.css'

const STEP: Record<string, number> = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }

/**
 * The editor's cover. While `moving`, drag it (or use the arrow keys) to choose which part
 * shows; "Save position" writes it to line 2 as `coverPosition`.
 */
export function EditableCover({
  repo,
  meta,
  moving,
  onSave,
  onCancel,
}: {
  repo: string
  meta: LeafMeta | null
  moving: boolean
  onSave(position: number): void
  onCancel(): void
}) {
  const [y, setY] = useState(() => coverPosition(meta))
  const drag = useRef<{ from: number; y: number } | null>(null)
  if (!moving)
    return (
      <Cover
        repo={repo}
        src={meta?.cover}
        position={coverPosition(meta)}
        aspect={coverAspect(meta)}
        className={styles.cover}
      />
    )
  return (
    <div className={styles.coverBox}>
      <Cover
        repo={repo}
        src={meta?.cover}
        position={y}
        aspect={coverAspect(meta)}
        className={styles.cover}
        data-moving=""
        draggable={false}
        role="slider"
        tabIndex={0}
        aria-label="Cover position"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={y}
        aria-valuetext={`${y}% from the top`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { from: e.clientY, y }
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerMove={(e) => {
          const start = drag.current
          if (!start) return
          const img = e.currentTarget
          setY(
            dragCover(
              start.y,
              e.clientY - start.from,
              { width: img.clientWidth, height: img.clientHeight },
              { width: img.naturalWidth, height: img.naturalHeight },
            ),
          )
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const by = STEP[e.key]
          if (by !== undefined) setY((v) => Math.min(100, Math.max(0, v + by)))
          else if (e.key === 'Home') setY(0)
          else if (e.key === 'End') setY(100)
          else if (e.key === 'Escape') onCancel()
          else return
          e.preventDefault()
        }}
      />
      <div className={`${controls.panel} ${styles.coverBar}`}>
        <span>Drag the image to reposition</span>
        <button type="button" className={controls.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={controls.primary} onClick={() => onSave(y)}>
          Save position
        </button>
      </div>
    </div>
  )
}

/**
 * The image icon, being moved: drag it (or use the arrow keys) to choose which part shows in
 * its frame; "Save position" writes it to line 2 as `iconFocus`, [x, y] in %.
 */
export function IconMover({
  repo,
  src,
  meta,
  onSave,
  onCancel,
}: {
  repo: string
  src: string
  meta: LeafMeta | null
  onSave(focus: [number, number]): void
  onCancel(): void
}) {
  const [at, setAt] = useState(() => iconFocus(meta))
  const drag = useRef<{ x: number; y: number; at: [number, number] } | null>(null)
  const shape = iconShape(meta)
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  const KEYS: Record<string, [number, number]> = {
    ArrowLeft: [5, 0],
    ArrowRight: [-5, 0],
    ArrowUp: [0, 5],
    ArrowDown: [0, -5],
  }
  return (
    <div className={styles.iconMover}>
      <Cover
        repo={repo}
        src={src}
        x={at[0]}
        position={at[1]}
        aspect={shape.aspect}
        radius={shape.radius}
        className={styles.iconImage}
        data-moving=""
        draggable={false}
        role="application"
        tabIndex={0}
        aria-label={`Icon position: ${at[0]}% from the left, ${at[1]}% from the top`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, at }
        }}
        onPointerCancel={() => (drag.current = null)}
        onPointerMove={(e) => {
          const start = drag.current
          if (!start) return
          const img = e.currentTarget
          const box = { width: img.clientWidth, height: img.clientHeight }
          const image = { width: img.naturalWidth, height: img.naturalHeight }
          setAt([
            dragSideways(start.at[0], e.clientX - start.x, box, image),
            dragCover(start.at[1], e.clientY - start.y, box, image),
          ])
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const by = KEYS[e.key]
          if (by) setAt(([x, y]) => [clamp(x + by[0]), clamp(y + by[1])])
          else if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter') onSave(at)
          else return
          e.preventDefault()
        }}
      />
      <div className={`${controls.panel} ${styles.iconBar}`}>
        <button type="button" className={controls.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={controls.primary} onClick={() => onSave(at)}>
          Save position
        </button>
      </div>
    </div>
  )
}
