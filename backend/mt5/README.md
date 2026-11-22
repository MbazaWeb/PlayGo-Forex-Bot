# MT5 bridge boundary

This directory contains a manually runnable, read-only Windows terminal adapter.
Install Python on the same Windows host as the broker's MT5 terminal, then install requirements.txt.
Set MT5_LOGIN, MT5_SERVER, MT5_PASSWORD and optionally MT5_TERMINAL_PATH in the worker's environment.
Run python account_snapshot.py. No secrets are sent to the React app.

This adapter is NOT wired to the backend, does NOT place orders, and does NOT automatically
associate the terminal account with a Deriv login. Before exposing it remotely, implement
authenticated worker transport, explicit per-user account ownership, encrypted credential
storage, broker server verification, account reconciliation and execution risk controls.
A frontend on Vercel cannot host the Windows MT5 terminal process.
