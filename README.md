# Folio

A personal PDF/EPUB reader built with Next.js, React, TypeScript, Supabase, EPUB.js, and PDF.js. The app lives directly in this folder.

## Run locally

Use Node.js 22 or newer (Node 24 recommended).

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:3000. With no environment variables, Folio runs in **device-only mode**: books, annotations, and progress live in this browser's IndexedDB. Upload a book, or choose the original sample EPUB. The app labels this mode explicitly; it does not pretend to provide cloud sync.

`npm install` copies the matching PDF.js worker, fonts, character maps, WASM files and viewer stylesheet into `public/reader-assets`. There are no external font requests.

## Connect Supabase

1. Create a fresh Supabase project.
2. Run `supabase/migrations/001_reader.sql` in its SQL Editor. It creates the schema, functions, owner-scoped RLS and two private buckets. If using an existing project, audit existing policies first: permissive policies combine with OR.
3. Copy `.env.example` to `.env.local` and fill in:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_BROWSER_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY
CRON_SECRET=YOUR_LONG_RANDOM_MAINTENANCE_SECRET
```

The browser key may be your Supabase publishable key or legacy anon key. Use a service-role credential for the server entry; never prefix it with `NEXT_PUBLIC_` or expose it in browser settings.

4. In Supabase Authentication → URL Configuration, set your site URL and add `http://127.0.0.1:3000` to redirect URLs. Add `http://localhost:3000` too if you use that origin. Set production HTTPS URLs before deployment.
5. Restart the app. Sign in using the emailed magic link.
6. Upload your books while signed in. Device-only books are not automatically migrated: upload the same files again to add them to your cloud library.

For a personal deployment, create your account and disable new signups afterward if you don't want other accounts on your project. Auth redirects use the origin where the request was made; open the emailed link on that same device/browser when testing.

## Implemented

- Responsive private bookshelf with EPUB covers and generated cover designs when artwork is absent.
- Email magic-link login, private cloud file storage and owner-only data access.
- PDF and EPUB upload, validation, SHA-256 identity, duplicate detection, resumable TUS transfer and upload recovery controls.
- Server-side checks for archive size, path traversal, malformed files, active EPUB content and remote EPUB resources.
- EPUB paginated reading with table of contents, font size, typeface, line spacing and light/sepia/dark themes.
- PDF reading with selectable text, zoom and page navigation; original page colors are preserved.
- EPUB CFIs and normalized PDF page coordinates for resume.
- Continue Reading, finished state, title/author editing, grid/list views, library filters and sorting.
- Bookmarks, text highlights, notes, revision-checked note changes and Markdown export.
- Search inside text-bearing documents (up to 100 results per query).
- Revision-checked cross-device progress, immutable retry IDs, conflict choices and an IndexedDB recovery outbox.
- Retryable book deletion and a protected maintenance endpoint.

## Sync behavior

Reader loading and programmatic layout restoration do not save progress. User navigation queues a save; the controller sends at most one request at a time and coalesces further movement. A server acknowledgement displays **Synced**. Without an acknowledgement, it displays **Saved on this device** and retries.

Each reader tab has a session ID; each save has a monotonically increasing sequence, unique operation ID and expected server revision. `save_progress` locks the session and progress rows, verifies ownership and readiness, validates the location and stores a receipt in the same transaction. A replay returns its original receipt.

Conflicting progress never wins automatically. The user chooses **Use other position** or **Keep this position**. Keeping local progress creates a new operation against the reviewed revision; another concurrent save can conflict again. Reading backward is valid.

Opening a book and returning to a tab checks cloud progress. Backgrounded tabs attempt a flush, but browser shutdown cannot guarantee network delivery. For a reliable handoff, wait for **Synced** on the first device before opening the second.

## File limits and compatibility

- 50 MiB per book, 512 MiB reserved/ready library quota per account, three simultaneous upload reservations.
- EPUB: XHTML chapters, ZIP expansion capped at 150 MiB, individual entries at 25 MiB, maximum 5,000 entries. Scripted content, external resources, CSS imports, DRM/encryption and obfuscated fonts are rejected rather than rewritten, preserving stable CFIs.
- PDF: maximum 10,000 pages; encrypted/password-protected PDFs are rejected. Scanned PDFs can be read and bookmarked, but need OCR before text search/highlighting works.
- EPUB displayed page numbers change with screen size; resume uses a passage anchor. PDF resume uses an unrotated page coordinate. Very short pages can limit how far the browser can scroll.
- PDF search navigates to a matching page; detailed match overlays, embedded PDF actions/links and rotation controls are not included in this first release.
- A missing or unsupported cover is replaced by a generated cover design; PDF thumbnail extraction is not included.
- No full offline app/download support yet. An already loaded book can remain readable and progress queues locally; reopening cloud books still requires a connection. Offline annotation writes are not supported.
- Upload/finalization requires the server. Local mode therefore also needs the locally running app when adding books.

## Validate

```powershell
npm test
npm run typecheck
npm run build
```

Unit tests use Node's native runner and cover concurrency decisions, retry identity, coalescing, location bounds, Markdown output, PDF metadata, EPUB validation and hostile archive cases.

For database tests, install the Supabase CLI and Docker, initialize/start a local Supabase project, apply the migration, then run `supabase test db`. The pgTAP tests exercise RLS, grants, RPC ownership, replay receipts, stale revisions, invalid pages and storage path isolation. Run these against a test project only.

Manual acceptance checks are in `docs/acceptance.md`. In particular, test a real phone and desktop against the same Supabase project; unit tests alone cannot establish cross-device behavior.

## Deploy and maintain

Deploy to a host that supports the Next.js Node runtime, a 120-second validation request and sufficient memory for a 50 MiB book plus parsing. Cloud uploads transfer directly to Supabase; the server downloads the stored bytes for validation. Keep all three Supabase variables configured and set production Auth redirects.

Use `npm run build` followed by `npm start` for a Node server. Dev/start bind to loopback by default. For a LAN-only test, run `npx next dev --hostname 0.0.0.0`; for ongoing cross-device use, deploy over HTTPS. Hosts with shorter timeouts should move validation to a bounded job worker before supporting large files.

Schedule an authenticated **POST** to `/api/maintenance` daily using `Authorization: Bearer <CRON_SECRET>`. It removes up to 100 incomplete/failed/deleting books older than 24 hours, removes their original/cover files through the Storage API, and prunes progress receipts older than 30 days. Apply `supabase/migrations/002_storage_retention.sql` to enable bounded cleanup of expired sessions and receipts. Sessions expire after 30 days of inactivity and cleanup removes their dependent receipts. Each run removes at most 5,000 expired sessions and 10,000 additional expired receipts; receipt counts exclude rows cascaded by session deletion. Failed cleanup returns an error so the scheduler can retry. There is no automatic external scheduler configured.

Files and database rows do not share a transaction. The maintenance endpoint cleans interrupted lifecycle operations; failed deletions retain a retryable row. Do not delete `storage.objects` rows directly. Deleting an account through the Auth dashboard also requires Storage cleanup; an account-deletion UI is outside this release.

Private storage and RLS provide account access control, not end-to-end encryption. Back up Storage files separately from the database. The validator rejects common active-content and archive hazards but is not an antivirus service; before opening registration publicly, add isolated parsing workers, rate limiting and broader document compatibility/security testing.

## Structure

```text
src/app/                 Next.js pages and private lifecycle endpoints
src/components/          Bookshelf, dialogs and reader engines
src/lib/service.ts       Cloud/local persistence boundary
src/lib/sync.ts          Independent progress state machine
src/lib/local.ts         IndexedDB and per-account recovery data
src/lib/locations.ts     Location validation and comparison
src/server/              Server-only identity and file validation
supabase/migrations/     Database schema, RLS, functions and buckets
supabase/tests/          Database security/protocol tests
tests/                   Native Node unit tests
scripts/                 Reader asset setup and test runner
docs/                    Acceptance checklist and offline roadmap
work/                    Ignored test/compiler scratch files
outputs/                 User-facing setup handoff
```

## Verification in this session

27 automated tests passed using already available offline runtimes. All TypeScript source files parsed successfully; the dependency-free core and server validator passed a strict type check. Dependency downloads were blocked by the session's network/approval policy, so the complete Next.js build, browser/device tests and live Supabase tests could not be run here. Run the full validation commands above after installing dependencies and connecting your project.

## Storage retention

Local housekeeping runs on library load and during local reading saves, at most once per hour. Retry receipts and abandoned upload-recovery metadata expire after 30 days. Receipts referenced by a pending offline operation are preserved regardless of age; legacy receipts get a timestamp on their first cleanup pass. Original book files, current reading progress, and outstanding saves are retained. Local deleted notes are removed immediately. Cloud annotation tombstones remain for revision/conflict safety. Browser database connections are reused instead of opened per operation.

Cloud housekeeping requires migration 002 and the daily authenticated maintenance POST described above; no scheduler is provisioned by this source change. Run `supabase test db` to verify access restrictions, cascading deletion, and preservation of active sessions and current positions in a test Supabase project. Account deletion and files orphaned by deleting database rows outside the app still require administrative Storage cleanup.

## Cloudflare Workers

See outputs/CLOUDFLARE.md for the prepared deployment flow. Run npm run setup:cloudflare first to install deployment tools and generate open-next.config.ts. Cloudflare-specific builds require the public Supabase variables at build time. Configure privileged keys separately as runtime secrets. The custom Worker includes a daily maintenance trigger. OpenNext deployment remains unverified until installation, preview, and deployment succeed.

## Simple V1 authentication

Sign in and Sign up use email/password with Supabase Auth. Turn Confirm email off in Supabase before testing instant signup. Email links, confirmation screens, and password recovery are omitted in V1. Supabase still stores hashed passwords and protects private book ownership. See outputs/AUTH-SETUP.md.
