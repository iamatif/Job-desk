# Production setup for a personal Jobdesk installation

The repository includes deployment files and automated tests. A successful local test is not proof of production hosting compatibility or live Indeed/LinkedIn access. Complete these steps on the destination host before calling that installation ready.

1. Use Node.js 24 or newer, persistent writable storage and HTTPS. The included Docker and cPanel instructions are alternatives; confirm the host supports the chosen approach. See [HOSTING-SETUP.md](../HOSTING-SETUP.md).
2. Put the application and private data outside any publicly served directory. Do not serve the repository root as static files. Route the HTTPS domain through the Node application; do not expose its backend port directly.
3. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, and set a persistent `JOBDESK_DATA_DIR`. Keep credentials and environment files private, outside Git and the web root.
4. Because this is a personal portal, restrict access at the hosting/reverse-proxy layer before the first signup and keep it restricted. Registration is not invite-only. The first account controls installation-wide settings. Account recovery codes are local; email ownership verification and reset-email delivery are not provided.
5. Run `npm ci --omit=dev`, `npm test` and `npm run check:hosting`. Chromium installation and OS dependencies are needed only for browser collection, but the hosting checker verifies those requirements. Do not treat a blocked Chromium launch as a passing browser deployment.
6. If using Google sign-in, configure a new OAuth client or appropriate authorized HTTPS callback for the deployed origin. The local callback URI is not sufficient for a hosted domain.
7. Configure optional job provider connections inside the app. Verify a real search, source, posting date, location, original application link and persistence after restart. CAPTCHA/access checks and provider quota can still stop ingestion. Do not mark collection healthy from an HTTP 200 alone.
8. Schedule `node cron.mjs` through the host scheduler only after the runtime and live search checks pass. Keep cron logs private. Review failed/partial runs and provider allowances. See hosting instructions for intervals, time budgets and lease behavior.
9. Back up private SQLite data using SQLite backup tooling, or stop web and cron before a consistent copy. Store backups privately and test restoration on an isolated instance. Git is a code backup, not a backup of the user's workspace or credentials.
10. Review dependency advisories, use the lockfile, and rerun tests when updating. Inspect reverse-proxy access restrictions, TLS and private-file handling on the actual host.

## Release verification record

Record the commit, Node version, test results, hosting check results, HTTPS origin, first-account/access configuration, successful live provider search and backup-restore test for the deployment. Do not publish credentials, CVs, logs containing personal data or the private database with that record.

The IMAP email-alert importer and Indeed Publisher Plugin are not implemented in this release. No production server is deployed by uploading this repository to GitHub.
