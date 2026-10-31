/**
 * Four cyberpunk-academic slide themes.
 * Colors are kept restrained for classroom readability — dark bases with a
 * single vivid accent, high-contrast body text, no glow in the exported file.
 */

export interface SlideTheme {
  id: string;
  name: string;
  description: string;
  /** Background fill for body slides */
  background: string;
  /** Background fill for title/section slides */
  titleBackground: string;
  /** Accent (heading, rule, bullets) */
  accent: string;
  /** Secondary accent for labels */
  accentSecondary: string;
  /** Primary body text */
  textPrimary: string;
  /** Muted/secondary text */
  textSecondary: string;
  /** Thin decorative rule under title */
  rule: string;
  /** Font families — must be safe fallbacks in PowerPoint */
  fontHeading: string;
  fontBody: string;
  fontMono: string;
}

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: 'midnight_terminal',
    name: 'Midnight Terminal',
    description: 'Deep navy base with cyan accent — the Teach Assist signature.',
    background: '050A14',
    titleBackground: '0A1628',
    accent: '22D3EE',
    accentSecondary: 'A855F7',
    textPrimary: 'E0E6F0',
    textSecondary: '94A3B8',
    rule: '22D3EE',
    fontHeading: 'Rajdhani',
    fontBody: 'Inter',
    fontMono: 'Consolas',
  },
  {
    id: 'chalk_grid',
    name: 'Chalk Grid',
    description: 'Near-black slate with soft green accent — classroom-whiteboard inspired.',
    background: '0D1117',
    titleBackground: '161B22',
    accent: '22C55E',
    accentSecondary: 'F59E0B',
    textPrimary: 'E6EDF3',
    textSecondary: '8B949E',
    rule: '22C55E',
    fontHeading: 'Rajdhani',
    fontBody: 'Inter',
    fontMono: 'Consolas',
  },
  {
    id: 'ember_circuit',
    name: 'Ember Circuit',
    description: 'Warm charcoal with amber accent — analogue, tactile feel.',
    background: '1A1411',
    titleBackground: '241A15',
    accent: 'F59E0B',
    accentSecondary: '22D3EE',
    textPrimary: 'F5EFE8',
    textSecondary: 'BAA898',
    rule: 'F59E0B',
    fontHeading: 'Rajdhani',
    fontBody: 'Inter',
    fontMono: 'Consolas',
  },
  {
    id: 'paper_mono',
    name: 'Paper Mono',
    description: 'Bright ivory base for well-lit rooms — high-contrast academic.',
    background: 'F8F5EE',
    titleBackground: 'EEEAE0',
    accent: '0F4C81',
    accentSecondary: 'B8336A',
    textPrimary: '1A1A1A',
    textSecondary: '4A4A4A',
    rule: '0F4C81',
    fontHeading: 'Rajdhani',
    fontBody: 'Inter',
    fontMono: 'Consolas',
  },
];

export function getTheme(id: string): SlideTheme {
  return SLIDE_THEMES.find((t) => t.id === id) ?? SLIDE_THEMES[0];
}
