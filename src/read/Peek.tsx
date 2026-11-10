// The Peek: the selected node, floating over the map (420 px), or its full page when
// expanded (760 px column). On phones it is a bottom sheet. A leaf is editable in all three.

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type RefObject,
  type UIEvent,
} from 'react'
import type { TreeRef } from '../github/graphql'
import {
  ancestors,
  compactWords,
  crumbs,
  ghostsFrom,
  textFile,
  threadEnd,
  type Ghost,
  type Graph,
  type GraphNode,
} from '../model/graph'
import { ROOT } from '../model/tree'
import { mark } from '../perf'
import { session, useSession } from '../store/session'
import { LeafEditor } from '../editor/LeafEditor'
import { FAMILY_TEXT, treesOf } from '../map/family'
import { ownPath } from '../model/parse'
import controls from '../ui/controls.module.css'
import { showAgain } from '../ui/Explorer'
import { Glyph } from '../ui/Glyph'
import { Icon } from '../ui/icons'
import { isMac } from '../ui/platform'
import { InlineName } from '../ui/InlineName'
import { play } from '../ui/motion'
import { ResizeHandle } from '../ui/ResizeHandle'
import type { Panel } from '../ui/panels'
import { noteWidth, saveWidth, widthVar } from '../ui/panels'
import { PHONE, useMedia } from '../ui/useMedia'
import { SyncStatus } from '../ui/SyncStatus'
import { focusFirst, menuKeys } from '../ui/menuKeys'
import { templateHref, treeHref } from '../ui/paths'
import styles from './Peek.module.css'
import { coverAspect, coverPosition } from './cover'
import { downloadAsset } from './files'
import { History } from './History'
import { printLeaf } from './print'
import { playYouTube } from './youtube'
import { renderLeaf } from './render'
import { planGhostLeaf, planTemplate } from '../sync/structure'
import { newNoteAction } from '../sync/structure'
import { fillBookmark } from './linkMeta'
import type { StructureAction } from '../ui/StructureDialogs'

export interface PeekProps {
  tree: TreeRef
  graph: Graph
  id: string
  expanded: boolean
  /** Docked as the last column of a view (Columns) instead of floating over it. */
  docked?: boolean
  /** The leaf was just created: its editor takes the focus, to write below the title. */
  created?: boolean
  /** Kept open beside the selection (owner's request: several leaves edited at once). */
  pinned?: boolean
  /** A kept note's place in the stack: its column's width is its own (`pin0`, `pin1`…). */
  slot?: number
  /** Keeps this node open beside whatever is selected next; the head shows the button. */
  onPin?(id: string): void
  /** This node is pinned: the pin shows pressed, and a click unpins it. */
  kept?: boolean
  /** Moves the pinned notes to the other side of the new one; the head shows the button. */
  onSwap?(): void
  href(id: string): string
  onSelect(id: string): void
  onExpand(expanded: boolean): void
  onClose(): void
  /** A structure action: new leaf or branch, move, delete. */
  onAction(action: StructureAction): void
  /** A ghost was written: the new leaf, ready to write in. */
  onWritten(id: string): void
}

export function Peek({
  tree,
  graph,
  id,
  expanded,
  docked,
  created,
  pinned,
  slot,
  onPin,
  kept,
  onSwap,
  href,
  onSelect,
  onExpand,
  onClose,
  onAction,
  onWritten,
}: PeekProps) {
  const [menu, setMenu] = useState(false)
  const menuHost = useRef<HTMLDivElement>(null)
  const menuList = useRef<HTMLDivElement>(null)
  // The ⋯ menu: its first item takes the focus; a click elsewhere or Escape closes it.
  useEffect(() => {
    if (!menu) return
    focusFirst(menuList.current)
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !menuHost.current?.contains(e.target as Node)
      )
        setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])
  const [source, setSource] = useState(false)
  /** The leaf whose history is shown in place of its editor. */
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  useLayoutEffect(() => mark('peek-painted'), [id])
  // A note's width is its own: its column takes it wherever the note shows (owner's request).
  const column: Panel = docked ? 'dock' : slot === undefined ? 'peek' : `pin${slot}`
  useLayoutEffect(() => {
    if (!docked) saveWidth(column, noteWidth(id))
  }, [id, column, docked])

  const sheet = useRef<HTMLElement>(null)
  const motion = usePeekMotion(sheet, id, expanded, onExpand)
  const phone = useMedia(PHONE)
  const ghost = graph.ghosts.get(id)
  if (ghost) {
    return (
      <GhostPeek
        {...{ tree, graph, ghost, expanded, href, onSelect, onExpand, onClose }}
        onWritten={onWritten}
      />
    )
  }
  const node = graph.nodes.get(id)!
  // The repository is the Family; a folder at its top is one of its Trees.
  const kind =
    node.kind === 'root'
      ? 'Family'
      : node.kind === 'leaf'
        ? 'Note'
        : node.parent === ROOT
          ? 'Project'
          : 'Group'
  const out = [...(graph.out.get(id) ?? []), ...ghostsFrom(graph, id)]
  const into = graph.in.get(id) ?? []
  // The Family lists its Trees; its README.md is its text, shown above them.
  const readme = node.kind === 'root' ? graph.nodes.get(FAMILY_TEXT) : undefined
  const children = node.kind === 'root' ? treesOf(graph) : node.children
  // What is hidden in it stays listed, marked, with a button to show it again (owner's request).
  const hiddenKids = graph.hidden.filter((h) => h.parent === id)
  // Where it is: the Family's home, or the places above it, each one a link (issue #79).
  const crumb =
    node.kind === 'root'
      ? tree.folder !== undefined
        ? `This device · ${tree.folder}`
        : `github.com/${tree.repo}`
      : ancestors(graph, id)
  const away =
    node.kind === 'root' && tree.folder === undefined ? `https://github.com/${tree.repo}` : null
  const chips =
    node.kind === 'root'
      ? [
          count(treesOf(graph).length, 'tree'),
          count(graph.stats.leaves, 'leaf', 'leaves'),
          count(graph.stats.branches, 'branch', 'branches'),
          count(graph.stats.threads, 'thread'),
          `${compactWords(graph.stats.words)} words`,
        ]
      : node.kind === 'branch'
        ? [count(node.children.length, 'item'), `${compactWords(node.total)} words inside`]
        : [
            `${node.words.toLocaleString('en-US')} words`,
            ...(node.children.length
              ? [count(node.children.length, 'sub-leaf', 'sub-leaves')]
              : []),
            count(out.length + into.length, 'thread'),
          ]

  const { named, where } = threadNames(graph)
  const chipRow = (
    <div className={styles.chips}>
      {chips.map((c) => (
        <span key={c} className={`${controls.mono} ${styles.meta}`}>
          {c}
        </span>
      ))}
    </div>
  )

  return (
    <section
      ref={sheet}
      className={styles.peek}
      data-expanded={expanded || undefined}
      data-docked={docked || undefined}
      data-stacked={pinned || undefined}
      style={
        slot === undefined
          ? undefined
          : ({ '--col-w': `var(${widthVar(`pin${slot}`)}, 420px)` } as CSSProperties)
      }
      aria-label={`${kind} preview`}
    >
      {!expanded && (
        <ResizeHandle
          panel={column}
          note={docked ? undefined : id}
          edge="left"
          label="Note panel width"
        />
      )}
      <PeekHead
        {...{ kind, crumb, away, href, onSelect, expanded, onClose, sheet, kept, onSwap }}
        copy={node.kind === 'root' ? undefined : `/${id}${node.kind === 'branch' ? '/' : ''}`}
        markdown={
          node.kind === 'root'
            ? undefined
            : async () => {
                const file = textFile(graph, id)!
                const { files, textOf } = session.getState()
                return files(tree.repo).includes(file) ? textOf(tree.repo, file) : ''
              }
        }
        onPin={onPin && node.kind !== 'root' && !expanded && !docked ? () => onPin(id) : undefined}
        onExpand={motion.expand}
      />
      {/* The full page covers the top bar on a phone: what the writer needs from it, here. */}
      {expanded && phone && <SheetStatus repo={tree.repo} branch={tree.branch} />}

      <div className={styles.scroll} onScroll={motion.onScroll} onFocus={motion.onFocus}>
        <div className={styles.column}>
          <article className={styles.article}>
            {node.kind === 'leaf' && historyOf === id ? (
              <History
                repo={tree.repo}
                path={id}
                onClose={() => setHistoryOf(null)}
                view={(text, sha) => (
                  <ReadText
                    repo={tree.repo}
                    graph={graph}
                    id={id}
                    sha={sha}
                    text={text}
                    href={href}
                  />
                )}
              />
            ) : node.kind === 'leaf' ? (
              <LeafEditor
                key={`${tree.repo} ${id}`}
                repo={tree.repo}
                path={id}
                source={source}
                autoFocus={created}
                onOpen={onSelect}
              />
            ) : node.kind === 'branch' ? null : (
              <div className={styles.titleRow}>
                <Glyph node={node} />
                <h2 className={styles.title}>
                  {node.kind === 'root' ? (
                    <InlineName
                      value={node.title}
                      label="Family name"
                      onRename={(name) => session.getState().renameTree(tree.repo, name)}
                    />
                  ) : (
                    node.title
                  )}
                </h2>
              </div>
            )}
            {node.kind === 'root' && chipRow}

            {/* A branch's text (its folder's README.md): always in the leaf editor, ready to
                write, even before the file exists; the first save creates it. */}
            {node.kind === 'branch' && (
              <LeafEditor
                key={`${tree.repo} ${id}`}
                repo={tree.repo}
                path={textFile(graph, id)!}
                source={source}
                onOpen={onSelect}
              />
            )}

            {/* The Family's own text: the repository's README.md, as it reads. */}
            {node.kind === 'root' && readme?.sha && (
              <ReadText
                repo={tree.repo}
                graph={graph}
                id={FAMILY_TEXT}
                sha={readme.sha}
                href={href}
              />
            )}

            {(children.length + hiddenKids.length > 0 || node.kind === 'branch') && (
              <div className={styles.group}>
                <h3 className={controls.eyebrow}>
                  {node.kind === 'root'
                    ? 'Trees'
                    : node.kind === 'leaf'
                      ? 'Sub-leaves'
                      : `Inside this ${kind.toLowerCase()}`}
                </h3>
                <div className={styles.kids}>
                  {children.map((child) => (
                    <a
                      key={child}
                      href={href(child)}
                      className={styles.kid}
                      onClick={openHere(onSelect, child)}
                    >
                      <Glyph node={graph.nodes.get(child)!} />
                      {named(child)}
                    </a>
                  ))}
                  {hiddenKids.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className={styles.kid}
                      data-hidden=""
                      title="Hidden from the map: click to show it again"
                      aria-label={`Show ${h.title} on the map again (hidden)`}
                      onClick={() => void showAgain(tree.repo, h.id)}
                    >
                      <Icon name="eyeOff" size={14} />
                      {h.icon ? `${h.icon} ` : ''}
                      {h.title}
                    </button>
                  ))}
                  {/* A group makes its own groups and notes here, each named in its dialog. */}
                  {node.kind === 'branch' && (
                    <>
                      <button
                        type="button"
                        className={styles.kid}
                        data-new=""
                        onClick={() => onAction({ kind: 'new-branch', parent: id })}
                      >
                        <Icon name="plus" size={14} />
                        New group
                      </button>
                      <button
                        type="button"
                        className={styles.kid}
                        data-new=""
                        onClick={() => onAction({ kind: 'new-leaf', parent: id })}
                      >
                        <Icon name="plus" size={14} />
                        New note
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {out.length > 0 && (
              <ThreadList
                title="Threads out · mentioned here"
                ids={out}
                prefix="@ "
                named={named}
                where={where}
                href={href}
                onSelect={onSelect}
              />
            )}
            {into.length > 0 && (
              <ThreadList
                title="Threads in · mentioned by"
                ids={into}
                incoming
                named={named}
                where={where}
                href={href}
                onSelect={onSelect}
              />
            )}
          </article>
        </div>
      </div>

      <div className={styles.foot}>
        {!expanded && node.kind === 'leaf' && (
          <button
            type="button"
            className={`${controls.ghost} ${styles.openLeaf}`}
            onClick={() => motion.expand(true)}
          >
            Open note
            <Icon name="arrowRight" />
          </button>
        )}
        {/* A note's words and threads sit in its foot (owner's request). */}
        {(node.kind === 'leaf' || node.kind === 'branch') && chipRow}
        <div className={styles.actions}>
          {(node.kind === 'leaf' || node.kind === 'branch') && (
            <>
              <button
                type="button"
                className={`${controls.ghost} ${styles.square}`}
                aria-label="New note"
                title={`New note (${isMac ? '⌘Y' : 'Ctrl+Y'})`}
                aria-keyshortcuts="Control+Y Meta+Y"
                onClick={() => onAction(newNoteAction(graph, id, false)!)}
              >
                <Icon name="noteRight" size={20} />
              </button>
              <button
                type="button"
                className={`${controls.ghost} ${styles.square}`}
                aria-label="New sub-note"
                title={`New sub-note (${isMac ? '⇧⌘Y' : 'Ctrl+Shift+Y'})`}
                aria-keyshortcuts="Control+Shift+Y Meta+Shift+Y"
                onClick={() => onAction(newNoteAction(graph, id, true)!)}
              >
                <Icon name="noteDown" size={20} />
              </button>
            </>
          )}
          {node.kind !== 'leaf' && node.kind !== 'branch' && (
            <button
              type="button"
              className={`${controls.ghost} ${styles.phoneless}`}
              onClick={() => onAction({ kind: 'new-leaf', parent: id })}
            >
              <Icon name="plus" size={15} />
              New note here
            </button>
          )}
          {node.kind === 'root' && (
            <button
              type="button"
              className={controls.ghost}
              onClick={() => onAction({ kind: 'new-branch', parent: ROOT })}
            >
              <Icon name="plus" size={15} />
              New project
            </button>
          )}
          {node.kind !== 'root' && (
            <div
              ref={menuHost}
              className={styles.menuHost}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setMenu(true)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setMenu(false)}
            >
              <button
                type="button"
                className={`${controls.ghost} ${styles.square}`}
                aria-label="Options"
                title="Options"
                aria-haspopup="menu"
                aria-expanded={menu}
                // A mouse already opened it on hover: its click keeps it open, keys and touch toggle it.
                onClick={(e) => {
                  const mouse = (e.nativeEvent as PointerEvent).pointerType === 'mouse'
                  setMenu((m) => mouse || !m)
                }}
              >
                <Icon name="more" size={20} />
              </button>
              {menu && (
                <div
                  ref={menuList}
                  className={styles.menu}
                  role="menu"
                  onClick={() => setMenu(false)}
                  onKeyDown={menuKeys}
                >
                  {node.kind === 'leaf' && (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={source}
                      onClick={() => setSource((s) => !s)}
                    >
                      Show Markdown
                    </button>
                  )}
                  {node.kind === 'leaf' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        void printable(tree.repo, graph, id, href).then(
                          (leaf) => printLeaf(leaf, node.title),
                          () => undefined,
                        )
                      }
                    >
                      Export PDF
                    </button>
                  )}
                  {node.kind === 'leaf' && tree.folder === undefined && (
                    <button type="button" role="menuitem" onClick={() => setHistoryOf(id)}>
                      History
                    </button>
                  )}
                  {node.kind === 'leaf' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => onAction({ kind: 'new-leaf', parent: id })}
                    >
                      Add sub-note
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onAction({ kind: 'new-leaf', parent: id, many: true })}
                  >
                    {node.kind === 'leaf' ? 'Add sub-notes…' : 'New notes here…'}
                  </button>
                  {node.kind === 'branch' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => onAction({ kind: 'new-branch', parent: id })}
                    >
                      New group here
                    </button>
                  )}
                  {node.kind === 'leaf' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void saveAsTemplate(tree.repo, graph, id)}
                    >
                      Save as template
                    </button>
                  )}
                  {/* A Tree moves under another Tree, as a branch moves (issue #81). */}
                  {(node.kind === 'leaf' || node.kind === 'branch') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => onAction({ kind: 'move', id })}
                    >
                      Move…
                    </button>
                  )}
                  {(node.kind === 'leaf' || node.kind === 'branch') && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => onAction({ kind: 'convert', id })}
                    >
                      {node.kind === 'leaf' ? 'Make it a group…' : 'Make it a note…'}
                    </button>
                  )}
                  {/* Off the map with everything under it; Settings › Hidden shows it again. */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onClose()
                      void session.getState().setHidden(tree.repo, id, true)
                    }}
                  >
                    Hide
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-danger
                    onClick={() => onAction({ kind: 'delete', id })}
                  >
                    Delete…
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Copies what `get` gives (the node's path, or its Markdown), shown as the copy icon and a tag
 * naming which (owner's request: they replace the breadcrumbs).
 */
function CopyButton({
  tag,
  label,
  get,
}: {
  tag: string
  label: string
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
      title={label}
      onClick={() => {
        void get()
          .then((text) => navigator.clipboard?.writeText(text))
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

/** A plain click opens it here; others (a new tab) follow the link. */
const openHere = (onSelect: (id: string) => void, id: string) => (e: MouseEvent) => {
  if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  onSelect(id)
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/**
 * A template from this leaf's text, in `.yeraz/templates/` (issue #41), then Settings ›
 * Templates with it open: its title is the template's name until changed there.
 */
async function saveAsTemplate(repo: string, graph: Graph, id: string) {
  const { getState } = session
  const text = await getState().textOf(repo, id)
  const change = planTemplate(graph, graph.nodes.get(id)!.title, text)
  await getState().apply(repo, [change])
  window.location.hash = `#${templateHref(repo, change.path)}`
}

function PeekHead({
  kind,
  crumb,
  away = null,
  copy,
  markdown,
  onPin,
  kept,
  onSwap,
  href,
  onSelect,
  expanded,
  onExpand,
  onClose,
  sheet,
}: {
  kind: string
  /** The places above, each a link to it; or a line of text, linking `away` when given. */
  crumb: string | GraphNode[]
  away?: string | null
  /** The node's path from the Family's root, for the copy button; none without it. */
  copy?: string | undefined
  /** The node's Markdown, for the copy-content button. */
  markdown?: (() => Promise<string>) | undefined
  /** Keeps the node open beside the next selection; no button without it. */
  onPin?: (() => void) | undefined
  kept?: boolean | undefined
  onSwap?: (() => void) | undefined
  sheet: RefObject<HTMLElement | null>
} & Pick<PeekProps, 'href' | 'onSelect' | 'expanded' | 'onExpand' | 'onClose'>) {
  // On a touch screen the handle and head are a grip: swipe up to open the full page,
  // down to come back to the map, or, from the sheet, to dismiss it. The Peek follows the
  // finger (upwards reluctantly), and settles back when the swipe is too short and too slow:
  // a quick flick counts whatever its length.
  const start = useRef<{ y: number; at: number } | null>(null)
  const follow = (dy: number) => shift(sheet.current, dy)
  const settle = (dy: number) => {
    shift(sheet.current, 0)
    play(sheet.current, [{ transform: dragged(dy) }, {}])
  }
  return (
    <div
      className={styles.grip}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') start.current = { y: e.clientY, at: e.timeStamp }
      }}
      onPointerMove={(e) => {
        if (start.current !== null) follow(e.clientY - start.current.y)
      }}
      onPointerUp={(e) => {
        if (start.current === null) return
        const dy = e.clientY - start.current.y
        // A flick is quick, but a real movement: a twitch of a few pixels, or a tap that
        // lands and lifts within a frame, is neither.
        const elapsed = e.timeStamp - start.current.at
        const flick = elapsed > 30 && Math.abs(dy) > FLICK_MIN && Math.abs(dy) / elapsed > FLICK
        start.current = null
        const far = Math.abs(dy) > SWIPE || flick
        if (dy < 0 && far && !expanded) onExpand(true)
        else if (dy > 0 && far && expanded) {
          follow(0)
          onExpand(false)
        } else if (dy > 0 && far) onClose()
        else settle(dy)
      }}
      onPointerCancel={() => {
        start.current = null
        settle(0)
      }}
    >
      <span className={styles.handle} aria-hidden="true" />
      <div className={styles.head}>
        <span className={styles.kind}>{kind}</span>
        {copy ? (
          // A note's place is copied, not shown (owner's request): its path, and its Markdown.
          <div className={styles.copies}>
            <CopyButton tag="Path" label="Copy path" get={() => Promise.resolve(copy)} />
            {markdown && <CopyButton tag="MD" label="Copy Markdown" get={markdown} />}
          </div>
        ) : (
          <nav className={`${controls.mono} ${styles.crumb}`} aria-label="Breadcrumb">
            {typeof crumb === 'string' ? (
              away ? (
                <a href={away} target="_blank" rel="noopener noreferrer">
                  {crumb}
                </a>
              ) : (
                crumb
              )
            ) : (
              crumb.map((n, i) => (
                <Fragment key={n.id}>
                  {i > 0 && ' / '}
                  <a href={href(n.id)} onClick={openHere(onSelect, n.id)}>
                    {n.title}
                  </a>
                </Fragment>
              ))
            )}
          </nav>
        )}
        {onSwap && (
          <button
            type="button"
            className={controls.iconButton}
            aria-label="Pin on the other side"
            title="Move pinned notes to the other side"
            onClick={onSwap}
          >
            <Icon name="swap" size={16} />
          </button>
        )}
        {onPin && (
          <button
            type="button"
            className={`${controls.iconButton} ${styles.pin}`}
            aria-label="Keep open"
            aria-pressed={!!kept}
            title={kept ? 'Pinned: click to unpin' : 'Keep this open beside the next note you pick'}
            onClick={onPin}
          >
            <Icon name="pin" size={16} />
          </button>
        )}
        <button
          type="button"
          className={controls.iconButton}
          aria-label={expanded ? 'Back to the map' : 'Open full page'}
          onClick={() => onExpand(!expanded)}
        >
          <Icon name={expanded ? 'collapse' : 'expand'} />
        </button>
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Dismiss"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  )
}

/** On a phone the full page covers the top bar: the sync state and Save, in the sheet. */
function SheetStatus({ repo, branch }: { repo: string; branch: string }) {
  const unsaved = useSession((s) => {
    const sync = s.sync[repo.toLowerCase()]
    return !!sync && 'files' in sync && sync.files > 0 && sync.status !== 'saving'
  })
  return (
    <div className={styles.sheetStatus}>
      <SyncStatus repo={repo} branch={branch} plain />
      <button
        type="button"
        className={`${controls.ghost} ${styles.sheetSave}`}
        disabled={!unsaved}
        onClick={() => void session.getState().flush(repo)}
      >
        Save
      </button>
    </div>
  )
}

/** How far (px) a swipe on the Peek's grip travels before it counts. */
const SWIPE = 40
/** How fast (px/ms) a shorter swipe must be to count: a flick. */
const FLICK = 0.11
/** The least (px) a flick travels. */
const FLICK_MIN = 24

/** Where a finger dragging the grip by `dy` puts the Peek: upwards, reluctantly. */
const dragged = (dy: number) => `translateY(${dy > 0 ? dy : dy / 3}px)`
/** Moves the Peek with the finger; a dismissed one goes out from there (ui/motion.tsx). */
function shift(el: HTMLElement | null, dy: number) {
  if (el) el.style.transform = dy ? dragged(dy) : ''
}

/**
 * The Peek's motion (ui/motion.tsx): opening the full page grows it out of the floating
 * Peek or sheet, coming back slides it to its place; another leaf settles in. On a phone,
 * scrolling the sheet's note, or writing in it, opens it to the full page.
 */
function usePeekMotion(
  sheet: RefObject<HTMLElement | null>,
  id: string,
  expanded: boolean,
  onExpand: (expanded: boolean) => void,
) {
  /** Where the Peek was before it was expanded or brought back from here. */
  const before = useRef<DOMRect | null>(null)
  const shown = useRef({ id, expanded })
  useLayoutEffect(() => {
    const was = shown.current
    shown.current = { id, expanded }
    const el = sheet.current
    if (!el) return
    if (was.expanded !== expanded) {
      const from = before.current
      before.current = null
      const to = el.getBoundingClientRect()
      if (!from) play(el, [{ opacity: 0.4 }, {}])
      else if (expanded) {
        const inset = [
          from.top - to.top,
          to.right - from.right,
          to.bottom - from.bottom,
          from.left - to.left,
        ]
        play(
          el,
          [
            { clipPath: `inset(${inset.map((n) => `${Math.max(0, n)}px`).join(' ')} round 14px)` },
            { clipPath: 'inset(0 round 0)' },
          ],
          { duration: 260 },
        )
      } else
        play(
          el,
          [
            {
              transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
              opacity: 0.5,
            },
            {},
          ],
          { duration: 260 },
        )
    } else if (was.id !== id)
      // Selected hundreds of times a day: the barest settle, no movement.
      play(el.querySelector(`.${styles.column}`), [{ opacity: 0.6 }, {}], { duration: 100 })
  }, [sheet, id, expanded])
  useVisibleArea(sheet, expanded)
  const expand = (to: boolean) => {
    before.current = sheet.current?.getBoundingClientRect() ?? null
    onExpand(to)
  }
  const onScroll = (e: UIEvent<HTMLElement>) => {
    if (!expanded && e.currentTarget.scrollTop > GROW && window.matchMedia(PHONE).matches)
      expand(true)
  }
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (!expanded && window.matchMedia(PHONE).matches && e.target.closest('.cm-content'))
      expand(true)
  }
  return { expand, onScroll, onFocus }
}

/**
 * A phone's full page fits the part of the screen that is visible (owner's request): when the
 * keyboard opens, the browser scrolls the page up under it, and a page fixed at the top would
 * take its head, Back to the map and Dismiss, out of reach. `--vv-top` and `--vv-h` follow the
 * visual viewport; the CSS keeps the head below the status bar too.
 */
function useVisibleArea(sheet: RefObject<HTMLElement | null>, expanded: boolean) {
  useEffect(() => {
    const el = sheet.current
    const vv = window.visualViewport
    if (!el || !vv || !expanded || !window.matchMedia(PHONE).matches) return
    const place = () => {
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`)
      el.style.setProperty('--vv-h', `${vv.height}px`)
    }
    place()
    vv.addEventListener('resize', place)
    vv.addEventListener('scroll', place)
    return () => {
      vv.removeEventListener('resize', place)
      vv.removeEventListener('scroll', place)
      el.style.removeProperty('--vv-top')
      el.style.removeProperty('--vv-h')
    }
  }, [sheet, expanded])
}

/** How far (px) a phone's sheet scrolls before it opens to the full page. */
const GROW = 24

/** How a thread list names its ends, and where they are; a ghost is not written yet. */
const threadNames = (graph: Graph) => ({
  named(target: string) {
    const n = graph.nodes.get(target) ?? graph.ghosts.get(target)!
    return 'icon' in n && n.icon ? `${n.icon} ${n.title}` : n.title
  },
  where: (target: string) =>
    graph.ghosts.has(target)
      ? 'Not written yet'
      : [graph.nodes.get(ROOT)!.title, ...crumbs(graph, target)].join(' / '),
})

/**
 * A leaf linked to but not written yet: who links to it, and a button that writes it at
 * the path the links name, so they lead somewhere.
 */
function GhostPeek({
  tree,
  graph,
  ghost,
  expanded,
  href,
  onSelect,
  onExpand,
  onClose,
  onWritten,
}: { ghost: Ghost } & Pick<
  PeekProps,
  'tree' | 'graph' | 'expanded' | 'href' | 'onSelect' | 'onExpand' | 'onClose' | 'onWritten'
>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const motion = usePeekMotion(sheet, ghost.id, expanded, onExpand)
  const { named, where } = threadNames(graph)
  const write = async () => {
    setBusy(true)
    setError(null)
    const { getState } = session
    try {
      // The new leaf takes its title from the first link to it.
      const linking = await getState()
        .textOf(tree.repo, textFile(graph, ghost.from[0]!)!)
        .catch(() => null)
      await getState().apply(tree.repo, [planGhostLeaf(ghost, linking)])
      onWritten(ghost.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <section
      ref={sheet}
      className={styles.peek}
      data-expanded={expanded || undefined}
      aria-label="Note not written yet"
    >
      <PeekHead
        kind="Not written yet"
        crumb={ancestors(graph, ghost.id)}
        {...{ href, onSelect, expanded, onClose, sheet }}
        onExpand={motion.expand}
      />
      <div className={styles.scroll} onScroll={motion.onScroll} onFocus={motion.onFocus}>
        <div className={styles.column}>
          <article className={styles.article}>
            <div className={styles.titleRow}>
              <span className={controls.glyph} data-kind="ghost" aria-hidden="true" />
              <h2 className={styles.title}>{ghost.title}</h2>
            </div>
            <p className={styles.ghostText}>
              {ghost.from.length === 1 ? 'A note links' : `${ghost.from.length} notes link`} here,
              but this note isn’t written yet. Writing it creates the file the links name.
            </p>
            {error && (
              <p className={controls.error} role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className={`${controls.primary} ${styles.ghostWrite}`}
              disabled={busy}
              onClick={() => void write()}
            >
              <Icon name="plus" size={15} />
              Write this note
            </button>
            <ThreadList
              title="Threads in · mentioned by"
              ids={ghost.from}
              incoming
              named={named}
              where={where}
              href={href}
              onSelect={onSelect}
            />
          </article>
        </div>
      </div>
    </section>
  )
}

function ThreadList({
  title,
  ids,
  prefix = '',
  incoming = false,
  named,
  where,
  href,
  onSelect,
}: {
  title: string
  ids: string[]
  prefix?: string
  incoming?: boolean
  named(id: string): string
  where(id: string): string
  href(id: string): string
  onSelect(id: string): void
}) {
  return (
    <div className={styles.group}>
      <h3 className={controls.eyebrow}>{title}</h3>
      <div className={styles.threads}>
        {ids.map((id) => (
          <a key={id} href={href(id)} className={styles.thread} onClick={openHere(onSelect, id)}>
            <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
              <path
                d={incoming ? 'M17 9C12 9 11 1 1 1' : 'M1 9C6 9 7 1 17 1'}
                data-incoming={incoming || undefined}
              />
            </svg>
            <span className={styles.threadTitle}>
              {prefix}
              {named(id)}
            </span>
            <span className={`${controls.mono} ${styles.threadWhere}`}>{where(id)}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

/** Links in a rendered text: to a leaf, or to a branch's README.md, which opens the branch. */
const linkTo = (graph: Graph, href: (id: string) => string) => (path: string) => {
  const end = threadEnd(graph, path)
  return end === null ? null : href(end)
}

/** The Family's text (README.md) as the read view draws it, or a past version of a leaf. */
function ReadText({
  repo,
  graph,
  id,
  sha,
  text: given,
  href,
}: {
  repo: string
  graph: Graph
  id: string
  sha: string
  text?: string
  href(id: string): string
}) {
  const [html, setHtml] = useState<{ sha: string; html: string } | null>(null)
  useEffect(() => {
    let live = true
    const { getState } = session
    void Promise.resolve(given ?? getState().textOf(repo, id))
      .then((text) =>
        renderLeaf(text, {
          leafHref: linkTo(graph, href),
          leafIcon: (path) => graph.nodes.get(path)?.icon ?? null,
          files: () => getState().files(repo),
          size: (path) => getState().fileSize(repo, path),
          tree: (other) => {
            const t = getState().trees.find((t) => t.repo.toLowerCase() === other.toLowerCase())
            return t ? { title: t.title, href: `#${treeHref(t.repo)}` } : null
          },
        }),
      )
      .then((rendered) => live && setHtml({ sha, html: rendered }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [repo, id, sha, given, graph, href])

  // The Tree's own files (images, PDFs, videos) come from the blob cache, with the token.
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    for (const el of body.current?.querySelectorAll<HTMLElement>(
      '[data-asset], [data-asset-href]',
    ) ?? []) {
      const href = el.dataset.assetHref
      void session
        .getState()
        .assetUrl(repo, href ?? el.dataset.asset!)
        .then((url) => url && el.setAttribute(href ? 'href' : 'src', url))
    }
    for (const a of body.current?.querySelectorAll<HTMLAnchorElement>('a.bookmark') ?? [])
      fillBookmark(a, a.href)
    // Attachments are downloaded only when their card is used.
    for (const el of body.current?.querySelectorAll<HTMLElement>('[data-asset-file]') ?? [])
      el.onclick = () =>
        void downloadAsset(el.dataset.assetFile!, (p) => session.getState().assetUrl(repo, p))
  }, [html, repo])

  if (html?.sha !== sha) return <div className={styles.loading} aria-busy="true" />
  return (
    <div
      ref={body}
      className={`reading ${styles.content}`}
      dangerouslySetInnerHTML={{ __html: html.html }}
      onClick={(event) => {
        footnoteJump(event)
        playYouTube(event)
      }}
    />
  )
}

/** A footnote's link scrolls to its note (and back) instead of changing the app's route. */
function footnoteJump(event: MouseEvent<HTMLElement>) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#fn"]')
  if (!link) return
  event.preventDefault()
  const id = CSS.escape(link.getAttribute('href')!.slice(1))
  event.currentTarget.querySelector(`#${id}`)?.scrollIntoView({ block: 'center' })
}

/**
 * The leaf as the read view draws it (ARCHITECTURE.md §8), for printing: cover, title and
 * the rendered text, with the Tree's own images loaded.
 */
async function printable(
  repo: string,
  graph: Graph,
  id: string,
  href: (id: string) => string,
): Promise<HTMLElement> {
  const { getState } = session
  const node = graph.nodes.get(id)!
  const html = await renderLeaf(await getState().textOf(repo, id), {
    leafHref: linkTo(graph, href),
    leafIcon: (path) => graph.nodes.get(path)?.icon ?? null,
    files: () => getState().files(repo),
    size: (path) => getState().fileSize(repo, path),
    tree: (other) => {
      const t = getState().trees.find((t) => t.repo.toLowerCase() === other.toLowerCase())
      return t ? { title: t.title, href: `#${treeHref(t.repo)}` } : null
    },
  })
  const article = document.createElement('article')
  article.className = styles.article ?? ''
  article.dataset.leaf = ''
  const title = document.createElement('h2')
  title.className = styles.title ?? ''
  title.textContent = `${node.icon ? `${node.icon} ` : ''}${node.title}`
  const body = document.createElement('div')
  body.className = `reading ${styles.content}`
  body.innerHTML = html
  article.append(title, body)

  const cover = typeof node.meta?.cover === 'string' ? node.meta.cover : null
  if (cover) {
    const img = document.createElement('img')
    img.className = styles.cover ?? ''
    const own = ownPath(cover)
    if (own !== null) img.dataset.asset = own
    else if (/^https:\/\//.test(cover)) img.src = cover
    img.style.objectPosition = `50% ${coverPosition(node.meta)}%`
    img.style.aspectRatio = coverAspect(node.meta) ?? ''
    article.prepend(img)
  }
  await Promise.all(
    [...article.querySelectorAll<HTMLElement>('[data-asset], [data-asset-href]')].map(
      async (el) => {
        const link = el.dataset.assetHref
        const url = await getState().assetUrl(repo, link ?? el.dataset.asset!)
        if (url) el.setAttribute(link ? 'href' : 'src', url)
      },
    ),
  )
  await Promise.all(
    [...article.querySelectorAll('img')].map((img) => {
      img.loading = 'eager'
      return img.decode().catch(() => undefined)
    }),
  )
  return article
}
