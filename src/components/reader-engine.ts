import type { Anchor, Location, SearchResult } from '@/lib/types';
export type Selection = { anchor: Anchor; quote: string };
export type TocItem = { label: string; depth?: number; href?: string; page?: number };
export interface ReaderHandle {
  next(): void;
  previous(): void;
  restore(location: Location): Promise<void>;
  jump(anchor: Anchor): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
  goTo(target: TocItem): Promise<void>;
}
