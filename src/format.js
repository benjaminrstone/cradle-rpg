// Number formatting shared by the engine's text and the UI.
export const fmt = (n) => (Math.round(n * 10) / 10).toString();
export const pct = (p) => `${Math.round(p * 100)}%`;
