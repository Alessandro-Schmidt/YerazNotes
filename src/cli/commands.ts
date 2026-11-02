// The commands of `yeraz` (scripts/yeraz.ts), on an opened Family (family.ts). Each gives
// what it found as data, for `--json`, and as text for a person. Edits are planned by
// sync/structure.ts, as the app plans them, and saved in one commit, or shown with `--dry-run`.

import { AGENTS_FILE, AGENTS_TEXT } from '../example/files'
import { ancestors, textFile, type Graph, type GraphNode } from '../model/graph'
import { LINK, META, ownPath, parseMeta, prose, stripBom, HEADING } from '../model/parse'
import { search, snippet, type Searchable } from '../model/search'
import { ROOT } from '../model/tree'
import {
  moveReads,
  planBranchText,
  planDelete,
  planMove,
  planNewBranch,
  planNewLeaf,
  StructureError,
  type FileChange,
} from '../sync/structure'
import type { Family } from './family'

export interface Result {
  data: unknown
  text: string
  /** The process's exit code: 1 when `check` finds errors. */
  code?: number
}

export class UsageError extends Error {}

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()

/**
 * A node from what was typed: its path (`identity/keycloak.md`, `identity/keycloak`, a
 * branch's folder, `/` for the root) or its title, when only one node has it.
 */
export function resolve(graph: Graph, typed: string): string {
  const path = typed
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (path === '' || path === '.') return ROOT
  for (const id of [path, `${path}.md`]) if (graph.nodes.has(id)) return id
  const wanted = fold(typed)
  const named = [...graph.nodes.values()].filter(
    (n) => n.kind !== 'root' && fold(n.title) === wanted,
  )
  if (named.length === 1) return named[0]!.id
  if (named.length > 1)
    throw new UsageError(
      `"${typed}" names ${named.length} nodes; give a path: ${named.map((n) => n.id).join(', ')}`,
    )
  const hidden = graph.whole?.model.nodes.has(path) || graph.whole?.model.nodes.has(`${path}.md`)
  throw new UsageError(hidden ? `${typed} is hidden (line 2 "hidden")` : `Nothing at "${typed}"`)
}

const label = (n: GraphNode) => (n.icon ? `${n.icon} ${n.title}` : n.title)
const where = (graph: Graph, id: string) =>
  [...ancestors(graph, id).slice(1), graph.nodes.get(id)!].map((n) => n.title).join(' / ')

/** The Family as an indented outline, to `depth` levels below `from`. */
export function tree(fam: Family, from = '', depth = Infinity): Result {
  const { graph } = fam
  const start = resolve(graph, from)
  const lines: string[] = []
  const walk = (id: string, level: number): unknown => {
    const n = graph.nodes.get(id)!
    lines.push(
      `${'  '.repeat(level)}${n.kind === 'branch' ? '▸ ' : ''}${label(n)}  ${n.id || '/'} · ${n.total} words`,
    )
    const children = level < depth ? n.children.map((c) => walk(c, level + 1)) : []
    return { id: n.id, kind: n.kind, title: n.title, icon: n.icon, words: n.total, children }
  }
  return { data: walk(start, 0), text: lines.join('\n') }
}

export function stats(fam: Family): Result {
  const { stats, hidden, ghosts, templates } = fam.graph
  const data = {
    name: fam.ref.title,
    ...stats,
    ghosts: ghosts.size,
    hidden: hidden.length,
    templates: templates.length,
  }
  return {
    data,
    text: `${data.name}: ${stats.leaves} leaves, ${stats.branches} branches, ${stats.threads} threads, ${stats.words} words · ${data.ghosts} ghosts, ${data.hidden} hidden, ${data.templates} templates`,
  }
}

/** A node's text: a leaf's file, a branch's README.md. */
export async function show(fam: Family, typed: string): Promise<Result> {
  const id = resolve(fam.graph, typed)
  const path = textFile(fam.graph, id)
  if (!path || !fam.files.has(path)) throw new UsageError(`${id || '/'} has no text`)
  const text = await fam.text(path)
  return { data: { path, text }, text: text.replace(/\n$/, '') }
}

/** Threads from and to a node, the ghosts it links to and its links to other Families. */
export function links(fam: Family, typed: string): Result {
  const { graph } = fam
  const id = resolve(graph, typed)
  const data = {
    id,
    out: graph.out.get(id) ?? [],
    in: graph.in.get(id) ?? [],
    ghosts: [...graph.ghosts.values()].filter((g) => g.from.includes(id)).map((g) => g.id),
    external: graph.external.filter((e) => e.from === id).map((e) => `${e.repo}:${e.path}`),
  }
  const list = (title: string, ids: string[], named = true) =>
    ids.length
      ? [`${title}:`, ...ids.map((i) => `  ${named ? `${where(graph, i)}  ` : ''}${i}`)]
      : []
  return {
    data,
    text:
      [
        ...list('Links to', data.out),
        ...list('Linked from', data.in),
        ...list('Ghosts (not written yet)', data.ghosts, false),
        ...list('Other Families', data.external, false),
      ].join('\n') || 'No threads.',
  }
}

/** Every Markdown file's text, at once. */
async function texts(fam: Family, paths: string[]): Promise<Map<string, string>> {
  return new Map(await Promise.all(paths.map(async (p) => [p, await fam.text(p)] as const)))
}

export async function find(fam: Family, query: string): Promise<Result> {
  const { graph } = fam
  const nodes = [...graph.nodes.values()].filter((n) => n.kind !== 'root')
  const known = await texts(
    fam,
    nodes.filter((n) => n.kind === 'leaf').map((n) => n.id),
  )
  const items = nodes.map((n): Searchable => ({
    repo: fam.ref.repo,
    id: n.id,
    title: n.title,
    kind: n.kind === 'leaf' ? 'leaf' : 'branch',
    icon: n.icon,
    ...(known.has(n.id) && { text: known.get(n.id)! }),
  }))
  const found = search(query, items).map((hit) => {
    const near = hit.inText ? snippet(known.get(hit.id)!, query) : null
    return {
      id: hit.id,
      title: hit.title,
      where: where(graph, hit.id),
      ...(near && { snippet: `${near.before}${near.match}${near.after}` }),
    }
  })
  return {
    data: found,
    text:
      found.map((f) => `${f.where}  ${f.id}${f.snippet ? `\n    ${f.snippet}` : ''}`).join('\n') ||
      'Nothing found.',
  }
}

export interface Issue {
  level: 'error' | 'warning'
  path: string
  message: string
}

/** Colour values are names (ARCHITECTURE.md §4), never hex or a CSS function. */
const COLOUR = /^#|^(rgb|hsl|oklch|lab|lch)a?\(/i
const colours = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(colours)
      : []

/**
 * What breaks the repository format, or the map: broken or mistyped links, missing files,
 * a broken line 2, colours written as hex. Ghosts (leaves linked to but not written) are
 * part of how Yeraz works, so they are only warnings.
 */
export async function check(fam: Family): Promise<Result> {
  const issues: Issue[] = []
  const { model, files } = fam
  const add = (level: Issue['level'], path: string, message: string) =>
    issues.push({ level, path, message })

  if (files.has('.yeraz.json')) {
    try {
      const marker: unknown = JSON.parse(await fam.text('.yeraz.json').catch(() => '{}'))
      for (const c of colours((marker as { color?: unknown; trees?: unknown }).color)) {
        if (COLOUR.test(c)) add('error', '.yeraz.json', `colour "${c}" must be a name, not hex`)
      }
    } catch {
      add('error', '.yeraz.json', 'not valid JSON')
    }
  }

  const lower = new Map([...files].map((f) => [f.toLowerCase(), f]))
  const docs = [...model.leaves, ...model.texts.keys(), ...model.templates.map((t) => t.path)]
  const all = await texts(fam, docs)
  for (const [path, raw] of all) {
    const lines = stripBom(raw).split(/\r\n|\r|\n/)
    if (!HEADING.exec(lines[0] ?? '')?.[1]?.trim())
      add('warning', path, 'line 1 is not a title (`# 🌱 Title`)')
    if (/^\s*<!--\s*yeraz\b/.test(lines[1] ?? '')) {
      const meta = META.test(lines[1]!) ? parseMeta(lines[1]) : null
      if (!meta) add('error', path, 'line 2 metadata is not valid JSON')
      for (const c of colours(meta?.color)) {
        if (COLOUR.test(c)) add('error', path, `colour "${c}" must be a name, not hex`)
      }
    }
    for (const [, bang, , dest] of prose(raw).matchAll(LINK)) {
      const target = ownPath(dest!)?.replace(/[?#].*$/, '')
      if (!target || files.has(target)) continue
      const typo = lower.get(target.toLowerCase())
      if (typo) add('error', path, `link to /${target}: the file is /${typo} (case differs)`)
      else if (bang || !target.endsWith('.md')) add('error', path, `missing file /${target}`)
      else if (target.endsWith('/README.md'))
        add('warning', path, `link to /${target}: that branch has no text yet`)
      else add('warning', path, `ghost: links to /${target}, not written yet`)
    }
  }

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message))
  const errors = issues.filter((i) => i.level === 'error').length
  return {
    data: issues,
    code: errors ? 1 : 0,
    text: issues.length
      ? [
          ...issues.map((i) => `${i.level === 'error' ? '✗' : '!'} ${i.path}: ${i.message}`),
          `${errors} errors, ${issues.length - errors} warnings`,
        ].join('\n')
      : 'All good.',
  }
}

export function templates(fam: Family): Result {
  const list = fam.graph.templates.map((t) => ({ path: t.path, title: t.title, icon: t.icon }))
  return {
    data: list,
    text:
      list.map((t) => `${t.icon ? `${t.icon} ` : ''}${t.title}  ${t.path}`).join('\n') ||
      'No templates (.yeraz/templates/).',
  }
}

/** Changes to save; `id` is the node they make or move, when there is one. */
export interface Plan {
  changes: FileChange[]
  id?: string
  /** Said before saving: what else the change touches. */
  notes?: string[]
}

export async function planNew(
  fam: Family,
  parent: string,
  title: string,
  opts: { branch?: boolean; template?: string; body?: string } = {},
): Promise<Plan> {
  const { graph } = fam
  const parentId = resolve(graph, parent)
  if (opts.branch) {
    const { branch, leaf } = planNewBranch(graph, parentId, title)
    return { changes: [leaf], id: branch }
  }
  let template: string | undefined
  if (opts.template) {
    const wanted = fold(opts.template)
    const t = graph.templates.find(
      (t) => fold(t.title) === wanted || t.path.toLowerCase().includes(`/${wanted}.md`),
    )
    if (!t)
      throw new UsageError(
        `No template "${opts.template}"; there are: ${graph.templates.map((t) => t.title).join(', ') || 'none'}`,
      )
    template = await fam.text(t.path)
  }
  const leaf = planNewLeaf(graph, parentId, title, template ? { template } : undefined)
  if (opts.body !== undefined)
    leaf.text = `${String(leaf.text).replace(/\s+$/, '')}\n\n${opts.body.replace(/\s+$/, '')}\n`
  return { changes: [leaf], id: leaf.path }
}

export async function planMv(fam: Family, typed: string, to: string): Promise<Plan> {
  const { graph } = fam
  const id = resolve(graph, typed)
  const parent = resolve(graph, to)
  const known = await texts(fam, [...new Set(moveReads(graph, id))])
  const moved = planMove(graph, (p) => known.get(p)!, id, parent)
  const rewritten = moved.changes.filter((c) => c.text !== null && !moved.moves.has(c.path))
  const relinked = rewritten.filter((c) => ![...moved.moves.values()].includes(c.path))
  return {
    changes: moved.changes,
    id: moved.id,
    notes: relinked.length ? [`Links rewritten in: ${relinked.map((c) => c.path).join(', ')}`] : [],
  }
}

export function planRm(fam: Family, typed: string, force = false): Plan {
  const { graph } = fam
  const id = resolve(graph, typed)
  const { changes, linkedFrom } = planDelete(graph, id)
  if (linkedFrom.length && !force)
    throw new UsageError(
      `${id} is linked from ${linkedFrom.join(', ')}: those links would become ghosts. --force deletes it anyway`,
    )
  return {
    changes,
    notes: linkedFrom.length ? [`Links to it become ghosts in: ${linkedFrom.join(', ')}`] : [],
  }
}

/** A node's text replaced, or added to; a branch without text gets its README.md. */
export async function planWrite(
  fam: Family,
  typed: string,
  input: string,
  append = false,
): Promise<Plan> {
  const { graph } = fam
  const id = resolve(graph, typed)
  if (id === ROOT) throw new UsageError('The root has no text: write to a leaf or a branch')
  const path = textFile(graph, id)!
  const before = fam.files.has(path) ? await fam.text(path) : planBranchText(graph, id).text
  const text = append ? `${before.replace(/\s+$/, '')}\n\n${input.replace(/\s+$/, '')}\n` : input
  return { changes: text === before ? [] : [{ path, text }], id }
}

/** A new Family's first files, in a folder: the marker and the note for AI agents. */
export function planInit(name: string, root?: string): FileChange[] {
  const marker = { name, ...(root && { root }) }
  return [
    { path: '.yeraz.json', text: `${JSON.stringify(marker)}\n` },
    { path: AGENTS_FILE, text: AGENTS_TEXT },
  ]
}

export { StructureError }

/** Saves a plan in one commit (or, with dryRun, only lists its files). */
export async function save(fam: Family, plan: Plan, dryRun = false): Promise<Result> {
  const files = plan.changes.map((c) => ({ path: c.path, deleted: c.text === null }))
  // - deleted, ~ changed, + new
  const lines = plan.changes.map(
    (c) => `${c.text === null ? '-' : fam.files.has(c.path) ? '~' : '+'} ${c.path}`,
  )
  if (!plan.changes.length) return { data: { files }, text: 'Nothing to change.' }
  if (dryRun)
    return {
      data: { dryRun: true, id: plan.id, files },
      text: [...lines, ...(plan.notes ?? [])].join('\n'),
    }
  const pushed = await fam.save(plan.changes)
  return {
    data: { id: plan.id, ...pushed },
    text: [
      ...lines,
      ...(plan.notes ?? []),
      ...pushed.conflicts.map((c) => `! changed elsewhere too: both kept, see ${c}`),
      ...(plan.id ? [`→ ${plan.id}`] : []),
    ].join('\n'),
  }
}
