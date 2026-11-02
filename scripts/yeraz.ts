// `yeraz`: a Family from the command line (src/cli/). A folder by default (the one holding
// `.yeraz.json`, found from here upwards), or a GitHub repository with --repo owner/name.
//   npm run yeraz -- <command> …     or, after `npm link`: yeraz <command> …

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { parseArgs } from 'node:util'
import { createGitHubClient } from '../src/github/client'
import { visible, type FolderFile, type FolderFs } from '../src/local/folder'
import * as cmd from '../src/cli/commands'
import { openFolder, openRepo, type Family } from '../src/cli/family'
import { handle } from '../src/cli/mcp'
import { createInterface } from 'node:readline'

const HELP = `yeraz — your Yeraz notes from the command line

Usage: yeraz <command> [arguments] [options]

Read
  tree [node] [--depth n]       the Family as an outline
  stats                         leaves, branches, threads, words
  show <node>                   a leaf's text (a branch's README.md)
  links <node>                  threads out and in, ghosts, other Families
  find <words…>                 titles first, then text
  check                         broken links, missing files, bad line 2, hex colours (exit 1 on errors)
  templates                     templates for new leaves

Write (one commit each; --dry-run shows the files instead)
  new <parent> <title> [--template name] [--body text] [--branch]
  mv <node> <new parent>        links to it are rewritten
  rm <node> [--force]           refuses while other leaves link to it, unless --force
  write <node> [--append]       the text from stdin
  init [folder] [--name n] [--root notes]   start a Family in a folder

Agents
  mcp                           serve these commands to an AI agent (MCP over stdio)

A node is its path (identity/keycloak.md, identity/keycloak, a folder; / is the root) or its title.

Options
  --dir <folder>        the Family's folder (default: found from here upwards)
  --repo <owner/name>   a Family on GitHub; token from YERAZ_TOKEN, GITHUB_TOKEN or \`gh auth token\`
  --json                data as JSON
  --dry-run             show what would change, change nothing`

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    repo: { type: 'string' },
    json: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    depth: { type: 'string' },
    template: { type: 'string' },
    body: { type: 'string' },
    branch: { type: 'boolean' },
    force: { type: 'boolean' },
    append: { type: 'boolean' },
    name: { type: 'string' },
    root: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [command, ...args] = positionals

/** A folder on this disk as the app's FolderFs (src/local/folder.ts). */
function diskFolder(root: string): FolderFs {
  const at = (path: string) => join(root, ...path.split('/'))
  return {
    async list() {
      const out: FolderFile[] = []
      const walk = (rel: string) => {
        for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
          if (!visible(entry.name, rel === '')) continue
          const path = rel ? `${rel}/${entry.name}` : entry.name
          if (entry.isDirectory()) walk(path)
          else if (entry.isFile()) {
            const s = statSync(at(path))
            out.push({ path, size: s.size, modified: s.mtimeMs })
          }
        }
      }
      walk('')
      return out
    },
    read: async (path) => new Uint8Array(readFileSync(at(path))),
    async write(path, bytes) {
      mkdirSync(dirname(at(path)), { recursive: true })
      writeFileSync(at(path), bytes)
    },
    async remove(path) {
      rmSync(at(path), { force: true })
      // Then any folder it leaves empty, up to the Family's.
      for (let dir = dirname(at(path)); dir.length > root.length; dir = dirname(dir)) {
        if (readdirSync(dir).length) break
        rmSync(dir, { recursive: true })
      }
    },
  }
}

/** The folder holding `.yeraz.json`, from `start` upwards. */
function familyFolder(start: string): string {
  for (let dir = resolvePath(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.yeraz.json'))) return dir
    if (dirname(dir) === dir)
      throw new cmd.UsageError(
        `No .yeraz.json here or above ${start}: give --dir, --repo, or run yeraz init`,
      )
  }
}

function token(): string {
  const env = process.env.YERAZ_TOKEN || process.env.GITHUB_TOKEN
  if (env) return env
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  } catch {
    throw new cmd.UsageError('No GitHub token: set YERAZ_TOKEN, or log in with `gh auth login`')
  }
}

async function open(): Promise<Family> {
  if (opt.repo) return openRepo(createGitHubClient({ token: token() }), opt.repo)
  const dir = opt.dir ? resolvePath(opt.dir) : familyFolder('.')
  return openFolder(diskFolder(dir), basename(dir))
}

const stdin = async () => {
  if (process.stdin.isTTY)
    throw new cmd.UsageError('Give the text on stdin: yeraz write <node> < file.md')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function need(n: number, usage: string) {
  if (args.length < n) throw new cmd.UsageError(`Usage: yeraz ${usage}`)
}

const save = (fam: Family, plan: cmd.Plan) => cmd.save(fam, plan, opt['dry-run'])

async function run(): Promise<cmd.Result> {
  if (opt.help || !command || command === 'help') return { data: null, text: HELP }
  if (command === 'init') {
    const dir = resolvePath(args[0] ?? opt.dir ?? '.')
    if (existsSync(join(dir, '.yeraz.json'))) throw new cmd.UsageError(`${dir} is a Family already`)
    const fs = diskFolder(dir)
    const files = cmd.planInit(opt.name ?? basename(dir), opt.root)
    if (!opt['dry-run'])
      for (const f of files) {
        if (!existsSync(join(dir, f.path)))
          await fs.write(f.path, new TextEncoder().encode(String(f.text)))
      }
    return {
      data: { dir, files: files.map((f) => f.path) },
      text: files.map((f) => `+ ${f.path}`).join('\n'),
    }
  }
  const fam = await open()
  switch (command) {
    case 'tree':
      return cmd.tree(fam, args[0], opt.depth ? Number(opt.depth) : undefined)
    case 'stats':
      return cmd.stats(fam)
    case 'show':
      need(1, 'show <node>')
      return cmd.show(fam, args.join(' '))
    case 'links':
      need(1, 'links <node>')
      return cmd.links(fam, args.join(' '))
    case 'find':
    case 'search':
      need(1, 'find <words…>')
      return cmd.find(fam, args.join(' '))
    case 'check':
      return cmd.check(fam)
    case 'templates':
      return cmd.templates(fam)
    case 'new':
      need(2, 'new <parent> <title> [--template name] [--body text] [--branch]')
      return save(
        fam,
        await cmd.planNew(fam, args[0]!, args.slice(1).join(' '), {
          ...(opt.branch && { branch: true }),
          ...(opt.template && { template: opt.template }),
          ...(opt.body !== undefined && { body: opt.body }),
        }),
      )
    case 'mv':
    case 'move':
      need(2, 'mv <node> <new parent>')
      return save(fam, await cmd.planMv(fam, args[0]!, args[1]!))
    case 'rm':
    case 'delete':
      need(1, 'rm <node> [--force]')
      return save(fam, cmd.planRm(fam, args.join(' '), opt.force))
    case 'write':
      need(1, 'write <node> [--append] < text')
      return save(fam, await cmd.planWrite(fam, args.join(' '), await stdin(), opt.append))
    default:
      throw new cmd.UsageError(`Unknown command "${command}". yeraz help lists them`)
  }
}

if (command === 'mcp') {
  // stdout is the protocol: one JSON-RPC message per line.
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue
    let out: object | undefined
    try {
      out = await handle(JSON.parse(line), open)
    } catch {
      out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
    }
    if (out)
      process.stdout.write(`${JSON.stringify(out)}
`)
  }
} else
  try {
    const result = await run()
    console.log(opt.json ? JSON.stringify(result.data, null, 2) : result.text)
    process.exitCode = result.code ?? 0
  } catch (e) {
    const known = e instanceof cmd.UsageError || e instanceof cmd.StructureError
    console.error(
      known || !(e instanceof Error) ? String(e instanceof Error ? e.message : e) : e.stack,
    )
    process.exitCode = known ? 2 : 1
  }
