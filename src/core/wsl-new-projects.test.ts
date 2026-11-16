import { describe, expect, it, vi } from 'vitest'
import type { WslRun, WslRunResult } from './remote-ssh/native/wsl-endpoint'
import { newProjectFolderStart, parseWslHome, WSL_HOME_TIMEOUT_MS, WslHomes } from './wsl-new-projects'

const answer = (stdout: string, code: number | null = 0, timedOut = false): WslRunResult => ({
  code,
  stdout: Buffer.from(stdout),
  stderr: Buffer.alloc(0),
  timedOut
})

const UBUNTU = [{ name: 'Ubuntu', isDefault: true }]
const ON = { newProjectsInWsl: true, newProjectsWslDistro: '' }

describe('parseWslHome', () => {
  it('reads the marked line past wsl.exe’s own text', () => {
    expect(parseWslHome(Buffer.from('wsl: some notice\nNTHOME:/home/me\n'))).toBe('/home/me')
  })

  it('answers null with no marker or a relative home', () => {
    expect(parseWslHome(Buffer.from('/home/me\n'))).toBeNull()
    expect(parseWslHome(Buffer.from('NTHOME:\n'))).toBeNull()
  })
})

describe('WslHomes', () => {
  it('asks the distribution once, as argv, under the hard timeout', async () => {
    const run = vi.fn<WslRun>(async () => answer('NTHOME:/home/me\n'))
    const homes = new WslHomes(run)
    expect(await homes.home('My Distro')).toBe('/home/me')
    expect(await homes.home('My Distro')).toBe('/home/me')
    expect(run.mock.calls).toEqual([
      [
        ['-d', 'My Distro', '--exec', 'sh', '-c', `printf 'NTHOME:%s\\n' "$HOME"`],
        { timeoutMs: WSL_HOME_TIMEOUT_MS }
      ]
    ])
  })

  it('keeps no miss, so a distribution that was booting is asked again', async () => {
    const run = vi
      .fn<WslRun>()
      .mockResolvedValueOnce(answer('', null, true))
      .mockResolvedValueOnce(answer('NTHOME:/home/me\n'))
    const homes = new WslHomes(run)
    expect(await homes.home('Ubuntu')).toBeNull()
    expect(await homes.home('Ubuntu')).toBe('/home/me')
  })

  it('never runs wsl.exe for a name a wsl: profile would refuse', async () => {
    const run = vi.fn<WslRun>(async () => answer('NTHOME:/home/me\n'))
    expect(await new WslHomes(run).home('-u root')).toBeNull()
    expect(run).toHaveBeenCalledTimes(0)
  })
})

describe('newProjectFolderStart', () => {
  const homes = (home: string | null) => ({ home: vi.fn(async () => home) })

  it('starts in the default distribution’s home', async () => {
    const start = await newProjectFolderStart({
      platform: 'win32',
      settings: ON,
      distros: async () => UBUNTU,
      homes: homes('/home/me')
    })
    expect(start).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me')
  })

  it('asks the picked distribution', async () => {
    const h = homes('/home/dev')
    const start = await newProjectFolderStart({
      platform: 'win32',
      settings: { newProjectsInWsl: true, newProjectsWslDistro: 'Debian' },
      distros: async () => [...UBUNTU, { name: 'Debian', isDefault: false }],
      homes: h
    })
    expect(start).toBe('\\\\wsl.localhost\\Debian\\home\\dev')
    expect(h.home.mock.calls).toEqual([['Debian']])
  })

  it.each([
    ['the setting is off', { platform: 'win32', settings: { ...ON, newProjectsInWsl: false }, list: UBUNTU, home: '/home/me' }],
    ['the core is not Windows', { platform: 'linux', settings: ON, list: UBUNTU, home: '/home/me' }],
    ['there is no distribution', { platform: 'win32', settings: ON, list: [], home: '/home/me' }],
    ['the home lookup failed', { platform: 'win32', settings: ON, list: UBUNTU, home: null }]
  ])('leaves the picker where it was when %s', async (_why, c) => {
    const h = homes(c.home)
    const start = await newProjectFolderStart({
      platform: c.platform,
      settings: c.settings,
      distros: async () => c.list,
      homes: h
    })
    expect(start).toBeUndefined()
  })

  it('starts no distribution when the setting is off', async () => {
    const h = homes('/home/me')
    const distros = vi.fn(async () => UBUNTU)
    await newProjectFolderStart({ platform: 'win32', settings: { ...ON, newProjectsInWsl: false }, distros, homes: h })
    expect([distros.mock.calls.length, h.home.mock.calls.length]).toEqual([0, 0])
  })
})
