import { describe, expect, it } from 'vitest'
import { gitReadFailure, localGitCommand, wslDefaultCloneParent, wslRepoRef } from './wsl-git'
import type { ProfileExec } from './terminal-profiles'

const UNC = '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'

describe('wslRepoRef', () => {
  it.each([
    [UNC, 'Ubuntu', '/home/me/repo', '//wsl.localhost/Ubuntu'],
    ['//wsl.localhost/Ubuntu/home/me/repo', 'Ubuntu', '/home/me/repo', '//wsl.localhost/Ubuntu'],
    ['\\\\wsl$\\Debian\\srv', 'Debian', '/srv', '//wsl$/Debian'],
    ['\\\\WSL.LOCALHOST\\Ubuntu-22.04', 'Ubuntu-22.04', '/', '//WSL.LOCALHOST/Ubuntu-22.04']
  ])('reads %s', (cwd, distro, linuxPath, windowsRoot) => {
    expect(wslRepoRef(cwd, 'win32')).toEqual({ distro, linuxPath, windowsRoot })
  })

  it.each(['C:\\repo', '/home/me/repo', '\\\\server\\share\\repo', '\\\\wsl.localhost\\-rf\\x'])(
    'is not a WSL repository: %s',
    (cwd) => expect(wslRepoRef(cwd, 'win32')).toBeNull()
  )

  it('applies only on a Windows core', () => {
    expect(wslRepoRef(UNC, 'linux')).toBeNull()
  })
})

describe('localGitCommand', () => {
  it('leaves every other path as a plain local git', () => {
    const cmd = localGitCommand('/repo', ['status'], { maxBuffer: 1 }, 'linux')
    expect(cmd).toMatchObject({ file: 'git', args: ['status'], options: { cwd: '/repo', maxBuffer: 1 } })
    expect(cmd.mapOutput('a')).toBe('a')
  })

  it('runs inside the distribution, with no UNC working directory', () => {
    const cmd = localGitCommand(UNC, ['status'], { env: { GIT_TERMINAL_PROMPT: '0' } }, 'win32')
    expect(cmd.file).toMatch(/wsl\.exe$/)
    expect(cmd.args).toEqual(['-d', 'Ubuntu', '--exec', 'git', '-C', '/home/me/repo', 'status'])
    expect(cmd.options.cwd).toBeUndefined()
    expect(cmd.options.windowsHide).toBe(true)
  })

  it('forwards the no-prompt variable, keeping any WSLENV already set', () => {
    const bare = localGitCommand(UNC, ['push'], { env: {} }, 'win32')
    expect(bare.options.env?.WSLENV).toBe('GIT_TERMINAL_PROMPT')
    const kept = localGitCommand(UNC, ['push'], { env: { WSLENV: 'A/u' } }, 'win32')
    expect(kept.options.env?.WSLENV).toBe('A/u:GIT_TERMINAL_PROMPT')
  })

  it('translates a path argument in the same distribution only', () => {
    const add = localGitCommand(
      UNC,
      ['worktree', 'add', '//wsl.localhost/Ubuntu/home/me/wt', 'branch', '\\\\wsl$\\Debian\\x'],
      {},
      'win32'
    )
    expect(add.args.slice(6)).toEqual(['worktree', 'add', '/home/me/wt', 'branch', '\\\\wsl$\\Debian\\x'])
  })

  it('maps the repository root back to a path Windows can open', () => {
    const cmd = localGitCommand(UNC, ['rev-parse', '--show-toplevel'], {}, 'win32')
    expect(cmd.mapOutput('/home/me/repo')).toBe('//wsl.localhost/Ubuntu/home/me/repo')
  })

  it('maps only the path lines of a worktree listing', () => {
    const cmd = localGitCommand(UNC, ['worktree', 'list', '--porcelain'], {}, 'win32')
    expect(cmd.mapOutput('worktree /home/me/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /home/me/wt')).toBe(
      'worktree //wsl.localhost/Ubuntu/home/me/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree //wsl.localhost/Ubuntu/home/me/wt'
    )
  })

  it('does not rewrite output of commands that do not print absolute paths', () => {
    const cmd = localGitCommand(UNC, ['log'], {}, 'win32')
    expect(cmd.mapOutput('worktree /home/me/repo')).toBe('worktree /home/me/repo')
  })
})

describe('gitReadFailure', () => {
  it('reads a folder with no repository as an answer, in any language', () => {
    expect(gitReadFailure('fatal: not a git repository (or any of the parent directories): .git')).toBeNull()
    expect(gitReadFailure('fatal: no es un repositorio git')).toBeNull()
    expect(gitReadFailure('')).toBeNull()
  })

  it('reports a refused folder, which does not say a repository is absent', () => {
    const err = "fatal: detected dubious ownership in repository at '/x'\n\tgit config --global --add safe.directory /x"
    expect(gitReadFailure(err)).toBe(err)
  })

  it('reports git never getting to answer', () => {
    expect(gitReadFailure('spawn git ENOENT')).toBe('spawn git ENOENT')
    expect(gitReadFailure('ssh: connect to host h port 22: Connection refused')).toContain('ssh')
  })
})

describe('localGitCommand for a clone into WSL', () => {
  it('clones with the distribution git, into the Linux path of the target', () => {
    const parent = '\\\\wsl.localhost\\Ubuntu\\home\\me\\projects'
    const cmd = localGitCommand(
      parent,
      ['clone', '--progress', '--', 'https://github.com/o/r.git', `${parent}\\r`],
      {},
      'win32'
    )
    expect(cmd.args).toEqual([
      '-d', 'Ubuntu', '--exec', 'git', '-C', '/home/me/projects',
      'clone', '--progress', '--', 'https://github.com/o/r.git', '/home/me/projects/r'
    ])
  })
})

describe('wslDefaultCloneParent', () => {
  const answering = (stdout: string, code = 0): ProfileExec => async () => ({
    code,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0)
  })

  it('is the default distribution folder, as a UNC path', async () => {
    expect(await wslDefaultCloneParent(answering('Ubuntu\n/home/me/projects'), 'win32')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\projects'
    )
  })

  it('reads the UTF-16 wsl.exe can answer in', async () => {
    const exec: ProfileExec = async () => ({
      code: 0,
      stdout: Buffer.from('Debian\n/home/me', 'utf16le'),
      stderr: Buffer.alloc(0)
    })
    expect(await wslDefaultCloneParent(exec, 'win32')).toBe('\\\\wsl.localhost\\Debian\\home\\me')
  })

  it.each([
    ['WSL failed', answering('', 1)],
    ['no distribution name', answering('\n/home/me')],
    ['an unsafe distribution name', answering('-rf\n/home/me')],
    ['a home that is not a Linux path', answering('Ubuntu\nC:\\Users\\me')],
    ['wsl.exe missing', (async () => { throw new Error('ENOENT') }) as ProfileExec]
  ])('is null when %s', async (_, exec) => {
    expect(await wslDefaultCloneParent(exec, 'win32')).toBeNull()
  })

  it('asks nothing on a core that is not Windows', async () => {
    let asked = false
    const exec: ProfileExec = async () => {
      asked = true
      return { code: 0, stdout: Buffer.from('Ubuntu\n/home/me'), stderr: Buffer.alloc(0) }
    }
    expect(await wslDefaultCloneParent(exec, 'linux')).toBeNull()
    expect(asked).toBe(false)
  })
})
