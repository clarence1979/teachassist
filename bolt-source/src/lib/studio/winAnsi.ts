/**
 * Text sanitiser used across PDF builders.
 *
 * PDFs now embed DejaVu Sans via @pdf-lib/fontkit (see unicodeFonts.ts), which
 * supports the full Unicode math/symbol range. We only strip control
 * characters that would corrupt PDF text objects.
 */

export function winAnsiSafe(input: string): string {
  if (!input) return '';
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
