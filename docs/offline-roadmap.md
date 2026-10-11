# Offline release

The current outbox provides recovery for already-loaded reading progress. It is not full offline reading.

1. Add an app-shell service worker with versioned caches and a visible update prompt.
2. Add explicit per-book downloads, IndexedDB byte storage keyed by user/book/SHA-256, verified availability and cache-size/remove-download controls.
3. Restore downloaded books without requesting a temporary cloud URL. Handle browser eviction and expired login without pretending files are still available.
4. Add an annotation outbox using client UUIDs, expected revisions, operation receipts and tombstones. Prune tombstones only after defining a supported offline retention window.
5. On reconnect, fetch current progress first. If it diverges from the saved base revision, ask the user which position to keep. Never let an old offline upload win merely by arriving last.
6. Keep private caches partitioned by account and clear them on logout/account switching. Decide explicitly how offline access works on shared devices.
7. Add tests for multi-day disconnection, rejected authentication, cache eviction, deleted remote books, tombstone retention, replay expiry and simultaneous offline device edits.

The current expired-session recovery creates a fresh session and asks the user to confirm their pending position against the latest server revision. Extend its tests to the offline retention rules before shipping full offline use.
