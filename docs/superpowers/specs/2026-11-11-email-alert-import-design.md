# Jobdesk email job alerts: IMAP design

Status: proposed for user review; product implementation has not started.

## Intent and agreed direction

The owner wants Indeed and LinkedIn email job alerts imported automatically into personal Jobdesk, matched against saved keywords and deduplicated. The user selected IMAP mailbox + App Password. Existing Node 24, SQLite, account isolation and saved-job functionality remain the foundation. No browser scraping is necessary to read delivered alerts. Application submission remains the user's action through the original job link.

## Approaches

1. Dedicated Gmail with OAuth: no stored App Password, but requires Gmail API configuration, consent and OAuth refresh-token handling. Recommended initially, not selected.
2. Existing Gmail with OAuth: similar integration with a broader personal mailbox involved. Not selected.
3. IMAP + App Password: user-selected; works with providers that support authenticated IMAP. Requires TLS IMAP configuration and an app-specific password where the provider supports it. Actual mailbox provider is still needed for setup instructions, but does not block implementing a provider-neutral connection form.

## Product behavior

- Account settings gets an Email alerts tab: mailbox address, provider preset/server, TLS port 993, folder (INBOX by default), password field, enabled toggle, Save, Test connection, Sync now, Disconnect and status/error display.
- Password is write-only in responses and blank after save; leaving it blank preserves the current password only when connection identity is unchanged. Disconnect removes saved credentials and pauses sync, preserving imported/saved jobs.
- Help explains enabling daily alerts on both platforms for the same saved keywords. Separate Pakistan and worldwide-remote alerts improve coverage, subject to each platform's limits. Sync cannot create alerts on the user's behalf or guarantee all postings, volume or instant delivery.
- Overview displays imported verified-date jobs together with existing relevant jobs, labeled Indeed or LinkedIn and Email alert, with original Apply Now and save/unsave actions. Email alerts tab also exposes an Imported alerts list with keyword/source filters, received timestamp and date verification state, so undated records remain usable without contaminating date filters.
- Posting date is never replaced with receipt date. An explicit job posting date/age within an individual alert card can be parsed using email receipt time, with original text retained as evidence. Ambiguous, missing or future dates remain unverified. Verified jobs obey the existing maximum 14-day feed and day/week/14-day filters. Undated listings stay in the separate imported list, retained at most 14 days from receipt, marked Date unverified. Older verified jobs disappear from the live feed; explicitly saved jobs remain available.
- No estimate is presented as a guaranteed daily count. More alerts may produce more candidates, but repeated listings across emails/keywords count once.

## Import and persistence

- New account-scoped SQLite connection, sync-state, message-receipt and imported-job tables. Do not repurpose the browser worker's status or overwrite its latest run/preferences.
- Saved keyword changes are applied at read time. Import retains bounded legitimate alert candidates, then relevant listings are filtered using existing keyword normalization. No modification of the user's profile or keywords during sync.
- Idempotent identity: Indeed job key / LinkedIn numeric job ID from validated URLs. Strip only known tracking parameters; resolve embedded destination URLs without requesting tracking sites. Preserve a validated provider click link when a canonical original cannot be derived; do not claim a tracking URL is a canonical listing. Message-ID plus folder UIDVALIDITY/UID prevents replay; job ID deduplicates across distinct alerts and existing fetched records. Same listing matches several keywords via one card. Different platform IDs with same title/company are not blindly merged: retain distinct listings or group as related, since they may be separate openings.
- Process bounded messages from the last 14 days, oldest eligible first, with cursor checkpointing only after durable success. UIDVALIDITY changes trigger safe replay through message/job deduplication. Each sync reports messages checked, candidates, new unique jobs, repeats, unmatched and unverified-date counts. Limits and remaining backlog are shown, not silently truncated.
- Robust MIME/HTML parsing uses maintained IMAP and mail parser packages, bounded message/body sizes, no attachment processing, script execution, external image loading or tracking-link fetching. Parser handles multi-card alerts; unsupported layouts are counted and surfaced rather than fabricated. Raw email bodies are transient; persist only listing evidence and bounded identifiers, no unrelated mail.
- Restrict processing to expected Indeed/LinkedIn sender domains, alert-like subjects and allowlisted provider job links. Require trustworthy provider authentication results when available; otherwise quarantine for review. A sender display name alone is insufficient. Builder choice: quarantine displays parsed candidate fields and validated listing links only, never email HTML; it does not appear in the feed. User can explicitly approve one message after checking the links, or dismiss it. Approval imports its candidates with sender verification marked manually reviewed, while retaining all normal keyword/date/dedup checks. Do not allow a blanket trust-sender action. Persist only bounded candidate fields, digest and reason for the 14-day review window. Message import never follows page/email instructions or executes embedded content.

## Connection and scheduling

- TLS-only IMAP, certificate verification enabled; mailbox opened read-only and messages fetched without marking read. Never send, delete, move mail or change subscription settings.
- Encrypt credentials at rest with an installation-specific key outside the database, restricted file permissions where supported. Never log passwords, full upstream errors or raw email. Backup instructions must explain retaining the local key securely.
- Authenticated account-scoped API endpoints with existing CSRF protection; concurrent syncs for the same account coalesce or return busy. SQLite lease/checkpoint prevents overlap across web process and cron. Connection revision protects against stale sync writes after disconnect or settings changes.
- Provider presets only for services that support IMAP App Password authentication. Outlook.com requires OAuth2 and is explicitly not supported by this password-only implementation; its UI must explain that limitation instead of presenting a broken preset. Custom hosts are managed by installation owner and resolve only to public addresses. Disallow private/loopback/link-local destinations and pin validated resolution for the connection to prevent server-side network probing/rebinding. Credentials never sent to a changed host without explicit re-entry.
- Builder choice: default sync every 15 minutes while the local Jobdesk server runs, plus Sync now. Hosted CLI cron uses the same importer without Chromium and can run on Node-capable hosting that permits outbound TLS IMAP. Existing cPanel hosting capability is not assumed. Failed connections back off; no tight retries. Closing the PC/server stops local automatic sync.
- JSearch remains an independently controlled optional source. Email import does not consume search API quota.

## Validation and delivery

- Unit fixtures clearly labeled synthetic for Indeed/LinkedIn multi-card HTML/plain text, tracking URLs, repeats across keywords/emails, invalid dates, expiration, non-alert/spoofed mail and oversized messages.
- Fake IMAP integration tests prove read-only/PEEK behavior, UID reset/replay, pagination/backlog, failure checkpoint recovery, overlapping sync leases and disconnect races. Account/CSRF tests prove credentials are never returned or accessible cross-account.
- Existing suite must remain green; responsive light/dark settings and imported-list UI verified. Run an actual user's alert through the connected mailbox before claiming real live import works. Without credentials, deliver installed connection flow and report live verification pending.
- User supplies mailbox provider/address, appropriate App Password entered only in local Jobdesk, and enabled Indeed/LinkedIn alerts. No password or API key in chat. Gmail App Password requires 2-Step Verification and may not be available for every account.

## Remaining user decision

Approve this IMAP behavior and identify an App Password-capable mailbox provider (for example Gmail or a compatible hosted mailbox). If the intended mailbox is Outlook.com, switch that connection to a separately designed OAuth2 flow. Credentials are entered later into Jobdesk itself. Implementation details, package selection, schema migrations and UI spacing are delegated to the builder.
