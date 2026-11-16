// Where "Open folder…" starts on a Windows machine whose new projects go into WSL: the chosen
// distribution's Linux home, as a `\\wsl.localhost` path. See docs/reference/ssh-windows-wsl.md,
// "New projects in WSL".

import { chooseNewProjectDistro, wslHomeUncPath, type WslDistro } from '../shared/new-projects-wsl'
import { parseWslShell, wslShellValue } from '../shared/terminal-profiles'
import type { WslRun } from './remote-ssh/native/wsl-endpoint'

/** Learning the home starts the distribution, and the picker waits on it: past this it opens where
 *  it always did. */
export const WSL_HOME_TIMEOUT_MS = 5_000

const HOME_MARKER = 'NTHOME:'
const HOME_SCRIPT = `printf '${HOME_MARKER}%s\\n' "$HOME"`

/** The home from the probe's output. `wsl.exe`'s own text can precede it, so the marker decides. */
export function parseWslHome(stdout: Buffer): string | null {
  for (const line of stdout.toString('utf8').split(/\r?\n/)) {
    const at = line.indexOf(HOME_MARKER)
    if (at >= 0) {
      const home = line.slice(at + HOME_MARKER.length).trim()
      return home.startsWith('/') ? home : null
    }
  }
  return null
}

/**
 * Each distribution's Linux home, asked once per app run. A miss is not kept: the distribution may
 * only have been slow to boot, and the next picker asks again.
 */
export class WslHomes {
  private readonly known = new Map<string, string>()
  private readonly asking = new Map<string, Promise<string | null>>()

  constructor(private readonly run: WslRun) {}

  home(distro: string): Promise<string | null> {
    // The name becomes one argv element after `-d`: refuse what a `wsl:` profile would refuse.
    if (parseWslShell(wslShellValue(distro)) !== distro) return Promise.resolve(null)
    const hit = this.known.get(distro)
    if (hit) return Promise.resolve(hit)
    const pending = this.asking.get(distro)
    if (pending) return pending
    const ask = this.run(['-d', distro, '--exec', 'sh', '-c', HOME_SCRIPT], {
      timeoutMs: WSL_HOME_TIMEOUT_MS
    })
      .then((r) => (r.timedOut || r.code !== 0 ? null : parseWslHome(r.stdout)))
      .catch(() => null)
      .then((home) => {
        this.asking.delete(distro)
        if (home) this.known.set(distro, home)
        return home
      })
    this.asking.set(distro, ask)
    return ask
  }
}

export interface NewProjectFolderStartDeps {
  platform: NodeJS.Platform | string
  settings: { newProjectsInWsl?: boolean; newProjectsWslDistro?: string }
  distros(): Promise<WslDistro[]>
  homes: Pick<WslHomes, 'home'>
}

/** The folder "Open folder…" starts in, or undefined to leave the picker where it always opened. */
export async function newProjectFolderStart(deps: NewProjectFolderStartDeps): Promise<string | undefined> {
  if (deps.platform !== 'win32' || deps.settings.newProjectsInWsl !== true) return undefined
  const distro = chooseNewProjectDistro(
    await deps.distros().catch(() => []),
    deps.settings.newProjectsWslDistro ?? ''
  )
  if (!distro) return undefined
  const home = await deps.homes.home(distro)
  return (home && wslHomeUncPath(distro, home)) || undefined
}
