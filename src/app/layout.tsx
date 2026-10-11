import type { Metadata } from 'next';
import 'pdfjs-dist/web/pdf_viewer.css';
import './globals.css';
export const metadata: Metadata = { title: 'Folio — Your reading, everywhere', description: 'A private home for your PDF and EPUB books. Pick up where you left off.' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><head><link rel="stylesheet" href="/reader-assets/reader-fonts.css" /></head><body>{children}</body></html>; }
