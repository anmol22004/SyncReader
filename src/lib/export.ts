import type { Annotation, Book } from './types';
export function exportMarkdown(book: Pick<Book, 'title' | 'author'>, annotations: Annotation[]) {
  const escape = (s: string) => s.replace(/[\\`*_{}\[\]<>#]/g, '\\$&');
  return `# ${escape(book.title)}\n\n${book.author ? `By ${escape(book.author)}\n\n` : ''}` + annotations.filter(a => !a.deleted_at).map(a => {
    const where = a.anchor.type === 'pdf' ? `Page ${a.anchor.page}` : `EPUB location: ${a.anchor.cfi}`;
    return `## ${a.kind === 'bookmark' ? 'Bookmark' : 'Highlight'} — ${escape(where)}\n\n` +
      (a.quote ? a.quote.split('\n').map(l => `> ${escape(l)}`).join('\n') + '\n\n' : '') +
      (a.note ? `${escape(a.note)}\n\n` : '') + `Created: ${a.created_at}\n`;
  }).join('\n');
}
