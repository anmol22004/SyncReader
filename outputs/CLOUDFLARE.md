# Put SyncReader live on Cloudflare Workers

Prepared in C:\Users\AnmolXPC\Documents\Codex\SyncReader. The site is not deployed yet.

## 1. Install deployment tools

Open PowerShell in the project folder:

```powershell
cd C:\Users\AnmolXPC\Documents\Codex\SyncReader
npm run setup:cloudflare
```

This installs OpenNext and Wrangler, updates package.json/package-lock.json, and creates open-next.config.ts from the supplied template. Keep the updated lockfile for repeatable future installs. The current session could not download these packages.

## 2. Configure Supabase locally

Copy .env.example to .env.local if you have not already done so. Fill in:

- NEXT_PUBLIC_SUPABASE_URL: your project's HTTPS URL.
- NEXT_PUBLIC_SUPABASE_ANON_KEY: the browser anon/publishable key.
- SUPABASE_SERVICE_ROLE_KEY: the privileged server-only key. Never use it for NEXT_PUBLIC_SUPABASE_ANON_KEY.
- CRON_SECRET: a long, random secret used by daily cleanup.

Keep .env.local private. Do not paste keys into this chat or commit them. No actual keys have been written into this setup guide or Wrangler configuration.

Run 001_reader.sql only for a fresh database. If already applied, do not rerun it. Apply supabase/migrations/002_storage_retention.sql if you have not done so. Confirm the books and covers buckets are private and RLS is enabled.

## 3. Check the app in the Workers runtime

```powershell
npm run typecheck
npm test
npm run preview:cloudflare
```

Use the local address printed by the preview. For magic-link login, allow that exact origin in Supabase Authentication > URL Configuration > Redirect URLs. Test a small PDF and EPUB, reader controls, bookmark/highlight creation, and deleting a book before publishing. Preview does not run the scheduled trigger by default.

Workers have a 128 MB memory limit and CPU limits. The existing validator buffers and parses book files; the app's 50 MiB limit is not a guarantee that a large or complex document fits Workers. Start with small books and watch upload-finalization errors and CPU/memory logs. A larger-file validation service may be needed. No CPU allowance or paid plan is configured automatically.

## 4. Sign into Cloudflare and create the Worker secrets

```powershell
npx wrangler login
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CRON_SECRET
```

Each secret command prompts for its value. Use the same values as .env.local. If Wrangler offers to create the missing sync-reader Worker, accept. Public URL/browser key are not privileged, but storing them as secrets also keeps them out of tracked files. Server role and cleanup secret must stay server-side. Runtime keys alone do not configure the browser build: the public values must also exist at build time in .env.local or CI build variables.

## 5. Deploy

```powershell
npm run deploy:cloudflare
```

Use the actual HTTPS workers.dev URL printed after a successful deployment. No particular URL can be confirmed before deployment. If renaming sync-reader in wrangler.jsonc, also change the WORKER_SELF_REFERENCE service value to the same name.

## 6. Enable production magic-link login

In Supabase Authentication > URL Configuration:

- Set Site URL to the deployed HTTPS origin.
- Add that exact origin to Redirect URLs (the app sends users back to the origin).
- Keep your local development origin as another redirect if desired.

Open the deployed site, sign in, upload a small book, and read a few pages. Open the same account on your phone and verify the saved position resumes. Save a highlight and delete a test book. In Cloudflare logs, confirm upload validation works and no privileged keys appear in client assets.

If using a custom domain, add it under the Worker's Settings > Domains & Routes and update Supabase's Site URL and redirect allowlist to match.

## 7. Automatic cleanup

The included custom Worker delegates requests to OpenNext and runs /api/maintenance daily at 00:00 UTC (05:30 India time). It uses the internal Worker service binding and CRON_SECRET rather than a public scheduler. Migration 002 is required. HTTP failures cause the scheduled invocation to fail visibly in Cloudflare logs; inspect them and resolve errors. The next daily run retries remaining records. For a large backlog, run additional authenticated maintenance requests.

## Optional GitHub auto-deploy

After the first successful local deploy, push the project to a private repository with package-lock.json, wrangler.jsonc, cloudflare/, scripts/, and the generated open-next.config.ts. Exclude .env.local, .dev.vars, node_modules, .open-next, and work.

Connect the repository to a Worker through Cloudflare Workers & Pages. Set the build command to npm run build:cloudflare and deploy command to npm run deploy:cloudflare:built. Add both NEXT_PUBLIC_ variables to Build variables and secrets. Set all four variables in the runtime Settings > Variables and Secrets too; build settings and runtime settings are separate. Use the same Supabase project for build and runtime. Rebuild after changing browser variables.

## Verification status

Application typechecking and unit tests can run with existing dependencies. The OpenNext build, Workers preview, Cloudflare login/deployment, and live Supabase checks remain pending because deployment packages cannot be downloaded in this session and account credentials are not configured here.

Official references:
- https://opennext.js.org/cloudflare/get-started
- https://opennext.js.org/cloudflare/howtos/env-vars
- https://opennext.js.org/cloudflare/howtos/custom-worker
- https://developers.cloudflare.com/workers/platform/limits/
- https://supabase.com/docs/guides/auth/redirect-urls

## Next.js 16.4 manifest compatibility

The build script applies a narrow adapter patch to include preview-props.json in its existing manifest glob. This uses the generated manifest contents rather than substituting an empty response. It is reapplied before each Workers build after dependency installation. Remove the workaround once the installed adapter includes upstream support; the script recognizes an already patched loader.
