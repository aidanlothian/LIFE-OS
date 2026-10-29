// Background colors for Deep Memory widgets and Sections. Each is a hue
// (muted to sit well on the off-white notebook theme) blended into the panel
// color at one of four strengths. Even the strongest blend keeps the normal
// dark text above 5:1 contrast, so text never has to switch to white.

export const PANEL_HEX = "#faf8f2"; // tailwind.config.ts `panel`

export const HUES = [
  { key: "red", label: "Red", hex: "#c0544a" },
  { key: "orange", label: "Orange", hex: "#d27a3f" },
  { key: "mustard", label: "Mustard", hex: "#c9971f" },
  { key: "olive", label: "Olive", hex: "#8e9a3c" },
  { key: "green", label: "Green", hex: "#5f8a5f" },
  { key: "teal", label: "Teal", hex: "#3f8c86" },
  { key: "sky", label: "Sky", hex: "#4f8fbf" },
  { key: "blue", label: "Blue", hex: "#4a68a8" },
  { key: "purple", label: "Purple", hex: "#7c5ea8" },
  { key: "pink", label: "Pink", hex: "#c0628f" },
  { key: "brown", label: "Brown", hex: "#8a6a4a" },
  { key: "gray", label: "Gray", hex: "#8c8372" },
] as const;

// Share of the hue in the blend, faintest first.
export const STRENGTHS = [
  { label: "Faint", amount: 0.12 },
  { label: "Light", amount: 0.25 },
  { label: "Medium", amount: 0.4 },
  { label: "Strong", amount: 0.55 },
] as const;

export interface SectionColor {
  hue: string;
  strength: number; // index into STRENGTHS
}

function blend(hex: string, amount: number): string {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(PANEL_HEX.slice(i, i + 2), 16));
  return `#${a
    .map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function swatchColor(hue: string, strength: number): string | null {
  const h = HUES.find((x) => x.key === hue);
  const s = STRENGTHS[strength];
  return h && s ? blend(h.hex, s.amount) : null;
}

// The box's background and a slightly deeper border to match, or null for
// no color (or a saved value that's no longer valid). `strong` is true for
// Medium/Strong, where the usual muted grey text needs darkening.
export function tintFor(color: SectionColor | undefined | null) {
  if (!color) return null;
  const h = HUES.find((x) => x.key === color.hue);
  const s = STRENGTHS[color.strength];
  if (!h || !s) return null;
  return {
    background: blend(h.hex, s.amount),
    border: blend(h.hex, Math.min(1, s.amount + 0.18)),
    strong: color.strength >= 2,
  };
}
