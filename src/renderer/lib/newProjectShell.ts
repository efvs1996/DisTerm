// A new project's shell on a Windows desktop with WSL (`settings.newProjectsInWsl`). See
// docs/reference/ssh-windows-wsl.md, "New projects in WSL".

import {
  chooseNewProjectDistro,
  distroOfWslPath,
  type WslDistro
} from '@shared/new-projects-wsl'
import { parseWslShell, wslShellValue } from '@shared/terminal-profiles'
import type { ProjectSettingsApi, Settings } from '@shared/types'
import { isBrowserRuntime } from '../bridge/runtime'
import { invalidateProjectLaunchInfo, ensureProjectLaunchInfo } from '../state/projectLaunchInfo'
import { useSettings } from '../state/settings'
import { useWslTerminals, type WslTerminalRow } from '../state/wslTerminals'

/**
 * The `wsl:` shell a project created now gets, or null to leave it as it always was. A folder the user
 * opened gets the distribution it is inside, and only that: a Windows folder keeps the Windows shell.
 * A project with no folder gets the chosen distribution, whose launch with no cwd starts in `$HOME`.
 * `rows` is this machine's distributions, which is empty off Windows.
 */
export function newProjectShell(
  settings: Pick<Settings, 'newProjectsInWsl' | 'newProjectsWslDistro'>,
  rows: readonly WslTerminalRow[],
  folder?: string
): string | null {
  if (settings.newProjectsInWsl !== true) return null
  const distros: WslDistro[] = rows.flatMap((r) => {
    const name = parseWslShell(r.shell)
    return name ? [{ name, isDefault: r.isDefault === true }] : []
  })
  const distro =
    folder === undefined
      ? chooseNewProjectDistro(distros, settings.newProjectsWslDistro ?? '')
      : distroOfWslPath(folder, distros)
  return distro ? wslShellValue(distro) : null
}

/** {@link newProjectShell} from the live settings and rows. Desktop only: a browser tab's projects
 *  belong to the Server Edition. */
export function newProjectShellNow(folder?: string): string | null {
  if (isBrowserRuntime()) return null
  return newProjectShell(useSettings.getState().settings, useWslTerminals.getState().rows, folder)
}

/**
 * Writes `shell` into the project's LOCAL overlay, where it runs with no trust question and never
 * reaches the shared `.nodeterm/settings.json`. A shell already in the overlay is the user's and
 * stays. The project must already be in the core's index, so callers run this after a save.
 */
export async function applyNewProjectShell(
  api: Pick<ProjectSettingsApi, 'read' | 'updateLocal'>,
  projectId: string,
  shell: string
): Promise<boolean> {
  const snapshot = await api.read(projectId).catch(() => null)
  if (!snapshot || snapshot.local?.terminal?.shell) return false
  const local = snapshot.local ?? {}
  const ok = await api
    .updateLocal(projectId, { ...local, terminal: { ...local.terminal, shell } })
    .catch(() => false)
  if (ok) {
    invalidateProjectLaunchInfo(projectId)
    void ensureProjectLaunchInfo(projectId)
  }
  return ok
}
