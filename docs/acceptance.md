# Release acceptance

These checks are not claimed to have run against a live Supabase project.

## Library and uploads

- [ ] Local mode adds the original sample EPUB, opens it and restores it after closing/reopening.
- [ ] A PDF with text renders on desktop and mobile; selection aligns with the visible glyphs.
- [ ] EPUB covers render; PDFs and coverless EPUBs have usable generated covers.
- [ ] Interrupt a TUS upload, reconnect, and confirm it completes without duplicated bytes.
- [ ] Reload mid-upload, select the same unchanged file again, and confirm the stored reservation/TUS URL resumes.
- [ ] Validation failure is visible and the failed upload can be removed.
- [ ] Reupload identical bytes; only one ready library book remains.
- [ ] Metadata edits, finished state, filters, title search and list/grid controls work.

## Cross-device progress

- [ ] On phone, navigate to a passage, wait for Synced, then open on desktop: same CFI passage/PDF page coordinate.
- [ ] Change EPUB fonts and viewport dimensions: the passage stays stable.
- [ ] Change PDF zoom: programmatic scroll restoration does not create a progress write.
- [ ] Start two tabs from the same revision; save in one then the other. The second prompts a choice and cannot silently overwrite.
- [ ] Keep the second tab's position; its new request uses the reviewed revision.
- [ ] Drop an acknowledgement and retry: revision increments once.
- [ ] Scroll/navigate while a save is in flight: only the latest queued location is sent afterward.
- [ ] Reopen with queued progress after a temporary connection failure: it recovers or prompts a conflict.
- [ ] Return to an old tab: a newer remote position prompts a choice without moving the current view.

## Notes and search

- [ ] Save EPUB range and PDF multi-line highlights; reopen and verify their alignment.
- [ ] Add/edit notes; delete annotations; another device sees the results when reopening.
- [ ] Concurrent note editing rejects an outdated annotation revision.
- [ ] Search EPUB text and PDF text, open results and check the destination.
- [ ] A scanned PDF explains why text search has no results.
- [ ] Export includes quotes, notes, page/CFI references and dates with valid Markdown escaping.

## Isolation and accessibility

- [ ] Signed-out callers cannot read metadata, original files, covers or annotations.
- [ ] User A cannot read User B's rows, sign downloads, upload into B's path, or invoke write functions on B's records.
- [ ] Direct authenticated progress writes are denied; ownership cannot be changed through public functions.
- [ ] Buckets remain private; no broad existing Storage policies are present.
- [ ] A logout/account switch removes visible private content and previous-account recovery data.
- [ ] Keyboard navigation, focus trapping, Escape dismissal, button labels and mobile layouts work.
- [ ] Test iOS Safari, Android Chrome and desktop Chromium.

## Operations

- [ ] Daily maintenance removes expired lifecycle records and their stored files.
- [ ] Removing a book deletes its annotations/progress and any pending local write.
- [ ] Errors are actionable; logs contain no book text, tokens or signed URLs.
- [ ] Database and Storage recovery procedures are documented for the deployed project.

## EPUB navigation and reading modes
- Open Contents and follow a chapter or nested subchapter link; nested entries are indented.
- For an EPUB without a navigation document, Contents lists links to its spine sections.
- In reader settings, choose Pages or Continuous scroll; the choice persists on this device.
- In Pages mode, swipe left/right to turn pages; vertical gestures and text selection do not turn pages.
- In Continuous scroll mode, scroll across chapter boundaries and confirm progress is saved.
- Switch modes midchapter and confirm the current EPUB CFI is restored without writing a new position merely for switching layouts.
- Reopen the book and confirm the saved position and chosen reading mode are restored.

