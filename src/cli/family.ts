// A Family opened by the command line (`yeraz`): its graph, its files' texts, and a way to
// save changes. Kept in a folder (sync/folder.ts) or on GitHub (sync/pull.ts, push.ts), the
// same paths the app takes, so the CLI writes what the app would.

import type { GitHubClient } from '../github/client'
import { lookupTree, markerFields, type TreeRef } from '../github/graphql'
import type { FolderFile, FolderFs } from '../local/folder'
import { buildGraph, type Graph } from '../model/graph'
import type { TreeModel } from '../model/tree'
import { memoryStore, type KeyValueStore } from '../store/db'
import { pullFolder, pushFolder } from '../sync/folder'
import { pullTree, type PulledTree } from '../sync/pull'
import { pushTree, type Dirty, type Pushed } from '../sync/push'
import type { FileChange } from '../sync/structure'

export interface Family {
  ref: TreeRef
  graph: Graph
  model: TreeModel
  /** Every file of the Family (paths as the Family sees them). */
  files: Set<string>
  /** A Markdown file's text: a leaf, a branch's README.md or a template. */
  text(path: string): Promise<string>
  save(changes: FileChange[]): Promise<Pushed>
}

const MARKER = '.yeraz.json'

async function opened(
  ref: TreeRef,
  pulled: PulledTree,
  store: KeyValueStore,
  push: (dirty: Dirty) => Promise<Pushed>,
): Promise<Family> {
  const shas = new Map(pulled.entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
  return {
    ref,
    model: pulled.model,
    graph: buildGraph(pulled.model, pulled.leaves, ref.title),
    files: new Set(shas.keys()),
    async text(path) {
      const sha = shas.get(path)
      const text = sha && (await store.get<string>(`blob:${sha}`))
      if (typeof text !== 'string') throw new Error(`No text at ${path}`)
      return text
    },
    save: (changes) =>
      push(
        Object.fromEntries(
          changes.map((c) => [c.path, { text: c.text, base: shas.get(c.path) ?? null }]),
        ),
      ),
  }
}

/** A folder's files below `root` (`.yeraz.json` `root`), paths relative to it; the marker stays. */
export function scoped(fs: FolderFs, root: string | undefined): FolderFs {
  if (!root) return fs
  const at = (path: string) => (path === MARKER ? path : `${root}/${path}`)
  return {
    list: async () =>
      (await fs.list()).flatMap((f): FolderFile[] =>
        f.path === MARKER
          ? [f]
          : f.path.startsWith(`${root}/`)
            ? [{ ...f, path: f.path.slice(root.length + 1) }]
            : [],
      ),
    read: (path) => fs.read(at(path)),
    write: (path, bytes) => fs.write(at(path), bytes),
    remove: (path) => fs.remove(at(path)),
  }
}

/** A Family kept in a folder: the one holding `.yeraz.json`. */
export async function openFolder(fs: FolderFs, name: string): Promise<Family> {
  const bytes = await fs.read(MARKER).catch(() => {
    throw new Error(`No ${MARKER} here: not a Family (yeraz init makes one)`)
  })
  const marker = markerFields(new TextDecoder().decode(bytes))
  const ref: TreeRef = {
    owner: '~',
    name,
    repo: `~/${name}`,
    branch: '',
    isPrivate: true,
    title: marker.title ?? name,
    color: marker.color ?? null,
    folder: name,
    ...(marker.root && { root: marker.root }),
  }
  const inner = scoped(fs, marker.root)
  const store = memoryStore()
  const pulled = await pullFolder(ref, { fs: inner, store })
  return opened(ref, pulled, store, (dirty) => pushFolder(ref, dirty, { fs: inner, store }))
}

/** A Family on GitHub, `owner/name`. */
export async function openRepo(client: GitHubClient, repo: string): Promise<Family> {
  const ref = await lookupTree(client, repo)
  if (!ref) throw new Error(`${repo} has no ${MARKER}: not a Family`)
  const store = memoryStore()
  const pulled = await pullTree(ref, { client, store })
  return opened(ref, pulled, store, (dirty) => pushTree(ref, dirty, { client, store }))
}
