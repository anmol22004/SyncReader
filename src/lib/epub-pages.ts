export type BookPages = { page: number; total: number; remaining: number };
// EPUB pages are viewport-sized portions of each rendered spine section.
// Persist CFIs, never these device-dependent page numbers.
export function bookPagePosition(counts: Record<number, number>, spineIndex: number, sectionPage: number): BookPages | null {
  const entries = Object.entries(counts).map(([index, count]) => [Number(index), count] as const).filter(([, count]) => Number.isFinite(count) && count > 0);
  const count = counts[spineIndex];
  if (!count || !Number.isFinite(sectionPage) || !entries.length) return null;
  const total = entries.reduce((sum, [, pages]) => sum + pages, 0);
  const before = entries.filter(([index]) => index < spineIndex).reduce((sum, [, pages]) => sum + pages, 0);
  const local = Math.max(1, Math.min(count, Math.floor(sectionPage)));
  return { page: before + local, total, remaining: count - local };
}
