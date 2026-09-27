const MACOS_OPENER = 'open';

const OTHER_OPENER = 'xdg-open';

const MACOS_PLATFORM = 'darwin';

function openerFor(platform: string): string {
  return platform === MACOS_PLATFORM ? MACOS_OPENER : OTHER_OPENER;
}

export const OpenerUtil = { openerFor } as const;
