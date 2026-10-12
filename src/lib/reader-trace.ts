const eventNames = new Set([
  'start', 'capture', 'close', 'sample', 'viewport', 'visibility', 'error',
  'display', 'resize', 'clear', 'manager-scroll', 'window-scroll', 'relocated',
  'view-create', 'view-load', 'view-destroy', 'view-resize', 'view-resized',
  'touch-start', 'touch-move', 'touch-end', 'frame-scroll', 'selection',
  'appearance', 'index-start', 'index-end', 'count-start', 'count-section', 'count-end',
]);
const fields = new Set([
  'x', 'y', 'dx', 'dy', 'width', 'height', 'beforeHeight', 'top', 'bottom',
  'windowY', 'containerY', 'innerHeight', 'visualHeight', 'visualTop', 'scale',
  'chapter', 'firstChapter', 'firstTop', 'firstHeight', 'views', 'frames',
  'anchor', 'progress', 'touches', 'frameY', 'documentHeight', 'method', 'silent',
  'documentScroll', 'visible', 'valid', 'collapsed', 'ranges', 'line', 'column',
  'fontSize', 'lineHeight', 'margins', 'bold', 'justify', 'letterSpacing', 'wordSpacing',
]);
type Entry = { ms: number; event: string; data: Record<string, number | boolean | null> };
export type TraceMeta = { build: string; builtAt: string; userAgent: string };

export function readerTraceEnabled(search: string) {
  return new URLSearchParams(search).get('readerDebug') === '1';
}

/** Compare anchors without exporting chapter paths, element IDs, or book text. */
export function anchorFingerprint(value: unknown) {
  if (typeof value !== 'string') return null;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Memory-only bounded trace. No network, storage, DOM text, or free-form errors. */
export class ReaderTrace {
  private entries: Entry[] = [];
  private total = 0;
  private origin: number;
  private stopped = false;
  readonly capacity: number;
  readonly meta: TraceMeta;
  constructor(meta: TraceMeta, capacity = 2000, private clock = () => performance.now()) {
    this.capacity = Math.max(1, Math.min(4000, Math.floor(capacity) || 2000));
    this.meta = { build: meta.build.slice(0, 80), builtAt: meta.builtAt.slice(0, 40), userAgent: meta.userAgent.slice(0, 300) };
    this.origin = clock();
    this.record('start');
  }
  get recording() { return !this.stopped; }
  record(event: string, values: Record<string, unknown> = {}) {
    if (this.stopped || !eventNames.has(event)) return;
    const data: Entry['data'] = {};
    for (const [key, value] of Object.entries(values)) {
      if (!fields.has(key)) continue;
      if (typeof value === 'number' && Number.isFinite(value)) data[key] = Math.round(value * 100) / 100;
      else if (typeof value === 'boolean' || value === null) data[key] = value;
    }
    this.entries[this.total % this.capacity] = { ms: Math.round(this.clock() - this.origin), event, data };
    this.total++;
  }
  capture() { this.record('capture'); this.stopped = true; }
  restart() { this.entries = []; this.total = 0; this.origin = this.clock(); this.stopped = false; this.record('start'); }
  snapshot() {
    const start = this.total >= this.capacity ? this.total % this.capacity : 0;
    const entries = this.entries.slice(start).concat(this.entries.slice(0, start));
    return { schema: 1, ...this.meta, recording: this.recording, dropped: Math.max(0, this.total - this.capacity), entries };
  }
  json() { return JSON.stringify(this.snapshot(), null, 2); }
}
