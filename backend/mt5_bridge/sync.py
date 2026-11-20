"""Read-only outbound MT5 snapshot synchronization. Requires local bridge running."""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

LOCAL = "http://127.0.0.1:8765/status"
REMOTE = os.environ.get("PLAYGO_SYNC_URL", "").rstrip("/")
TOKEN = os.environ.get("PLAYGO_MT5_SYNC_TOKEN", "")
INTERVAL = max(15, int(os.environ.get("PLAYGO_SYNC_INTERVAL", "30")))

def fetch_local():
    with urllib.request.urlopen(LOCAL, timeout=15) as response:
        data = json.load(response)
    if data.get("status") != "connected" or not data.get("terminal", {}).get("connected"):
        raise RuntimeError("MT5 terminal disconnected")
    account = data.get("account", {})
    if not isinstance(account.get("login"), int) or not account.get("server"):
        raise RuntimeError("Invalid MT5 account snapshot")
    if not isinstance(data.get("positions"), list):
        raise RuntimeError("Invalid MT5 positions")
    return data

def push(data):
    payload = json.dumps(data, separators=(",", ":")).encode()
    request = urllib.request.Request(
        REMOTE + "/api/mt5/ingest",
        data=payload,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status

def main():
    if not REMOTE.startswith("https://") or len(TOKEN) < 32:
        raise SystemExit("Set HTTPS PLAYGO_SYNC_URL and a strong PLAYGO_MT5_SYNC_TOKEN in your local environment.")
    print("PlayGo MT5 outbound read-only sync started. Press Ctrl+C to stop.")
    while True:
        try:
            snapshot = fetch_local()
            status = push(snapshot)
            print(datetime.now(timezone.utc).isoformat(), "sync", status, "positions", len(snapshot["positions"]))
        except (OSError, ValueError, RuntimeError, urllib.error.HTTPError) as exc:
            print(datetime.now(timezone.utc).isoformat(), "sync unavailable:", type(exc).__name__)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
