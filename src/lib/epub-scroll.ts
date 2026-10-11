/** The small part of EPUB.js's continuous manager used by document scrolling. */
export type DocumentScrollManager = {
  settings: { offset?: number };
  trim: () => unknown;
};

const keepChapterPlaceholders = () => Promise.resolve();

/**
 * Preserve the document's scroll geometry while native momentum scrolling runs.
 * EPUB.js's update still unloads distant iframes and their listeners. Keeping the
 * empty chapter containers avoids trim removing their height and compensating
 * with window.scrollTo(), which interrupts iPad scrolling.
 * Call only for a fullsize continuous manager, and again after viewport resize.
 */
export function stabilizeDocumentScroll(manager: DocumentScrollManager, viewportHeight: number): void {
  manager.settings.offset = Math.max(500, Number.isFinite(viewportHeight) && viewportHeight > 0 ? Math.ceil(viewportHeight * 2) : 500);
  manager.trim = keepChapterPlaceholders;
}
