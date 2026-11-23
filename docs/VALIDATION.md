# Validation

- Applied the supplied patch to a branch from main after a clean git apply --check.
- npm ci succeeded. Patch baseline: 51 passed, 0 failed.
- Final npm test: 54 passed, 0 failed. Tests use mocked Deriv requests and embedded PostgreSQL.
- The default npm run build failed in this Windows sandbox when esbuild attempted to read a parent directory. The production build passed with npm run build --workspace @playgo/web -- --configLoader native, including the shared live-gate import.
- No real-money order, authenticated Deriv acceptance run, hosted migration or deployment was performed.
- History accepts range=1 with inclusive Unix-second from/to parameters and returns complete=false at the 10,000-row cap. The Analytics PDF shows this warning in the UI and in the export. Long range performance with a live broker is unverified.
- Runtime live qualification requires the separate live_qualification.sql migration and an administrator-reviewed, account-specific qualification record. No approval was written and live settings were left off.
