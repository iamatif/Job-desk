# Jobdesk hosted cron setup (3.1)

The source is prepared; no hosting deployment or cron entry has been activated. Your cPanel must pass the checks below. A cPanel login alone does not establish Chromium compatibility.

## Check cPanel before uploading private data

Required: Node.js 24+, Application Manager / Setup Node.js App, Terminal or SSH, Cron Jobs, writable private disk, outbound HTTPS, and provider permission to run headless Chromium processes. Playwright's supported Linux systems and browser dependencies are documented at https://playwright.dev/docs/intro and https://playwright.dev/docs/browsers . cPanel may use a different Linux distribution; the provider must supply working dependencies. Do not disable browser security or try to bypass resource limits.

cPanel Application Manager: https://docs.cpanel.net/cpanel/software/application-manager/
Cron UI: https://docs.cpanel.net/cpanel/advanced/cron-jobs/

1. Upload the source into `/home/CPANEL_USER/jobdesk`, OUTSIDE public_html. Do not upload local data, CVs, keys, browser profiles or node_modules from the PC archive.
2. In Terminal select the Node24 executable supplied by your provider. The path below is a placeholder; replace `/ABSOLUTE/PATH/TO/node` and npm with the actual Node24 paths. CloudLinux Setup Node.js App may show a virtual environment activation command; use it first.
3. Run `npm ci --omit=dev` in the application root.
4. Copy `.env.hosting.example` to `/home/CPANEL_USER/jobdesk.env`. Replace the HTTPS domain and private data/browser paths. Keep this file outside public_html, mode600. Keep data directory mode700. Use the SAME values for web and cron. Set these variables in cPanel Application Manager too; `app.cjs` does not automatically load this file.
5. Install Chromium with the same browser path: `PLAYWRIGHT_BROWSERS_PATH=/home/CPANEL_USER/jobdesk-private/playwright-browsers npx playwright install chromium`. If system dependencies are missing, your hosting provider must install/allow them; npm packages alone cannot supply every OS dependency.
6. Run `/ABSOLUTE/PATH/TO/node --env-file=/home/CPANEL_USER/jobdesk.env hosting-check.mjs`. All runtime checks must pass. This does not guarantee Google/Indeed/LinkedIn permit access.
7. Register the application in cPanel, with application root `/home/CPANEL_USER/jobdesk`, startup file `app.cjs`, Node24, your HTTPS domain, and environment variables from step4. Use the domain root/subdomain, not a URL subpath. Configure HTTPS at the host; the Node backend stays private behind Passenger/reverse proxy. Do not expose port4180 publicly.
8. This is a private portal: use the host's password protection/access restrictions while creating your first owner account and preparing the app. Existing signup remains available. An owner account manages installation-wide API keys. Do not enable anonymous registration publicly for a personal deployment without additional access controls.
9. Sign in, upload/manage your CV and save keywords on Overview. Configure JSearch only if desired. In Account settings > Automatic searches choose 6/12/24hours and a posting window of at most14days and whether backup may spend quota; save. The first run is due immediately, subsequent runs use your interval.
10. Add one Cron Jobs entry. Every15minutes: `*/15 * * * *`. Command, using YOUR actual paths:

```
cd /home/CPANEL_USER/jobdesk && /ABSOLUTE/PATH/TO/node --env-file=/home/CPANEL_USER/jobdesk.env /home/CPANEL_USER/jobdesk/cron.mjs >> /home/CPANEL_USER/jobdesk-private/cron.log 2>&1
```

The15-minute cron only checks for due accounts; enabled schedules default to6hours. Do not also add a browser timer or a second worker. An SQLite lease prevents overlapping cron invocations. Up to10 due accounts are considered per invocation; 8minutes per account and20minutes overall are budgeted, with graceful browser navigation cleanup. SIGTERM/SIGINT abort provider requests. A hard-killed process's lease expires after30minutes; the next run marks its old record interrupted. Back up the private database regularly; use SQLite backup tooling or stop both web/cron before copying it.

11. Test once from Terminal with the exact cron command. Confirm the dashboard's Recent fetch history and last/next run. Inspect the PRIVATE cron.log for failures. Do not publish it or paste API keys.

## What is saved

SQLite tables job_schedules, job_fetch_runs and collected_jobs live in the existing private jobdesk.sqlite. Saved keyword preferences are read at run time. Verified recent jobs are upserted per account/job ID; first seen/last seen are preserved. Results are filtered again for saved location, current keywords and posting window, retained for at most14days and capped at2000 per account. Latest100 run records are kept, with10 shown in Account settings. This collected-results database is separate from the user's manually saved shortlist.

An inaccessible board is recorded with its error, and other boards continue. No CAPTCHA solving, stealth, proxies or credential automation is included. If all boards are blocked the honest result can be zero jobs. If you opted into JSearch, it is checked when browser results are empty or a board is blocked, within the remaining execution budget. Actual provider plan/quota still applies. Web and cron reserve shared usage atomically. The prior local live run encountered website access checks; successful automatic Indeed/LinkedIn ingestion on your hosting remains unverified until a real hosted run succeeds.

## If cPanel cannot run Chromium

Do not create a fake success cron or deploy only dropdown source names. Keep this package and use a compatible Linux/Docker worker host, or ask the hosting provider for the required features. Included Dockerfile and compose.yaml offer a separate deployment path; Docker availability on cPanel is NOT assumed.

On a Docker-capable host: configure `.env` with PUBLIC_ORIGIN (real HTTPS origin) and optionally provider environment variables; `docker compose up -d --build`. Put an HTTPS reverse proxy in front of127.0.0.1:4180. Run `docker compose exec -T jobdesk node hosting-check.mjs`, then host cron `*/15 * * * * cd /path/to/jobdesk && docker compose exec -T jobdesk node cron.mjs >> /private/log/path/cron.log 2>&1`. Keep the named data volume. No Docker deployment has been tested in this Windows session.

## Local development

START-JOBDESK.cmd loads the updated local version. Automatic searches do not run by themselves on your PC: only the cron CLI triggers them. `node cron.mjs` checks due enabled accounts and closes without starting an HTTP server. `node hosting-check.mjs` launches a temporary local headless browser smoke test. `npm test` runs unit and integration checks; tests inject a browser/provider so they do not spend your real API quota.
