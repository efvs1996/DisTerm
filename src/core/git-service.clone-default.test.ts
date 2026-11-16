import os from 'os'
import { describe, expect, it } from 'vitest'
import { GitService } from './git-service'

// The clone dialog's suggested folder. The WSL folder comes from the shell (the Windows desktop's
// "New projects in WSL" choice), which never picks Docker Desktop's distribution.
describe('GitService.cloneDefaultParent', () => {
  const homeDefault = async (): Promise<string> => new GitService().cloneDefaultParent()

  it('uses the folder new projects start in inside WSL', async () => {
    const wsl = '\\\\wsl.localhost\\Ubuntu\\home\\me'
    const service = new GitService({ wslCloneParent: async () => wsl })
    expect(await service.cloneDefaultParent()).toBe(wsl)
  })

  it('keeps the home default when the shell has no WSL folder (macOS, Server Edition, switch off)', async () => {
    const service = new GitService({ wslCloneParent: async () => undefined })
    expect(await service.cloneDefaultParent()).toBe(await homeDefault())
    expect((await homeDefault()).startsWith(os.homedir())).toBe(true)
  })

  it('keeps the home default when asking WSL fails', async () => {
    const service = new GitService({
      wslCloneParent: () => Promise.reject(new Error('wsl.exe missing'))
    })
    expect(await service.cloneDefaultParent()).toBe(await homeDefault())
  })
})
