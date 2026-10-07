/** `init --host copilot-cli` refuses a Copilot CLI that is missing or older than the one whose workflows and extensions the install was proven on. */
import { OperationRefusal } from '../../../src/shared/OperationRefusal.ts';

/** Spike #229 proved `copilot workflow run` and project extensions without `--experimental` on this version. */
export const MINIMUM_COPILOT_CLI_VERSION = '1.0.92';

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

function versionNumbersOf(text: string): readonly number[] | null {
  const match = VERSION_PATTERN.exec(text);
  return match === null ? null : match.slice(1).map(Number);
}

function versionIsAtLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const part = version[i] ?? 0;
    const minimumPart = minimum[i] ?? 0;
    if (part !== minimumPart) return part > minimumPart;
  }
  return true;
}

/** Fails closed: output naming no version reads as a Copilot CLI too old to trust. */
export function requireCopilotCliVersion(versionOutput: string | null): void {
  const minimum = versionNumbersOf(MINIMUM_COPILOT_CLI_VERSION) ?? [];
  const installGuidance = `agent-progress init --host copilot-cli needs Copilot CLI ${MINIMUM_COPILOT_CLI_VERSION} or newer`;
  if (versionOutput === null) {
    throw new OperationRefusal(
      'refused',
      `${installGuidance}, and \`copilot --version\` could not be run. Install it, or put it on the PATH, and run init again. Nothing was written.`,
    );
  }
  const version = versionNumbersOf(versionOutput);
  if (version !== null && versionIsAtLeast(version, minimum)) return;
  const found = version === null ? `\`copilot --version\` printed no version (${versionOutput.trim()})` : `this one is ${version.join('.')}`;
  throw new OperationRefusal('refused', `${installGuidance}, and ${found}. Run \`copilot update\`, then init again. Nothing was written.`);
}
