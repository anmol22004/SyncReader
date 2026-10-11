import type { Location } from './types';
export function validateLocation(value: unknown, format: 'epub' | 'pdf', pages?: number | null): value is Location {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  if (l.version !== 1 || l.type !== format || typeof l.progression !== 'number' || !Number.isFinite(l.progression) || l.progression < 0 || l.progression > 1) return false;
  if (format === 'epub') return typeof l.cfi === 'string' && l.cfi.startsWith('epubcfi(') && l.cfi.endsWith(')') && l.cfi.length < 4096 && typeof l.href === 'string' && l.href.length < 2048 && Number.isInteger(l.spineIndex) && Number(l.spineIndex) >= 0;
  return Number.isInteger(l.page) && Number(l.page) >= 1 && (!pages || Number(l.page) <= pages) && ['x', 'y'].every(k => typeof l[k] === 'number' && Number.isFinite(l[k]) && Number(l[k]) >= 0 && Number(l[k]) <= 1);
}
export function locationLabel(l: Location | null) { return !l ? 'Not started' : l.type === 'pdf' ? `Page ${l.page}` : `Chapter ${l.spineIndex + 1}`; }
export function sameLocation(a: Location | null, b: Location | null) {
  if (!a || !b || a.type !== b.type) return a === b;
  return a.type === 'epub' && b.type === 'epub' ? a.cfi === b.cfi : a.type === 'pdf' && b.type === 'pdf' && a.page === b.page && Math.abs(a.y - b.y) < 0.002 && Math.abs(a.x - b.x) < 0.002;
}

/** Empty EPUB.js location indexes report zero; use section progress until indexed. */
export function epubProgress(start: { index: number; percentage?: number; displayed?: { page: number; total: number } }, sections: number, indexed: boolean): number {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  if (indexed && typeof start.percentage === 'number' && Number.isFinite(start.percentage)) return clamp(start.percentage);
  const total = Math.max(1, sections);
  const page = start.displayed;
  const within = page && page.total > 0 ? clamp((page.page - 1) / page.total) : 0;
  return clamp((Math.max(0, start.index) + within) / total);
}
