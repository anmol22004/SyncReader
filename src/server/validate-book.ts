import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { xml2js, type Element } from 'xml-js';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export type Inspected = { title: string; author: string | null; pageCount: number | null; sha256: string; cover: Buffer | null; coverMime: string | null };
const localName = (name = '') => name.toLowerCase().split(':').at(-1)!;
function walk(root: Element): Element[] {
  const nodes: Element[] = [];
  const visit = (node: Element) => { if (node.type === 'element') nodes.push(node); for (const child of node.elements || []) visit(child); };
  visit(root); return nodes;
}
function textOf(node?: Element): string { return node ? (node.elements || []).map(e => e.text ?? e.cdata ?? textOf(e)).join('').trim() : ''; }
function parseXML(text: string): Element {
  if (/<!ENTITY|<!DOCTYPE[^>]+(?:SYSTEM|PUBLIC)/i.test(text)) throw new Error('EPUB XML entities and external document types are unsupported.');
  try { return xml2js(text, { compact: false, ignoreComment: true, ignoreDeclaration: true }) as Element; }
  catch { throw new Error('This EPUB contains malformed XML or non-XHTML content.'); }
}
function unsafeUrl(value: string) {
  const v = value.replace(/[\u0000-\u0020]/g, '');
  return /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(v) && !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(v);
}
function validateCss(css: string) {
  const decoded = css.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\([^\n])/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@import|image-set\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(decoded)) throw new Error('This EPUB contains unsupported active or imported styles.');
  for (const m of decoded.matchAll(/url\s*\(\s*['"]?([^)'"\s]+)/gi)) if (unsafeUrl(m[1])) throw new Error('This EPUB loads external resources. Use a self-contained EPUB.');
}
function validateDocument(text: string) {
  const nodes = walk(parseXML(text));
  for (const node of nodes) {
    const tag = localName(node.name);
    if (['script','iframe','object','embed','form','foreignobject','base','animate','animatetransform','set'].includes(tag)) throw new Error('This EPUB contains unsupported active content.');
    for (const [rawAttr, rawValue] of Object.entries(node.attributes || {})) {
      const attr = rawAttr.toLowerCase(), value = String(rawValue);
      if (/^on/i.test(localName(attr)) || ['srcdoc','srcset','xml:base','background'].includes(attr) || (tag === 'meta' && attr === 'http-equiv' && /refresh/i.test(value))) throw new Error('This EPUB contains unsupported active attributes.');
      if (attr === 'style') validateCss(value);
      if (['src','href','xlink:href','poster','data'].includes(attr) && unsafeUrl(value)) {
        if (tag === 'a' && /^https?:\/\//i.test(value)) continue;
        throw new Error('This EPUB contains external or unsafe resources.');
      }
    }
    if (tag === 'style') validateCss(textOf(node));
  }
}
export async function inspectBook(bytes: Buffer, format: 'epub' | 'pdf', filename: string): Promise<Inspected> {
  if (!bytes.length || bytes.length > MAX_FILE_SIZE) throw new Error('Books must be between 1 byte and 50 MiB.');
  const result: Inspected = { title: filename.replace(/\.(epub|pdf)$/i, ''), author: null, pageCount: null, sha256: createHash('sha256').update(bytes).digest('hex'), cover: null, coverMime: null };
  if (format === 'pdf') {
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Not a valid PDF.');
    let pdf;
    try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch { throw new Error('This PDF is damaged or password protected.'); }
    result.pageCount = pdf.getPageCount();
    if (!result.pageCount || result.pageCount > 10000) throw new Error('This PDF has an unsupported page count.');
    result.title = (pdf.getTitle()?.trim() || result.title).slice(0, 500);
    result.author = pdf.getAuthor()?.trim().slice(0, 500) || null;
    return result;
  }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('This EPUB is not a valid ZIP archive.'); }
  const entries = Object.values(zip.files);
  if (entries.length > 5000) throw new Error('This EPUB contains too many archive entries.');
  let expanded = 0;
  for (const e of entries) {
    const internal = e as unknown as { _data?: { uncompressedSize?: number }; unsafeOriginalName?: string };
    const name = internal.unsafeOriginalName || e.name;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('Unsafe EPUB archive path.');
    const size = internal._data?.uncompressedSize || 0; expanded += size;
    if (size > 25 * 1024 * 1024 || expanded > 150 * 1024 * 1024) throw new Error('This EPUB expands beyond the supported size.');
  }
  if ((await zip.file('mimetype')?.async('string'))?.trim() !== 'application/epub+zip') throw new Error('Not a valid EPUB.');
  if (zip.file('META-INF/encryption.xml')) throw new Error('Encrypted EPUBs and obfuscated fonts are not supported yet.');
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB container is missing.');
  const opfPath = walk(parseXML(container)).find(n => localName(n.name) === 'rootfile')?.attributes?.['full-path'];
  if (typeof opfPath !== 'string') throw new Error('EPUB package is missing.');
  const opf = await zip.file(opfPath)?.async('string');
  if (!opf) throw new Error('EPUB package could not be opened.');
  const packageNodes = walk(parseXML(opf));
  const spine = packageNodes.find(n => localName(n.name) === 'spine');
  const spineItems = spine?.elements?.filter(n => localName(n.name) === 'itemref') || [];
  if (!spineItems.length) throw new Error('EPUB has no reading content.');
  const metadata = packageNodes.find(n => localName(n.name) === 'metadata');
  const metadataNodes = metadata ? walk(metadata) : [];
  result.title = textOf(metadataNodes.find(n => localName(n.name) === 'title')) || result.title;
  result.author = textOf(metadataNodes.find(n => localName(n.name) === 'creator')) || null;
  const manifest = packageNodes.find(n => localName(n.name) === 'manifest');
  const items = manifest?.elements?.filter(n => localName(n.name) === 'item') || [];
  const contentKinds = new Map<string, 'xml' | 'css'>([[opfPath,'xml'],['META-INF/container.xml','xml']]);
  for (const item of items) {
    const href = item.attributes?.href, mime = String(item.attributes?.['media-type'] || '');
    if (typeof href !== 'string' || unsafeUrl(href)) throw new Error('EPUB manifest contains an unsafe resource.');
    const resourcePath = path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), decodeURIComponent(href.split('#')[0])));
    if (resourcePath.startsWith('../') || !zip.file(resourcePath)) throw new Error('EPUB contains a missing resource.');
    if (/css/i.test(mime)) contentKinds.set(resourcePath, 'css');
    else if (/(?:html|xml|svg)/i.test(mime)) contentKinds.set(resourcePath, 'xml');
    if (/javascript/i.test(mime)) throw new Error('Scripted EPUBs are unsupported.');
  }
  for (const spineItem of spineItems) {
    const item = items.find(n => n.attributes?.id === spineItem.attributes?.idref);
    if (!item || item.attributes?.['media-type'] !== 'application/xhtml+xml') throw new Error('This reader supports XHTML EPUB chapters only.');
  }
  for (const e of entries) {
    if (e.dir) continue;
    const kind = contentKinds.get(e.name);
    if (kind === 'css' || /\.css$/i.test(e.name)) validateCss(await e.async('string'));
    else if (kind === 'xml' || /\.(?:xhtml|html|htm|svg|xml|opf|ncx)$/i.test(e.name)) validateDocument(await e.async('string'));
    else if (/\.(js|mjs)$/i.test(e.name)) throw new Error('Scripted EPUBs are unsupported.');
  }
  const coverId = metadataNodes.find(n => localName(n.name) === 'meta' && n.attributes?.name === 'cover')?.attributes?.content;
  const coverItem = items.find(n => String(n.attributes?.properties || '').split(/\s+/).includes('cover-image') || Boolean(coverId && n.attributes?.id === coverId));
  const mime = coverItem?.attributes?.['media-type'], href = coverItem?.attributes?.href;
  if (typeof href === 'string' && typeof mime === 'string' && ['image/png','image/jpeg','image/webp'].includes(mime)) {
    const entry = zip.file(path.posix.join(path.posix.dirname(opfPath), decodeURIComponent(href)));
    if (entry) { const image = await entry.async('nodebuffer'); if (image.length <= 2 * 1024 * 1024) { result.cover = image; result.coverMime = mime; } }
  }
  result.title = result.title.slice(0, 500); result.author = result.author?.slice(0, 500) || null;
  return result;
}
