import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
const require = createRequire(import.meta.url);
// Use Next's production environment loading order; never print credential values.
require('@next/env').loadEnvConfig(process.cwd(), false);
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
 console.error('Cloud build stopped. Configure these in .env.local or build variables: ' + missing.join(', ')); process.exit(1);
}
try { const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL); if (url.protocol !== 'https:') throw new Error(); }
catch { console.error('NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL.'); process.exit(1); }
try { await access('node_modules/@opennextjs/cloudflare/package.json'); await access('open-next.config.ts'); }
catch { console.error('Run npm run setup:cloudflare before building.'); process.exit(1); }
console.log('Cloud build configuration checked. Runtime secrets must also be set in Cloudflare.');
