# Validation

- Applied the supplied patch to a branch from main after a clean git apply --check.
- npm ci succeeded. Patch baseline: 51 passed, 0 failed.
- Hardening review before the workspace redesign: 54 tests passed, 0 failed. Tests use mocked Deriv requests and embedded PostgreSQL.
- The default npm run build failed in this Windows sandbox when esbuild attempted to read a parent directory. The production build passed with npm run build --workspace @playgo/web -- --configLoader native, including the shared live-gate import.
- No real-money order, authenticated Deriv acceptance run, hosted migration or deployment was performed.
- History accepts range=1 with inclusive Unix-second from/to parameters and returns complete=false at the 10,000-row cap. The Analytics PDF shows this warning in the UI and in the export. Long range performance with a live broker is unverified.
- Runtime live qualification requires the separate live_qualification.sql migration and an administrator-reviewed, account-specific qualification record. No approval was written and live settings were left off.

## Trading workspace review

- The updated suite passed 57 tests with zero failures. It includes stale, duplicate and malformed candles, unfinished bars, and per-market decision receipts.
- Built the Vite production bundle with the native config loader. Local Chromium checks used isolated HTTP and WebSocket responses at 390px and 1440px. Both exercised sign-in, all five workspace pages, zoom and fit, moving average, agent diagnostics, a scheduled scan, stop, and the settlement dialog.
- Price charts poll public candle history every 30 seconds. Agent decisions use closed candles and the selected interval. The browser scheduler runs while Bot Agents is mounted. Broker acceptance and financial performance require separate verification.
