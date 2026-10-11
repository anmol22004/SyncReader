import { DEFAULT_PREFERENCES, type Preferences } from './types';

export const FONT_OPTIONS: { value: Preferences['font']; label: string; css: string }[] = [
  { value: 'serif', label: 'Book serif', css: 'Georgia, "Times New Roman", serif' },
  { value: 'sans-serif', label: 'System sans', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { value: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { value: 'palatino', label: 'Palatino', css: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { value: 'times', label: 'Times', css: '"Times New Roman", Times, serif' },
  { value: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { value: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif' }
];
export const READING_PRESETS: { id: Preferences['preset']; label: string; background: string; color: string; values: Partial<Preferences> }[] = [
  { id: 'original', label: 'Original', background: '#fffef9', color: '#30372f', values: { theme: 'light', font: 'serif', bold: false, lineHeight: 1.7, letterSpacing: 0, wordSpacing: 0, margins: 24, justify: false } },
  { id: 'quiet', label: 'Quiet', background: '#202723', color: '#dddcd4', values: { theme: 'dark', font: 'sans-serif', bold: false, lineHeight: 1.7, letterSpacing: 0, wordSpacing: 0, margins: 24, justify: false } },
  { id: 'paper', label: 'Paper', background: '#faf4e7', color: '#443c30', values: { theme: 'sepia', font: 'georgia', bold: false, lineHeight: 1.65, letterSpacing: 0, wordSpacing: 0, margins: 28, justify: false } },
  { id: 'bold', label: 'Bold', background: '#ffffff', color: '#171d18', values: { theme: 'light', font: 'sans-serif', bold: true, lineHeight: 1.65, letterSpacing: 0, wordSpacing: 0, margins: 24, justify: false } },
  { id: 'calm', label: 'Calm', background: '#f3ead8', color: '#493c29', values: { theme: 'sepia', font: 'sans-serif', bold: false, lineHeight: 1.8, letterSpacing: .01, wordSpacing: .04, margins: 32, justify: false } },
  { id: 'focus', label: 'Focus', background: '#edf1eb', color: '#243229', values: { theme: 'light', font: 'verdana', bold: false, lineHeight: 1.9, letterSpacing: .02, wordSpacing: .08, margins: 36, justify: false } }
];
export function presetFor(p: Preferences) { return READING_PRESETS.find(t => t.id === p.preset) || READING_PRESETS[0]; }
export function fontFor(p: Preferences) { return FONT_OPTIONS.find(t => t.value === p.font)?.css || FONT_OPTIONS[0].css; }
export function applyPreset(p: Preferences, id: Preferences['preset']): Preferences {
  const preset = READING_PRESETS.find(t => t.id === id) || READING_PRESETS[0];
  return { ...p, ...preset.values, preset: preset.id };
}
export function typographyKey(p: Preferences) {
  return JSON.stringify([p.font, p.fontSize, p.lineHeight, p.bold, p.letterSpacing, p.wordSpacing, p.margins, p.justify]);
}
export function normalizePreferences(value: unknown): Preferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const p = { ...DEFAULT_PREFERENCES };
  if (['light', 'dark', 'sepia'].includes(String(v.theme))) p.theme = v.theme as Preferences['theme'];
  p.preset = READING_PRESETS.some(t => t.id === v.preset) ? v.preset as Preferences['preset'] : p.theme === 'dark' ? 'quiet' : p.theme === 'sepia' ? 'calm' : 'original';
  if (FONT_OPTIONS.some(t => t.value === v.font)) p.font = v.font as Preferences['font'];
  const numeric = (key: keyof Preferences, min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.max(min, Math.min(max, v[key] as number)) : p[key];
  p.fontSize = numeric('fontSize', 12, 40) as number;
  p.lineHeight = numeric('lineHeight', 1.2, 2.4) as number;
  p.letterSpacing = numeric('letterSpacing', -.02, .12) as number;
  p.wordSpacing = numeric('wordSpacing', 0, .5) as number;
  p.margins = numeric('margins', 12, 72) as number;
  p.brightness = numeric('brightness', 60, 110) as number;
  p.bold = typeof v.bold === 'boolean' ? v.bold : p.bold;
  p.justify = typeof v.justify === 'boolean' ? v.justify : p.justify;
  return p;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function devicePreferencesKey(userId: string) { return `folio-device-reading:v1:${userId}`; }
export function readDevicePreferences(storage: Storage, userId: string): Preferences {
  try {
    const saved = storage.getItem(devicePreferencesKey(userId));
    if (saved) return normalizePreferences(JSON.parse(saved));
    // Migrate only this browser's existing settings; never load another device's cloud preferences.
    const legacy = storage.getItem(`folio-preferences:${userId}`);
    if (legacy) {
      const p = normalizePreferences(JSON.parse(legacy));
      writeDevicePreferences(storage, userId, p); storage.removeItem(`folio-preferences:${userId}`); return p;
    }
  } catch { /* Broken or inaccessible browser storage should not prevent opening a book. */ }
  return { ...DEFAULT_PREFERENCES };
}
export function writeDevicePreferences(storage: Storage, userId: string, value: Preferences) {
  storage.setItem(devicePreferencesKey(userId), JSON.stringify(normalizePreferences(value)));
}
