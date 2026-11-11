# Hostinger compatibility check — 11 November 2026

Inspected the authenticated Hostinger hPanel on the user's PC. The panel is Hostinger hPanel, not cPanel. The visible hosting subscription is Premium. Under Web Apps, the panel explicitly states that deployment is available on Business plans and up. The VPS page shows setup options and no configured server listing.

Result: the current Premium subscription cannot host the existing Jobdesk Node24 application through managed Node.js deployment. Chromium/Playwright browser execution has not been validated on this hosting. No files were uploaded, no cron entry was created, and no hosting plan was purchased or changed.

Do not upgrade to Business solely on the assumption that Chromium will work. Managed Node.js support is separate from browser binaries, operating-system dependencies, writable private storage and browser-process permissions. A compatible Linux VPS/Docker host permits checking these requirements directly. An alternative is a local Windows scheduler, which requires this PC to remain on.

Official references checked:
- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- https://playwright.dev/docs/browsers

Local application: verified version3.1.0 with scheduled-job-collection capability on http://localhost:4180 after the user ran START-JOBDESK.cmd.
