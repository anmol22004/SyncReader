import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('public/reader-assets', { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/reader-assets/pdf.worker.min.mjs');
await cp('node_modules/pdfjs-dist/cmaps', 'public/reader-assets/cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'public/reader-assets/standard_fonts', { recursive: true });
await cp('node_modules/pdfjs-dist/wasm', 'public/reader-assets/wasm', { recursive: true });
await copyFile('node_modules/pdfjs-dist/web/pdf_viewer.css', 'public/reader-assets/pdf_viewer.css');
