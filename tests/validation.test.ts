import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { inspectBook } from '../src/server/validate-book';
import { GET } from '../src/app/api/sample/route';
async function sample() { return Buffer.from(await (await GET()).arrayBuffer()); }
async function changedChapter(content: string, extensionless = false) {
  const zip = await JSZip.loadAsync(await sample());
  if (extensionless) { let opf = await zip.file('OEBPS/book.opf')!.async('string'); opf = opf.replace('chapter0.xhtml', 'chapter0'); zip.file('OEBPS/book.opf',opf); zip.remove('OEBPS/chapter0.xhtml'); zip.file('OEBPS/chapter0',content); }
  else zip.file('OEBPS/chapter0.xhtml',content);
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('sample EPUB validates and metadata is extracted', async () => { const b = await inspectBook(await sample(),'epub','sample.epub'); assert.equal(b.title,'The Art of Slowing Down'); assert.equal(b.author,'Folio'); assert.match(b.sha256,/^[a-f0-9]{64}$/); });
test('identical bytes produce identical file identities', async () => { const bytes = await sample(); const a = await inspectBook(bytes,'epub','a.epub'); const b = await inspectBook(bytes,'epub','renamed.epub'); assert.equal(a.sha256,b.sha256); });
test('PDF metadata and page count come from parsed bytes', async () => { const p = await PDFDocument.create(); p.addPage(); p.addPage(); p.setTitle('A PDF'); p.setAuthor('An author'); const b = await inspectBook(Buffer.from(await p.save()),'pdf','file.pdf'); assert.equal(b.pageCount,2); assert.equal(b.title,'A PDF'); assert.equal(b.author,'An author'); });
test('mislabelled PDF and malformed EPUB are rejected', async () => { await assert.rejects(inspectBook(Buffer.from('not a pdf'),'pdf','x.pdf'),/valid PDF/); await assert.rejects(inspectBook(Buffer.from('not a zip'),'epub','x.epub'),/valid ZIP/); });
test('EPUB scripts, event attributes, namespace scripts and remote images are rejected', async () => {
  for (const body of ['<script>alert(1)</script>','<p onclick="alert(1)">Hi</p>','<svg xmlns:x="urn:x"><x:script>alert(1)</x:script></svg>','<img src="https://tracker.example/pixel"/>','<meta http-equiv="refresh" content="0;url=https://tracker.example"/>']) {
    const bytes = await changedChapter(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`); await assert.rejects(inspectBook(bytes,'epub','x.epub'),/active|unsafe|external/);
  }
});
test('extensionless XHTML cannot bypass active-content validation', async () => { const bytes = await changedChapter('<html><body><script>bad()</script></body></html>',true); await assert.rejects(inspectBook(bytes,'epub','x.epub'),/active/); });
test('CSS escapes and alternate remote image syntax are rejected', async () => {
  for (const style of ['body{background:url(https://tracker.example/p)}','body{background:url(\\68 ttps://tracker.example/p)}','@import "remote.css";','body{background:image-set("https://tracker.example/p" 1x)}']) {
    const bytes = await changedChapter(`<html><head><style>${style}</style></head><body><p>Hi</p></body></html>`); await assert.rejects(inspectBook(bytes,'epub','x.epub'),/external|imported/);
  }
});
test('unsafe ZIP paths are rejected before content parsing', async () => { const z = await JSZip.loadAsync(await sample()); z.file('../outside.xhtml','<html/>'); await assert.rejects(inspectBook(await z.generateAsync({type:'nodebuffer'}),'epub','x.epub'),/Unsafe EPUB archive path/); });
test('encrypted EPUBs are explicitly rejected', async () => { const z = await JSZip.loadAsync(await sample()); z.file('META-INF/encryption.xml','<encryption/>'); await assert.rejects(inspectBook(await z.generateAsync({type:'nodebuffer'}),'epub','x.epub'),/Encrypted EPUBs/); });
