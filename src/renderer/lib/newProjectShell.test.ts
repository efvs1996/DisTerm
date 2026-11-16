import { describe, expect, it, vi } from 'vitest'
import type { ProjectLocalSettings, ProjectSettingsSnapshot } from '@shared/project-settings'
import { applyNewProjectShell, newProjectShell } from './newProjectShell'

const ROWS = [
  { label: 'WSL: Debian', shell: 'wsl:Debian' },
  { label: 'WSL: My Distro', shell: 'wsl:My%20Distro', isDefault: true as const }
]
const ON = { newProjectsInWsl: true, newProjectsWslDistro: '' }

describe('newProjectShell', () => {
  it('gives a project with no folder the default distribution', () => {
    expect(newProjectShell(ON, ROWS)).toBe('wsl:My%20Distro')
  })

  it('gives it the picked distribution', () => {
    expect(newProjectShell({ ...ON, newProjectsWslDistro: 'Debian' }, ROWS)).toBe('wsl:Debian')
  })

  it('gives a folder inside WSL its own distribution', () => {
    expect(newProjectShell(ON, ROWS, '\\\\wsl.localhost\\Debian\\home\\me\\app')).toBe('wsl:Debian')
  })

  it('leaves a Windows folder on the Windows shell', () => {
    expect(newProjectShell(ON, ROWS, 'C:\\Users\\me\\app')).toBeNull()
  })

  it('changes nothing when the setting is off', () => {
    const off = { ...ON, newProjectsInWsl: false }
    expect([newProjectShell(off, ROWS), newProjectShell(off, ROWS, '\\\\wsl$\\Debian\\srv')]).toEqual([null, null])
  })

  it('changes nothing with no distribution (or off Windows, where none are listed)', () => {
    expect(newProjectShell(ON, [])).toBeNull()
  })
})

function fakeApi(local: ProjectLocalSettings | undefined, known = true) {
  const snapshot: ProjectSettingsSnapshot = { shared: null, local }
  return {
    read: vi.fn(async () => (known ? snapshot : null)),
    updateLocal: vi.fn(async (_id: string, _local: ProjectLocalSettings | undefined) => known)
  }
}

describe('applyNewProjectShell', () => {
  it('writes the shell into the LOCAL overlay only, keeping what else is there', async () => {
    const api = fakeApi({ terminal: { theme: 'dark' }, agents: { defaultAgentId: 'claude' } })
    expect(await applyNewProjectShell(api, 'p1', 'wsl:Ubuntu')).toBe(true)
    expect(api.updateLocal.mock.calls).toEqual([
      ['p1', { terminal: { theme: 'dark', shell: 'wsl:Ubuntu' }, agents: { defaultAgentId: 'claude' } }]
    ])
  })

  it('creates the overlay for a brand-new project', async () => {
    const api = fakeApi(undefined)
    await applyNewProjectShell(api, 'p1', 'wsl:Ubuntu')
    expect(api.updateLocal.mock.calls).toEqual([['p1', { terminal: { shell: 'wsl:Ubuntu' } }]])
  })

  it('keeps a shell the user already set on this machine', async () => {
    const api = fakeApi({ terminal: { shell: 'pwsh' } })
    expect(await applyNewProjectShell(api, 'p1', 'wsl:Ubuntu')).toBe(false)
    expect(api.updateLocal.mock.calls).toEqual([])
  })

  it('writes nothing for a project the core does not know yet', async () => {
    const api = fakeApi(undefined, false)
    expect(await applyNewProjectShell(api, 'p1', 'wsl:Ubuntu')).toBe(false)
    expect(api.updateLocal.mock.calls).toEqual([])
  })
})
