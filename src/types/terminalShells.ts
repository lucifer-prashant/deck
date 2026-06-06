/**
 * Terminal Shell Type System
 * Single source of truth for shell identifiers, display labels, icons, and path hints.
 * Main process consumes this for spawn resolution; renderer consumes it for UI display.
 */

export type TerminalShellType = 'powershell' | 'cmd' | 'wsl' | 'gitbash' | 'custom';

/**
 * The value stored in prefs for the "Default Terminal Shell" setting.
 * 'remember_last' is the sentinel meaning "use lastSpawnedShellType from the workspace store."
 */
export type DefaultShellSetting = TerminalShellType | 'remember_last';

export interface ShellConfig {
  /** Stable type key — store and compare against this, never a raw path */
  type: TerminalShellType;
  /** Human-readable label for dropdowns and the panel header pill */
  label: string;
  /** Tabler CSS icon class, e.g. 'ti ti-brand-powershell' */
  icon: string;
  /**
   * True if this shell is Windows-only.
   * getShellOptions() uses this to filter the UI list on Linux/macOS.
   */
  windowsOnly: boolean;
  /**
   * Executable hint passed to main process at spawn time.
   * PATH-resident shells (powershell, cmd, wsl) → bare exe name is sufficient.
   * Non-PATH shells (gitbash) → full default install path as a fallback hint.
   * custom → always null; resolved entirely from the user's custom path input.
   */
  defaultPath: string | null;
}

export const SHELL_CONFIGS: Record<TerminalShellType, ShellConfig> = {
  powershell: {
    type:        'powershell',
    label:       'PowerShell',
    icon:        'ti ti-brand-powershell',
    windowsOnly: true,
    defaultPath: 'powershell.exe',
  },
  cmd: {
    type:        'cmd',
    label:       'Command Prompt',
    icon:        'ti ti-brand-windows',
    windowsOnly: true,
    defaultPath: 'cmd.exe',
  },
  wsl: {
    type:        'wsl',
    label:       'WSL',
    icon:        'ti ti-brand-ubuntu',
    windowsOnly: true,
    defaultPath: 'wsl.exe',
  },
  gitbash: {
    type:        'gitbash',
    label:       'Git Bash',
    icon:        'ti ti-brand-git',
    windowsOnly: true,
    defaultPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
  },
  custom: {
    type:        'custom',
    label:       'Custom Path',
    icon:        'ti ti-terminal-2',
    windowsOnly: false,
    defaultPath: null,
  },
};

/**
 * Returns shells in display order, filtered by platform.
 * Pass process.platform from wherever it is available (main.ts or preload contextBridge).
 */
export function getShellOptions(platform: string): ShellConfig[] {
  const order: TerminalShellType[] = ['powershell', 'cmd', 'wsl', 'gitbash', 'custom'];
  return order
    .map(t => SHELL_CONFIGS[t])
    .filter(s => !s.windowsOnly || platform === 'win32');
}

/** System default when no shell type has been set yet. */
export const DEFAULT_SHELL_TYPE: TerminalShellType = 'powershell';
