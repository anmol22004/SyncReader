# Folio is implemented in this folder

The source includes the bookshelf, PDF/EPUB readers, private Supabase upload flow, database/RLS migration, conflict-safe progress sync, highlights, bookmarks, search, themes and Markdown export.

## Start it

Open a terminal in this folder and run:

```powershell
npm install
npm run dev
```

Then open http://127.0.0.1:3000. With no credentials, use the clearly labelled device-only mode. You can upload your books or add the built-in sample EPUB.

## Enable reading across devices

1. Create a Supabase project.
2. Run `supabase/migrations/001_reader.sql`, then `supabase/migrations/002_storage_retention.sql`, in its SQL Editor. For an existing installation, run only 002.
3. Copy `.env.example` to `.env.local` and add your Supabase URL, browser key, and server-only service-role key.
4. Add your app URL to Supabase's Authentication redirect allowlist.
5. Restart the app, sign in, and upload books into your cloud library.
6. Deploy the app to a Next.js host to reach it from phone and desktop. Wait for **Synced** before switching devices.

Books added in device-only mode stay local; upload them again after signing in.

## Verification

27 automated tests passed. The core and server validator passed strict type checking, and every TypeScript source file parsed without syntax errors.

This session blocked dependency downloads, so a complete build, browser tests and live Supabase verification remain to be run after installation:

```powershell
npm test
npm run typecheck
npm run build
```

The root `README.md` contains complete setup and deployment instructions. `docs/acceptance.md` contains the device/security checklist. Full offline downloads and offline annotation resync are intentionally deferred to the roadmap.

## Enable cloud cleanup

Set `CRON_SECRET` and schedule a daily POST to `/api/maintenance` with `Authorization: Bearer <CRON_SECRET>`. This removes abandoned book uploads, expired reader sessions, and retry receipts. The endpoint reports failures so the scheduler can retry. No cloud scheduler is configured yet. Local cleanup runs automatically when using the app, retaining current positions, books, and pending offline operations.

Storage retention changes pass full TypeScript checking and 31 automated tests. Live database retention tests are included in `supabase/tests/retention.test.sql` but require a test Supabase project.
