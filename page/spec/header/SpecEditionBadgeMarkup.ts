import { HtmlEscapeUtil } from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';

/** `spec-kit <version> · constitution v<version>`, each part left out when its version is unknown, and null when both are. */
export function specEditionBadgeMarkup(specKitVersion: string | null, constitutionVersion: string | null): string | null {
  const parts = [
    ...(specKitVersion === null ? [] : [`spec-kit <b>${HtmlEscapeUtil.escapeHtml(specKitVersion)}</b>`]),
    ...(constitutionVersion === null ? [] : [`constitution <b>v${HtmlEscapeUtil.escapeHtml(constitutionVersion)}</b>`]),
  ];
  return parts.length === 0 ? null : parts.join(' · ');
}
