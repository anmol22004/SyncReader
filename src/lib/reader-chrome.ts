export type ReaderChrome = { hidden: boolean; direction: number; distance: number };
export const visibleChrome = (): ReaderChrome => ({ hidden: false, direction: 0, distance: 0 });

// Feed user gestures, not scroll offsets: EPUB chapter trimming and CFI restores
// also change offsets and must never toggle the controls.
export function readingGesture(state: ReaderChrome, delta: number): ReaderChrome {
  if (!Number.isFinite(delta) || Math.abs(delta) < 2) return state;
  const direction = Math.sign(delta);
  const distance = (direction === state.direction ? state.distance : 0) + Math.min(Math.abs(delta), 120);
  const threshold = direction > 0 ? 48 : 24;
  if (distance < threshold) return { ...state, direction, distance };
  return { hidden: direction > 0, direction, distance: 0 };
}
