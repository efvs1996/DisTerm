// The WSL guest share of a Windows session-host pane: what a `wsl:` pane runs lives in the WSL VM,
// which the Windows process table cannot see. Platform, table and wsl.exe are injected.
import { spawn, spawnSync } from 'child_process'
import { describe, it, expect } from 'vitest'
import {
  collectSessionHostMemory,
  parseWslGuestProbe,
  WSL_GUEST_PROBE_SCRIPT,
  type ProcEntry,
  type WslGuestReader
} from './session-memory'
import type { SessionHostListing } from './session-host-client'

const MEM = { availableMb: 8000, totalMb: 16000 }
const MB = 1024
const P = (pid: number, ppid: number, rssKb: number, name?: string): ProcEntry => ({
  pid,
  ppid,
  rssKb,
  ...(name ? { name } : {})
})
const detail = (name: string, pid: number) => ({
  name,
  pid,
  subscribers: 0,
  lastOutputMs: 1,
  createdMs: 1,
  generation: 'gen-aaaaaaaa'
})
const listing: SessionHostListing = {
  running: true,
  names: ['nt-wsl1', 'nt-pwsh1'],
  sessions: [detail('nt-wsl1', 100), detail('nt-pwsh1', 200)]
}
// The measured shape: shim wsl.exe -> wsl.exe -> wslhost.exe -> conhost.exe, about 44 MB.
const table: ProcEntry[] = [
  P(100, 1, 10 * MB, 'wsl.exe'),
  P(101, 100, 10 * MB, 'wsl.exe'),
  P(102, 101, 12 * MB, 'wslhost.exe'),
  P(103, 102, 12 * MB, 'conhost.exe'),
  P(200, 1, 80 * MB, 'pwsh.exe')
]

const probeOut = (lines: string[]): string => [...lines, 'NTWSL-END', ''].join('\n')
const UBUNTU = probeOut([
  'NTWSL /proc/700/environ:NODETERM_NODE_ID=wsl1',
  'NTWSL /proc/701/environ:NODETERM_NODE_ID=wsl1',
  'NTWSL /proc/702/environ:NODETERM_NODE_ID=wsl1',
  'NTWSL /proc/900/environ:NODETERM_NODE_ID=other',
  'NTWSL /proc/700/status:VmRSS:\t    9216 kB',
  'NTWSL /proc/701/status:VmRSS:\t  409600 kB',
  'NTWSL /proc/702/status:VmRSS:\t  230400 kB',
  'NTWSL /proc/900/status:VmRSS:\t    1024 kB',
  'NTWSL /proc/1/status:VmRSS:\t   13756 kB'
])

function scripted(running: string[] | null, answers: Record<string, string | null>) {
  const calls: string[] = []
  const reader: WslGuestReader = {
    running: async () => {
      calls.push('running')
      return running
    },
    probe: async (distro) => {
      calls.push(`probe:${distro}`)
      return answers[distro] ?? null
    }
  }
  return { calls, reader }
}

const sweep = (reader: WslGuestReader | null, over: Partial<Parameters<typeof collectSessionHostMemory>[0]> = {}) =>
  collectSessionHostMemory({
    list: async () => listing,
    readTable: async () => table,
    readMem: () => MEM,
    platformName: 'win32',
    wslGuest: reader,
    ...over
  })

describe('collectSessionHostMemory: the WSL guest share', () => {
  it('adds the in-distro processes of a WSL pane to its row, and re-sorts by the new total', async () => {
    const { calls, reader } = scripted(['Ubuntu'], { Ubuntu: UBUNTU })
    const r = await sweep(reader)
    expect(calls).toEqual(['running', 'probe:Ubuntu'])
    expect(r.rows.map((x) => [x.session, x.selfMb, x.childrenMb, x.totalMb, x.guest])).toEqual([
      ['nt-wsl1', 10, 34, 44 + 634, { measured: true, distros: ['Ubuntu'], mb: 634, processes: 3 }],
      ['nt-pwsh1', 80, 0, 80, undefined]
    ])
  })

  it('a timed-out probe leaves the row with its Windows total, marked probe-failed, never 0', async () => {
    const { reader } = scripted(['Ubuntu'], { Ubuntu: null })
    const r = await sweep(reader)
    expect(r.ok).toBe(true)
    expect(r.rows.map((x) => [x.session, x.totalMb, x.guest])).toEqual([
      ['nt-pwsh1', 80, undefined],
      ['nt-wsl1', 44, { measured: false, reason: 'probe-failed' }]
    ])
  })

  it('a cut-short stream (no end marker) is a failed probe', async () => {
    const { reader } = scripted(['Ubuntu'], { Ubuntu: 'NTWSL /proc/700/environ:NODETERM_NODE_ID=wsl1\n' })
    const r = await sweep(reader)
    expect(r.rows.find((x) => x.session === 'nt-wsl1')?.guest).toEqual({ measured: false, reason: 'probe-failed' })
  })

  it('WSL not answering the running list probes nothing and marks the pane probe-failed', async () => {
    const { calls, reader } = scripted(null, { Ubuntu: UBUNTU })
    const r = await sweep(reader)
    expect(calls).toEqual(['running'])
    expect(r.rows.find((x) => x.session === 'nt-wsl1')?.guest).toEqual({ measured: false, reason: 'probe-failed' })
  })

  it('every distro answered and none carries the pane: not-linked, still not a 0', async () => {
    const { reader } = scripted(['Ubuntu'], { Ubuntu: probeOut(['NTWSL /proc/1/status:VmRSS:\t 13756 kB']) })
    const r = await sweep(reader)
    expect(r.rows.find((x) => x.session === 'nt-wsl1')).toMatchObject({
      totalMb: 44,
      guest: { measured: false, reason: 'not-linked' }
    })
  })

  it('probes only distros the running list names, so a stopped one is never booted', async () => {
    const { calls, reader } = scripted(['Ubuntu'], { Ubuntu: UBUNTU, Debian: UBUNTU })
    await sweep(reader)
    expect(calls).toEqual(['running', 'probe:Ubuntu'])
  })

  it('a found pane is measured even when another distro failed; sums across distros it is in', async () => {
    const { reader } = scripted(['Ubuntu', 'Debian', 'Arch'], {
      Ubuntu: UBUNTU,
      Debian: null,
      Arch: probeOut(['NTWSL /proc/5/environ:NODETERM_NODE_ID=wsl1', 'NTWSL /proc/5/status:VmRSS:\t 2048 kB'])
    })
    const r = await sweep(reader)
    expect(r.rows[0].guest).toEqual({ measured: true, distros: ['Ubuntu', 'Arch'], mb: 636, processes: 4 })
  })

  it('no WSL pane: wsl.exe is never asked anything', async () => {
    const { calls, reader } = scripted(['Ubuntu'], { Ubuntu: UBUNTU })
    const r = await sweep(reader, {
      list: async () => ({ running: true, names: ['nt-pwsh1'], sessions: [detail('nt-pwsh1', 200)] })
    })
    expect(calls).toEqual([])
    expect(r.rows.map((x) => [x.session, x.totalMb, x.guest])).toEqual([['nt-pwsh1', 80, undefined]])
  })

  it('off Windows there is no default reader: a wsl.exe-named tree gets no guest and spawns nothing', async () => {
    const r = await collectSessionHostMemory({
      list: async () => listing,
      readTable: async () => table,
      readMem: () => MEM,
      platformName: 'linux'
    })
    expect(r.rows.map((x) => [x.session, x.totalMb, x.guest])).toEqual([
      ['nt-pwsh1', 80, undefined],
      ['nt-wsl1', 44, undefined]
    ])
  })
})

describe('parseWslGuestProbe', () => {
  it('ignores wsl.exe notices (UTF-16, so NUL-laden) mixed into stdout', () => {
    const notice = Buffer.from('wsl: A localhost proxy setting was detected\r\n', 'utf16le').toString('latin1')
    const parsed = parseWslGuestProbe(notice + UBUNTU.replace(/\n/g, '\r\n'))
    expect(parsed && Object.fromEntries(parsed)).toEqual({
      wsl1: { kb: 9216 + 409600 + 230400, processes: 3 },
      other: { kb: 1024, processes: 1 }
    })
  })
  it('a process that exited between the two reads is not counted', () => {
    const parsed = parseWslGuestProbe(probeOut(['NTWSL /proc/8/environ:NODETERM_NODE_ID=x']))
    expect(parsed && Object.fromEntries(parsed)).toEqual({})
  })
})

const hasLinuxSh = process.platform === 'linux' && spawnSync('sh', ['-c', 'true']).status === 0

describe.skipIf(!hasLinuxSh)('WSL_GUEST_PROBE_SCRIPT under a real /bin/sh and /proc', () => {
  it('finds a process carrying NODETERM_NODE_ID, with its VmRSS', async () => {
    const id = `probe-test-${process.pid}-${Date.now()}`
    const child = spawn('sleep', ['30'], { env: { ...process.env, NODETERM_NODE_ID: id }, stdio: 'ignore' })
    try {
      await new Promise((r) => setTimeout(r, 100))
      const env = { ...process.env }
      delete env.NODETERM_NODE_ID
      const out = spawnSync('sh', ['-c', WSL_GUEST_PROBE_SCRIPT], { env, encoding: 'latin1' })
      const hit = parseWslGuestProbe(out.stdout)?.get(id)
      expect(hit?.processes).toBe(1)
      const rss = Number(/VmRSS:\s+(\d+)/.exec(spawnSync('cat', [`/proc/${child.pid}/status`], { encoding: 'utf8' }).stdout)?.[1])
      expect(hit?.kb).toBe(rss)
    } finally {
      child.kill()
    }
  })
})
