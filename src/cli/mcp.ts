// `yeraz mcp`: the CLI's commands as an MCP server (stdio, JSON-RPC one message per line),
// so an AI agent can read and write a Family. The Family is reopened on every call: the
// files may change between them. Hand-rolled: the protocol part used here is ~40 lines.

import * as cmd from './commands'
import type { Family } from './family'

const node = {
  type: 'string',
  description: 'A path (identity/keycloak.md, a folder, / the root) or a title',
}
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
})
const dryRun = { type: 'boolean', description: 'List the files it would change, change nothing' }

type Args = Record<string, unknown>
const s = (a: Args, k: string) => (a[k] === undefined ? undefined : String(a[k]))
const req = (a: Args, k: string) => {
  const v = s(a, k)
  if (!v) throw new cmd.UsageError(`Missing "${k}"`)
  return v
}

export const TOOLS: {
  name: string
  description: string
  inputSchema: object
  run: (fam: Family, a: Args) => Promise<cmd.Result> | cmd.Result
}[] = [
  {
    name: 'tree',
    description: 'The Family (or a node) as an outline of branches and leaves',
    inputSchema: obj({ node, depth: { type: 'number' } }),
    run: (fam, a) =>
      cmd.tree(fam, s(a, 'node'), a.depth === undefined ? undefined : Number(a.depth)),
  },
  {
    name: 'stats',
    description: 'Counts: leaves, branches, threads, words',
    inputSchema: obj({}),
    run: (fam) => cmd.stats(fam),
  },
  {
    name: 'show',
    description: "A leaf's Markdown (a branch's README.md)",
    inputSchema: obj({ node }, ['node']),
    run: (fam, a) => cmd.show(fam, req(a, 'node')),
  },
  {
    name: 'links',
    description: 'Threads out of and into a node, ghosts, links to other Families',
    inputSchema: obj({ node }, ['node']),
    run: (fam, a) => cmd.links(fam, req(a, 'node')),
  },
  {
    name: 'find',
    description: 'Search titles first, then text',
    inputSchema: obj({ query: { type: 'string' } }, ['query']),
    run: (fam, a) => cmd.find(fam, req(a, 'query')),
  },
  {
    name: 'check',
    description: 'Broken links, missing files, bad metadata lines, hex colours',
    inputSchema: obj({}),
    run: (fam) => cmd.check(fam),
  },
  {
    name: 'templates',
    description: 'Templates for new leaves',
    inputSchema: obj({}),
    run: (fam) => cmd.templates(fam),
  },
  {
    name: 'new',
    description: 'Plant a leaf (or a branch) under a parent; one commit',
    inputSchema: obj(
      {
        parent: node,
        title: { type: 'string', description: 'Title, a leading emoji becomes the icon' },
        body: { type: 'string', description: 'Markdown after the title' },
        template: { type: 'string' },
        branch: { type: 'boolean' },
        dryRun,
      },
      ['parent', 'title'],
    ),
    run: async (fam, a) =>
      cmd.save(
        fam,
        await cmd.planNew(fam, req(a, 'parent'), req(a, 'title'), {
          ...(a.branch === true && { branch: true }),
          ...(a.template !== undefined && { template: String(a.template) }),
          ...(a.body !== undefined && { body: String(a.body) }),
        }),
        a.dryRun === true,
      ),
  },
  {
    name: 'mv',
    description: 'Move a node under a new parent; links to it are rewritten',
    inputSchema: obj({ node, parent: node, dryRun }, ['node', 'parent']),
    run: async (fam, a) =>
      cmd.save(fam, await cmd.planMv(fam, req(a, 'node'), req(a, 'parent')), a.dryRun === true),
  },
  {
    name: 'rm',
    description: 'Delete a node; refuses while other leaves link to it unless force',
    inputSchema: obj({ node, force: { type: 'boolean' }, dryRun }, ['node']),
    run: (fam, a) =>
      cmd.save(fam, cmd.planRm(fam, req(a, 'node'), a.force === true), a.dryRun === true),
  },
  {
    name: 'write',
    description:
      "Replace (or append to) a leaf's text. Keep line 1 (the title) and line 2 (metadata) when replacing",
    inputSchema: obj({ node, text: { type: 'string' }, append: { type: 'boolean' }, dryRun }, [
      'node',
      'text',
    ]),
    run: async (fam, a) =>
      cmd.save(
        fam,
        await cmd.planWrite(fam, req(a, 'node'), String(a.text ?? ''), a.append === true),
        a.dryRun === true,
      ),
  },
]

interface Message {
  id?: string | number
  method?: string
  params?: { name?: string; arguments?: Args; protocolVersion?: string }
}

/** One JSON-RPC message in, its response out (undefined for a notification). */
export async function handle(
  msg: Message,
  open: () => Promise<Family>,
): Promise<object | undefined> {
  if (msg.id === undefined) return undefined
  const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'yeraz', version: '1.0.0' },
        instructions:
          'A Yeraz Family: notes as Markdown. Leaves are .md files (line 1 the title), branches folders, threads root-relative links like [Keycloak](/identity/keycloak.md).',
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool)
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: `Unknown tool ${msg.params?.name}` },
        }
      try {
        const r = await tool.run(await open(), msg.params?.arguments ?? {})
        return reply({
          content: [{ type: 'text', text: r.text }],
          structuredContent: { data: r.data },
          isError: (r.code ?? 0) !== 0,
        })
      } catch (e) {
        return reply({
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        })
      }
    }
    default:
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `No method ${msg.method}` },
      }
  }
}
