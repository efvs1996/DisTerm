import { describe, expect, it } from 'vitest'
import { chooseNewProjectDistro, distroOfWslPath, wslHomeUncPath } from './new-projects-wsl'

const DISTROS = [
  { name: 'Debian', isDefault: false },
  { name: 'Ubuntu', isDefault: true },
  { name: 'My Distro', isDefault: false }
]

describe('chooseNewProjectDistro', () => {
  it('takes WSL’s default when nothing is picked', () => {
    expect(chooseNewProjectDistro(DISTROS, '')).toBe('Ubuntu')
  })

  it('takes the picked distribution, in WSL’s spelling', () => {
    expect(chooseNewProjectDistro(DISTROS, 'my distro')).toBe('My Distro')
  })

  it('falls back to the default when the picked one is gone', () => {
    expect(chooseNewProjectDistro(DISTROS, 'Arch')).toBe('Ubuntu')
  })

  it('takes the first listed one when no default is known', () => {
    expect(chooseNewProjectDistro([{ name: 'Debian', isDefault: false }], '')).toBe('Debian')
  })

  it('has nothing to choose with no distribution', () => {
    expect(chooseNewProjectDistro([], 'Ubuntu')).toBeNull()
  })
})

describe('distroOfWslPath', () => {
  it('reads both UNC spellings and either slash', () => {
    expect(distroOfWslPath('\\\\wsl.localhost\\ubuntu\\home\\me\\app', DISTROS)).toBe('Ubuntu')
    expect(distroOfWslPath('\\\\wsl$\\Debian\\srv', DISTROS)).toBe('Debian')
    expect(distroOfWslPath('//wsl.localhost/Ubuntu', DISTROS)).toBe('Ubuntu')
  })

  it('answers null for a Windows folder and for an unlisted distribution', () => {
    expect(distroOfWslPath('C:\\Users\\me\\app', DISTROS)).toBeNull()
    expect(distroOfWslPath('\\\\wsl.localhost\\docker-desktop\\tmp', DISTROS)).toBeNull()
  })
})

describe('wslHomeUncPath', () => {
  it('spells a Linux home as the Windows path into the distribution', () => {
    expect(wslHomeUncPath('Ubuntu', '/home/me')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me')
    expect(wslHomeUncPath('Ubuntu', '/root/')).toBe('\\\\wsl.localhost\\Ubuntu\\root')
  })

  it('refuses a home that is not a plain absolute Linux path', () => {
    expect(wslHomeUncPath('Ubuntu', 'home/me')).toBeNull()
    expect(wslHomeUncPath('Ubuntu', '/home/a\\b')).toBeNull()
    expect(wslHomeUncPath('Ubuntu', '/home/me\n')).toBeNull()
  })
})
