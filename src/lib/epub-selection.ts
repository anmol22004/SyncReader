export type SelectionContents = {
  document: Document;
  cfiFromRange(range: Range): string;
};

/** Read the actual displayed HTML range, not the book's separately parsed XML. */
export function readEpubSelection(contents: SelectionContents) {
  const selected = contents.document.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return null;
  const range = selected.getRangeAt(0);
  if (range.collapsed || range.startContainer.ownerDocument !== contents.document || range.endContainer.ownerDocument !== contents.document) return null;
  const quote = range.toString().trim();
  if (!quote) return null;
  // EPUB.js interprets element child offsets as character offsets. Convert
  // those boundaries on a clone; never disturb native selection handles.
  let anchorRange = range;
  if (range.startContainer.nodeType === 1 || range.endContainer.nodeType === 1) {
    const walker = contents.document.createTreeWalker(range.commonAncestorContainer, 4 /* SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.length && range.intersectsNode(node)) nodes.push(node as Text);
    }
    if (!nodes.length) return null;
    anchorRange = range.cloneRange();
    if (range.startContainer.nodeType === 1) anchorRange.setStart(nodes[0], 0);
    if (range.endContainer.nodeType === 1) anchorRange.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].length);
  }
  return { anchor: { type: 'epub' as const, cfi: contents.cfiFromRange(anchorRange) }, quote: quote.slice(0, 20000) };
}

/** Parent-window fallback: WebKit can suppress listeners in sandboxed srcdoc frames.
 * Compare range boundaries before generating a CFI or updating React state.
 */
export function createSelectionObserver(onChange: (value: ReturnType<typeof readEpubSelection>) => void) {
  let previous: { document: Document; start: Node; end: Node; from: number; to: number } | null = null;
  return (contents: SelectionContents[]) => {
    for (const content of contents) {
      try {
        const selection = content.document.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) continue;
        const range = selection.getRangeAt(0);
        if (previous?.document === content.document && previous.start === range.startContainer && previous.end === range.endContainer && previous.from === range.startOffset && previous.to === range.endOffset) return;
        const value = readEpubSelection(content);
        if (!value) continue;
        previous = { document: content.document, start: range.startContainer, end: range.endContainer, from: range.startOffset, to: range.endOffset };
        onChange(value);
        return;
      } catch { /* A chapter may be unloading during the sample. */ }
    }
    if (previous) { previous = null; onChange(null); }
  };
}
