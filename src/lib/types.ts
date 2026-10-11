export type Format = 'pdf' | 'epub';
export type Location =
  | { version: 1; type: 'epub'; cfi: string; href: string; spineIndex: number; progression: number }
  | { version: 1; type: 'pdf'; page: number; x: number; y: number; progression: number };
export type Book = {
  id: string; user_id: string; title: string; author: string | null; format: Format;
  original_filename: string; byte_size: number; sha256: string | null;
  cover_path: string | null; page_count: number | null;
  status: 'uploading' | 'validating' | 'ready' | 'failed' | 'deleting';
  created_at: string; failure_code?: string | null;
};
export type Progress = {
  book_id: string; user_id: string; location: Location | null;
  revision: number; progression: number; last_read_at: string | null; completed_at: string | null;
};
export type Anchor = { type: 'epub'; cfi: string; href?: string }
  | { type: 'pdf'; page: number; rects: number[][]; x?: number; y?: number };
export type Annotation = {
  id: string; user_id: string; book_id: string; kind: 'bookmark' | 'highlight';
  anchor: Anchor; quote: string | null; note: string | null; color: string;
  revision: number; created_at: string; updated_at: string; deleted_at: string | null;
};
export type Preferences = { theme: 'light' | 'dark' | 'sepia'; font: 'serif' | 'sans-serif'; fontSize: number; lineHeight: number };
export const DEFAULT_PREFERENCES: Preferences = { theme: 'light', font: 'serif', fontSize: 19, lineHeight: 1.7 };
export type Operation = {
  operationId: string; sessionId: string; sequence: number; expectedRevision: number;
  location: Location;
};
export type SaveResult = { outcome: 'accepted' | 'conflict' | 'stale'; progress: Progress };
export type Pending = { key: string; userId: string; bookId: string; operation: Operation; latestLocation?: Location; savedAt: string };
export type SearchResult = { label: string; excerpt: string; location: Location };
