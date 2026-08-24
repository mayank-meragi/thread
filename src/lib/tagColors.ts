/**
 * Tags store a per-tag hex color that renders theme-independently (as an
 * inline swatch and <input type="color"> value), so it can't be a CSS custom
 * property. This is the single named default new/legacy tags fall back to,
 * replacing the previously hardcoded '#5f7864' literal duplicated across the
 * schema editor.
 */
export const DEFAULT_TAG_COLOR = '#5f7864'
