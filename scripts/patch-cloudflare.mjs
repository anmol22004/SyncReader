import { readFile, writeFile } from 'node:fs/promises';
const path = 'node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/load-manifest.js';
const original = '**/{*-manifest,required-server-files,prefetch-hints}.json';
const fixed = '**/{*-manifest,required-server-files,prefetch-hints,preview-props}.json';
let content;
try { content = await readFile(path, 'utf8'); }
catch { console.error('Install Cloudflare tools with npm run setup:cloudflare.'); process.exit(1); }
if (content.includes(fixed)) console.log('Cloudflare preview manifest patch already applied.');
else if (content.includes(original)) {
 await writeFile(path, content.replace(original, fixed));
 console.log('Patched Cloudflare adapter to include the Next.js preview manifest.');
} else if (content.includes('preview-props')) console.log('Adapter already includes preview manifest support.');
else {
 console.error('Adapter manifest loader changed. Review this compatibility patch before building.'); process.exit(1);
}
