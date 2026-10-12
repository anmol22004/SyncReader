import type { Preferences } from './types';
import { fontFor, presetFor } from './reading-preferences';

const applied = new WeakMap<Document, string>();

// Publisher px/pt sizes (including inline !important) must not lock reader text.
// Keep the DOM intact so EPUB CFIs and saved highlights remain valid.
export function applyEpubAppearance(document: Document, p: Preferences, documentScroll: boolean) {
  const body = document.body; if (!body) return;
  const key = `${documentScroll}:${JSON.stringify(p)}`;
  if (applied.get(document) === key) return;
  const palette = presetFor(p); const font = fontFor(p);
  let style = document.getElementById('folio-reading-style') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'folio-reading-style'; document.head.appendChild(style); }
  // Replace one stylesheet rather than appending duplicate rules on every edit.
  style.textContent = `
    body { color:${palette.color}!important; background:${palette.background}!important; line-height:${p.lineHeight}!important;
      padding:${documentScroll ? '88px' : '92px'} min(${p.margins}px,12vw) ${documentScroll ? '80px' : '16px'}!important;
      margin:0 auto!important; max-width:860px!important; box-sizing:border-box!important;
      overflow-wrap:anywhere; overflow-anchor:none; font-weight:${p.bold ? 700 : 400}!important;
      letter-spacing:${p.letterSpacing}em!important; word-spacing:${p.wordSpacing}em!important;
      text-align:${p.justify ? 'justify' : 'start'}!important; }
    p,li,blockquote { font-weight:${p.bold ? 700 : 400}!important; line-height:${p.lineHeight}!important;
      letter-spacing:${p.letterSpacing}em!important; word-spacing:${p.wordSpacing}em!important;
      text-align:${p.justify ? 'justify' : 'start'}!important; }
    a { color:#65876c; } img,svg,video { max-width:100%!important; height:auto!important; }
    pre { white-space:pre-wrap!important; } table { max-width:100%!important; }
    h1,h2,h3,h4,h5,h6 { line-height:1.3!important; }
  `;
  document.documentElement.style.setProperty('font-size', `${p.fontSize}px`, 'important');
  body.style.setProperty('font-size', `${p.fontSize}px`, 'important');
  body.style.setProperty('font-family', font, 'important');
  const relative: Record<string, string> = { H1:'1.8em', H2:'1.5em', H3:'1.25em', H4:'1.125em', H5:'1em', H6:'.9em', SUP:'.75em', SUB:'.75em', SMALL:'.85em' };
  for (const element of body.querySelectorAll<HTMLElement>('*')) {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
    element.style.setProperty('font-size', relative[element.tagName.toUpperCase()] || 'inherit', 'important');
    element.style.setProperty('font-family', font, 'important');
  }
  applied.set(document, key);
}
