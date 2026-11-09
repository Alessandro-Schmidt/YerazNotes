import { describe, expect, it } from 'vitest'
import { createFakeGitHub } from '../../test/fake-github/fakeGitHub'
import { isNewer, latestRelease, VERSION, YERAZ_REPO } from './update'
import desktop from '../../src-tauri/tauri.conf.json'

const API = 'https://api.github.com'

/** fetch, answered by the fake (no token: the check works signed out too). */
function fakeFetch(fake: ReturnType<typeof createFakeGitHub>): typeof fetch {
  return async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const res = await fake.handle({ method: 'GET', url: String(input), headers })
    return new Response(res.body as string, { status: res.status, headers: res.headers })
  }
}

describe('VERSION', () => {
  it('is the version the installers carry', () => {
    expect(VERSION).toBe(desktop.version)
  })
})

describe('isNewer', () => {
  it('compares dotted numbers, an optional v and a pre-release suffix aside', () => {
    expect(isNewer('0.4.0', '0.3.0')).toBe(true)
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.3.1', 'v0.3.0')).toBe(true)
    expect(isNewer('0.3.0', '0.3.0')).toBe(false)
    expect(isNewer('0.2.9', '0.3.0')).toBe(false)
    expect(isNewer('0.3', '0.3.0')).toBe(false)
    expect(isNewer('0.3.0-beta', '0.3.0')).toBe(false)
  })
})

describe('latestRelease', () => {
  it("answers Yeraz's newest published release, without a token", async () => {
    const fake = createFakeGitHub()
    fake.addRelease(YERAZ_REPO, 'v0.3.0')
    fake.addRelease(YERAZ_REPO, 'v0.4.0')
    fake.addRelease(YERAZ_REPO, 'v0.5.0', { draft: true })
    expect(await latestRelease(API, fakeFetch(fake))).toEqual({
      version: '0.4.0',
      url: `https://github.com/${YERAZ_REPO}/releases/tag/v0.4.0`,
    })
    expect(fake.log).toEqual([expect.objectContaining({ kind: 'release', status: 200 })])
  })

  it('fails with a sentence when GitHub has none or is unreachable', async () => {
    const fake = createFakeGitHub()
    await expect(latestRelease(API, fakeFetch(fake))).rejects.toThrow(
      'GitHub lists no release yet.',
    )
    await expect(
      latestRelease(API, () => Promise.reject(new TypeError('Failed to fetch'))),
    ).rejects.toThrow(/GitHub/)
  })
})
