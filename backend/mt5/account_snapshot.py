"""Isolated, read-only MT5 adapter. Run manually on a Windows terminal host.
This is not an API and is not linked to any Deriv session.
Never publish its output to another user's session without verified ownership.
"""
import json
import os
import sys

def main():
    if sys.platform != "win32":
        raise SystemExit("MT5 requires a Windows terminal host.")
    import MetaTrader5 as mt5
    login = int(os.environ["MT5_LOGIN"])
    server = os.environ["MT5_SERVER"]
    kwargs = {"login": login, "server": server, "password": os.environ["MT5_PASSWORD"], "timeout": 10000}
    path = os.environ.get("MT5_TERMINAL_PATH")
    connected = mt5.initialize(path, **kwargs) if path else mt5.initialize(**kwargs)
    if not connected:
        raise SystemExit("MT5 connection failed. Verify the terminal and account configuration.")
    try:
        account = mt5.account_info()
        if account is None or account.login != login or account.server != server:
            raise SystemExit("MT5 account identity mismatch.")
        print(json.dumps({"login": account.login, "server": account.server,
                          "currency": account.currency, "balance": account.balance,
                          "equity": account.equity, "trade_mode": account.trade_mode,
                          "execution": False}))
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    main()
