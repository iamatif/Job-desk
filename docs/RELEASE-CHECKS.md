# Source release checks

Checked locally on 11 November 2026 with Node.js 24.18.0 on Windows:

- `npm test`: 172 tests passed, zero failures.
- `npm audit --omit=dev`: zero reported vulnerabilities at the time of the check.
- `npm run check:hosting`: local Node, writable storage, SQLite and headless Chromium checks passed.
- Tracked-source scan: no matches for configured provider/OAuth secrets, no private key material, and no local data, work or dependency directories included.

These checks do not certify a remote deployment. Docker/Linux deployment, destination HTTPS/access controls, backup restoration and reliable live job-board ingestion still require host-specific validation. Browser searches have encountered upstream access restrictions. The README screenshot shows previously collected listings.

The GitHub workflow reruns the application test suite on pushes and pull requests. Its actual result must be checked after upload.
