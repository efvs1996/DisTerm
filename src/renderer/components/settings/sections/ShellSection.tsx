import { useState } from 'react'
import { useSettings } from '../../../state/settings'
import { useTerminalProfiles } from '../../../terminal/use-terminal-profiles'
import { useCoreIsWindows } from '../../../terminal/use-core-platform'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { Switch } from '@renderer/ui/Switch'
import { parseWslShell } from '@shared/terminal-profiles'
import { chooseNewProjectDistro } from '@shared/new-projects-wsl'
import { isBrowserRuntime } from '../../../bridge/runtime'
import { isWindowsPlatform } from '@shared/platform-utils'

const ROWS = {
  shell: {
    title: 'Default shell',
    keywords: ['shell', 'bash', 'zsh', 'fish', 'default', 'wsl', 'powershell', 'cmd', 'ubuntu']
  },
  newProjectsInWsl: {
    title: 'Start new projects in WSL',
    keywords: ['wsl', 'new project', 'open folder', 'distribution', 'distro', 'linux', 'home', 'ubuntu']
  }
}
const ENTRIES =
  typeof navigator !== 'undefined' && !isBrowserRuntime() && isWindowsPlatform()
    ? Object.values(ROWS)
    : [ROWS.shell]

const CUSTOM = '__custom__'

export function ShellSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const defaultShell = useSettings((s) => s.settings.defaultShell)
  const update = useSettings((s) => s.update)
  const profiles = useTerminalProfiles(useCoreIsWindows() && isActive)
  const newProjectsInWsl = useSettings((s) => s.settings.newProjectsInWsl)
  const newProjectsWslDistro = useSettings((s) => s.settings.newProjectsWslDistro)
  const [customChosen, setCustomChosen] = useState(false)
  const custom = customChosen || !profiles.some((p) => p.value === defaultShell)
  // The desktop's own distributions; a browser tab's new projects are the Server Edition's.
  const distros = isBrowserRuntime()
    ? []
    : profiles.flatMap((p) => {
        const name = p.kind === 'wsl' ? parseWslShell(p.value) : null
        return name ? [{ name, isDefault: p.isDefault === true }] : []
      })
  const wslDefault = chooseNewProjectDistro(distros, '')
  return (
    <SettingsSection
      id="shell"
      title="Shell"
      description="The shell new terminals launch. Empty uses the system default."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.shell}>
        <FieldRow
          label="Default shell"
          control={
            <div className="flex items-center gap-2">
              {profiles.length > 0 && (
                <Select
                  aria-label="Default shell profile"
                  value={custom ? CUSTOM : defaultShell}
                  onChange={(e) => {
                    const chosen = e.target.value
                    setCustomChosen(chosen === CUSTOM)
                    if (chosen !== CUSTOM) update({ defaultShell: chosen })
                  }}
                >
                  {profiles.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value={CUSTOM}>Custom…</option>
                </Select>
              )}
              {(profiles.length === 0 || custom) && (
                <Input
                  className="w-64"
                  placeholder="system default"
                  value={defaultShell}
                  onChange={(e) => update({ defaultShell: e.target.value })}
                />
              )}
            </div>
          }
        />
      </SearchableRow>
      {distros.length > 0 ? (
        <SearchableRow {...ROWS.newProjectsInWsl}>
          <FieldRow
            label="Start new projects in WSL"
            description="On by default. A new project's terminals run in this distribution and start in its Linux home, and Open folder… starts there too. A folder you open inside WSL gets its own distribution; a Windows folder keeps the Windows shell. Each project keeps this as its own shell on this machine, which you can change in its settings. Off, new projects use the default shell above."
            control={
              <div className="flex items-center gap-2">
                {newProjectsInWsl === true && (
                  <Select
                    aria-label="Distribution for new projects"
                    value={newProjectsWslDistro}
                    onChange={(e) => update({ newProjectsWslDistro: e.target.value })}
                  >
                    <option value="">{`Default (${wslDefault})`}</option>
                    {distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Switch
                  checked={newProjectsInWsl === true}
                  onChange={(v) => update({ newProjectsInWsl: v })}
                  ariaLabel="Start new projects in WSL"
                />
              </div>
            }
          />
        </SearchableRow>
      ) : null}
    </SettingsSection>
  )
}
