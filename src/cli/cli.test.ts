import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeGitHub } from '../../test/fake-github/fakeGitHub'
import { fakeGitHubHandlers } from '../../test/fake-github/msw'
import { memoryFolder } from '../../test/memoryFolder'
import { createGitHubClient } from '../github/client'
import * as cmd from './commands'
import { openFolder, openRepo, type Family } from './family'

const FILES = {
  '.yeraz.json': '{"name":"Eng"}\n',
  'identity/README.md': '# 🪪 Identity\n',
  'identity/keycloak.md': '# 🔐 Keycloak\n\nRealms: [Realms](/identity/keycloak/realms.md).\n',
  'identity/keycloak/realms.md': '# Realms\n\nUsers live here.\n',
  'ops/deploy.md':
    '# 🚀 Deploy\n<!-- yeraz {"color":{"heading":"#ff0000"}} -->\n\nNeeds [Keycloak](/identity/keycloak.md), [Vault](/ops/vault.md), [x](/Identity/Keycloak.md) and ![d](/assets/d.png).\n',
  '.yeraz/templates/meeting.md': '# 🗓️ Meeting\n\n## {{title}} on {{date}}\n',
}

async function folder(files: Record<string, string> = FILES) {
  const fs = memoryFolder(files)
  return { fs, fam: await openFolder(fs, 'eng') }
}
const reopen = (fs: ReturnType<typeof memoryFolder>) => openFolder(fs, 'eng')
const save = async (fam: Family, plan: cmd.Plan) => fam.save(plan.changes)

describe('resolve', () => {
  it('takes a path, a path without .md, a folder, a title, or . for the root', async () => {
    const { fam } = await folder()
    const g = fam.graph
    expect(cmd.resolve(g, 'identity/keycloak.md')).toBe('identity/keycloak.md')
    expect(cmd.resolve(g, '/identity/keycloak')).toBe('identity/keycloak.md')
    expect(cmd.resolve(g, 'identity/')).toBe('identity')
    expect(cmd.resolve(g, 'keycloak')).toBe('identity/keycloak.md')
    expect(cmd.resolve(g, '🔐 Keycloak')).toBe('identity/keycloak.md')
    expect(cmd.resolve(g, '.')).toBe('')
    expect(() => cmd.resolve(g, 'nope')).toThrow(cmd.UsageError)
  })

  it('asks for a path when a title is shared', async () => {
    const { fam } = await folder({ ...FILES, 'ops/realms.md': '# Realms\n' })
    expect(() => cmd.resolve(fam.graph, 'realms')).toThrow(/names 2 nodes/)
  })
})

describe('read commands', () => {
  it('tree, stats, show, links, find, templates', async () => {
    const { fam } = await folder()
    expect(cmd.tree(fam).text).toContain('      Realms  identity/keycloak/realms.md')
    expect(cmd.tree(fam, '.', 1).text.split('\n')).toHaveLength(3)
    expect(cmd.stats(fam).data).toMatchObject({ leaves: 3, branches: 2, ghosts: 1, templates: 1 })
    expect((await cmd.show(fam, 'identity')).data).toMatchObject({ path: 'identity/README.md' })
    expect(cmd.links(fam, 'keycloak').data).toMatchObject({
      out: ['identity/keycloak/realms.md'],
      in: ['ops/deploy.md'],
    })
    expect(cmd.links(fam, 'deploy').data).toMatchObject({ ghosts: ['ops/vault.md'] })
    const found = (await cmd.find(fam, 'users')).data as { id: string; snippet?: string }[]
    expect(found).toEqual([
      expect.objectContaining({ id: 'identity/keycloak/realms.md', snippet: 'Users live here.' }),
    ])
    expect(cmd.templates(fam).data).toEqual([
      { path: '.yeraz/templates/meeting.md', title: 'Meeting', icon: '🗓️' },
    ])
  })

  it('check: errors for missing files, case typos, hex colours; ghosts are warnings', async () => {
    const { fam } = await folder({ ...FILES, 'bad.md': '# Bad\n<!-- yeraz {oops} -->\n' })
    const result = await cmd.check(fam)
    expect(result.code).toBe(1)
    expect(result.data).toEqual([
      { level: 'error', path: 'bad.md', message: 'line 2 metadata is not valid JSON' },
      expect.objectContaining({
        level: 'error',
        message: 'colour "#ff0000" must be a name, not hex',
      }),
      expect.objectContaining({ level: 'warning', message: expect.stringMatching(/^ghost/) }),
      expect.objectContaining({ level: 'error', message: expect.stringMatching(/case differs/) }),
      expect.objectContaining({ level: 'error', message: 'missing file /assets/d.png' }),
    ])
    const clean = await folder({ '.yeraz.json': '{}', 'a.md': '# A\n' })
    expect((await cmd.check(clean.fam)).code).toBe(0)
  })
})

describe('write commands', () => {
  it('new: a leaf, from a template, with a body; a branch', async () => {
    const { fs, fam } = await folder()
    await save(fam, await cmd.planNew(fam, 'identity', 'Sync job', { template: 'meeting' }))
    expect(fs.text('identity/sync-job.md')).toMatch(/^# 🗓️ Sync job\n\n## Sync job on \d{4}-/)
    const next = await reopen(fs)
    await save(next, await cmd.planNew(next, '.', 'Notes', { body: 'Hello.' }))
    expect(fs.text('notes.md')).toBe('# Notes\n\nHello.\n')
    const plan = await cmd.planNew(await reopen(fs), '.', 'Infra', { branch: true })
    expect(plan.id).toBe('Infra')
    expect(plan.changes[0]!.path).toBe('Infra/untitled.md')
  })

  it('mv rewrites every link to what moved, in one save', async () => {
    const { fs, fam } = await folder()
    const plan = await cmd.planMv(fam, 'keycloak', 'ops')
    expect(plan.id).toBe('ops/keycloak.md')
    expect(plan.notes).toEqual(['Links rewritten in: ops/deploy.md'])
    await save(fam, plan)
    expect(fs.text('identity/keycloak.md')).toBeUndefined()
    expect(fs.text('ops/keycloak/realms.md')).toContain('Users live here.')
    expect(fs.text('ops/keycloak.md')).toContain('(/ops/keycloak/realms.md)')
    expect(fs.text('ops/deploy.md')).toContain('[Keycloak](/ops/keycloak.md)')
  })

  it('rm refuses while linked, unless forced', async () => {
    const { fs, fam } = await folder()
    expect(() => cmd.planRm(fam, 'keycloak')).toThrow(/linked from ops\/deploy\.md/)
    await save(fam, cmd.planRm(fam, 'keycloak', true))
    expect(fs.text('identity/keycloak.md')).toBeUndefined()
    expect(fs.text('identity/keycloak/realms.md')).toBeUndefined()
  })

  it('write replaces or appends; a branch without text gets its README.md', async () => {
    const { fs, fam } = await folder()
    await save(fam, await cmd.planWrite(fam, 'realms', 'More.', true))
    expect(fs.text('identity/keycloak/realms.md')).toBe('# Realms\n\nUsers live here.\n\nMore.\n')
    const next = await reopen(fs)
    await save(next, await cmd.planWrite(next, 'ops', 'Runbooks.', true))
    expect(fs.text('ops/README.md')).toBe('# Ops\n\nRunbooks.\n')
    expect(
      (await cmd.planWrite(await reopen(fs), 'realms', fs.text('identity/keycloak/realms.md')!))
        .changes,
    ).toEqual([])
  })

  it('a Family under .yeraz.json root sees only its folder', async () => {
    const fs = memoryFolder({
      '.yeraz.json': '{"name":"Proj","root":"notes"}',
      'src/index.md': '# Not a note\n',
      'notes/a.md': '# A\n',
    })
    const fam = await openFolder(fs, 'proj')
    expect([...fam.graph.nodes.keys()]).toEqual(['', 'a.md'])
    await save(fam, await cmd.planNew(fam, '.', 'B'))
    expect(fs.text('notes/b.md')).toBe('# B\n\n')
  })

  it('init: the marker and the note for AI agents', () => {
    expect(cmd.planInit('Mine', 'notes').map((f) => [f.path, f.text])).toEqual([
      ['.yeraz.json', '{"name":"Mine","root":"notes"}\n'],
      ['CLAUDE.md', expect.stringContaining('# 🤖')],
    ])
  })
})

describe('on GitHub', () => {
  const fake = createFakeGitHub({ login: 'you' })
  const server = setupServer(...fakeGitHubHandlers(fake))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())

  it('reads the repository and moves in one commit', async () => {
    await fake.addRepo('you/eng', FILES)
    const fam = await openRepo(createGitHubClient({ token: 't' }), 'you/eng')
    expect(cmd.stats(fam).data).toMatchObject({ name: 'Eng', leaves: 3 })
    fake.resetLog()
    await save(fam, await cmd.planMv(fam, 'keycloak', 'ops'))
    expect(fake.log.filter((e) => e.method === 'POST')).toHaveLength(1)
    expect(fake.repo('you/eng').read('ops/deploy.md')).toContain('(/ops/keycloak.md)')
    expect(fake.repo('you/eng').read('identity/keycloak.md')).toBeUndefined()
  })
})
