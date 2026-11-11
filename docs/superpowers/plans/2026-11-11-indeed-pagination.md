# Indeed pagination and fourteen-day feed

User scope: up to seven independent keywords; follow actual Indeed pagination until30 relevant matches per keyword or exhaustion, bounded10pages. Merge same posting across keywords and show only actual posting dates within14days, newest first. Latest/day/week/14day filters compose with keyword selection. Automatically expire feed records as time passes, preserve manually saved jobs/history. Highlight newest matching card and mark jobs within24hours New. Simplify Overview to query+feed; move schedules to Account settings.

Implementation inline with TDD:
- Pagination helper validates same-site observed next links, query consistency, monotonic offsets and loop prevention. Worker reads all public cards/page, per-keyword progress, dedup and target30, with existing challenge handling.
- Feed enforces14days in server responses, persistence pruning and browser clock filters; old30-day preferences clamp14. Only collected feed records expire, no saved workspace deletions.
- Replace cluttered feed markup with concise search, Latest/day/week/14days, keyword chips, newest-first cards12/page. Timer rerenders only when expiry/order/data actually changes; keep scroll stable. Schedule settings retain capability in account tab.
- Test multi-page overlap, seven keywords, old/invalid/future dates, exact boundaries, no-next/repeated-next, fresh badges, persistence expiry, time-based refresh. Live seven-keyword search records actual counts without padding. Full suite + desktop/mobile QA, deploy3.3, package sources.
