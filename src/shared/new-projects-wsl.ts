// Where a new project's terminals start on a Windows machine with WSL: `settings.newProjectsInWsl`
// and `settings.newProjectsWslDistro`. See docs/reference/ssh-windows-wsl.md, "New projects in WSL".

import { WSL_UNC_PATH } from './terminal-profiles'

/** One installed distribution with a user shell, and whether WSL starts it by default. */
export interface WslDistro {
  name: string
  isDefault: boolean
}

/**
 * The distribution new projects use, or null for none. `picked` is the setting: empty means WSL's
 * default, and a picked name that is no longer installed falls back to it too. With no default
 * known (an older `wsl.exe`), the first listed distribution stands in for it.
 */
export function chooseNewProjectDistro(
  distros: readonly WslDistro[],
  picked: string
): string | null {
  if (distros.length === 0) return null
  const want = picked.trim().toLowerCase()
  const match = want ? distros.find((d) => d.name.toLowerCase() === want) : undefined
  return (match ?? distros.find((d) => d.isDefault) ?? distros[0]).name
}

/**
 * The listed distribution a Windows path is inside (`\\wsl.localhost\<distro>\...` or `\\wsl$\...`),
 * spelled as WSL lists it. Null for any other path, and for a distribution with no user shell.
 */
export function distroOfWslPath(path: string, distros: readonly WslDistro[]): string | null {
  const named = WSL_UNC_PATH.exec(path)?.[2]?.toLowerCase()
  if (!named) return null
  return distros.find((d) => d.name.toLowerCase() === named)?.name ?? null
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The Windows path of a Linux home inside `distro`, for a folder picker to start in. Null for a home
 *  that is not a plain absolute Linux path. */
export function wslHomeUncPath(distro: string, home: string): string | null {
  if (!home.startsWith('/') || home.includes('\\') || CONTROL.test(home)) return null
  return `\\\\wsl.localhost\\${distro}${home.replace(/\/+$/, '').split('/').join('\\')}`
}
