import { spawnSync } from 'node:child_process';
import { copyFile, access } from 'node:fs/promises';
// npm.cmd is a batch file on Windows. These arguments are fixed, with no user input.
const installed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--save-dev', '@opennextjs/cloudflare@latest', 'wrangler@latest'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (installed.status !== 0) process.exit(installed.status || 1);
try { await access('open-next.config.ts'); }
catch { await copyFile('cloudflare/open-next.config.ts.example', 'open-next.config.ts'); }
console.log('Cloudflare tools installed and configuration ready. Follow outputs/CLOUDFLARE.md.');
