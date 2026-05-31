/**
 * `@wrapdrive/design-system` — the shared design language.
 *
 * `tokens.json` is the single source of design truth, consumed by the Desktop
 * and Web apps directly through these typed bindings and by the Android app via
 * a generated Compose theme (`scripts/generate-android-theme.mjs`). Keeping one
 * token file means all three platforms render as one product.
 */

import tokensJson from './tokens.json' with { type: 'json' };

/** The raw design tokens, typed from the JSON source. */
export const tokens = tokensJson;

/** Color tokens: brand, dark/light surfaces, and status colors. */
export const color = tokens.color;

/** Spacing scale in pixels. */
export const spacing = tokens.spacing;

/** Corner-radius scale in pixels. */
export const radius = tokens.radius;

/** Typography tokens: families, sizes, weights, line heights. */
export const typography = tokens.typography;

/** Elevation/shadow tokens as CSS box-shadow strings. */
export const elevation = tokens.elevation;

/** Motion tokens: durations (ms) and easing curves. */
export const motion = tokens.motion;

/** Convenience union of the two color themes. */
export type ThemeName = 'dark' | 'light';

/** Return the surface/text color set for the given theme. */
export function themeColors(theme: ThemeName): typeof tokens.color.dark {
  return theme === 'dark' ? tokens.color.dark : tokens.color.light;
}
