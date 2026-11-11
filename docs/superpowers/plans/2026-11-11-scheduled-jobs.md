# Scheduled Jobs Implementation Plan
> Execute inline using executing-plans, with TDD and final verification.

Goal: external cron collects saved-keyword jobs and dashboard reads database results.
Architecture: standalone cron invokes the existing server service without HTTP listening. SQLite schedules, runs and results isolate users; leases avoid overlapping cron. Existing parser and headless worker enforce dates and eligibility.
Tech: Node24, node:sqlite, Playwright, vanilla UI.
Spec: ../specs/2026-11-11-scheduled-jobs-design.md

- [ ] Store: tests for isolation, deduplication, expiration, latest preferences, restart, lease; implement lib/scheduled-jobs.mjs.
- [ ] Runner: tests with injected workers for success/block/backup/timeout; implement serial due runner with bounded time and persisted status.
- [ ] Server: expose authenticated GET/PUT schedules and history; hydrate durable results; configure public HTTPS origin and headless hosting, maintain CSRF/local restrictions.
- [ ] UI: add schedule controls on Overview, persist saved keywords before enable, display last/next run and outcome. Browser manual action copy respects hosted/headless context.
- [ ] Deploy: cron CLI, preflight browser/SQLite check, cPanel and Docker instructions/config; no secrets in source archive.
- [ ] Verify targeted tests, full suite, source archive and UI. Actual deployment conditional on connected compatible hosting.

Review focus: interrupted cron lease, invalid saved keywords, disabled backup, stale job dates, account boundary and HTTPS origin.
