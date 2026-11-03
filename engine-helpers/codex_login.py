"""ChatGPT sign-in for Tomo (OpenAI Codex device-code flow), run with the engine's Python and HERMES_HOME set.

The Hermes gateway has no RPC for this login; Hermes' own web dashboard runs it in the background with the helpers
reused here (hermes_cli/web_routers/oauth.py: request user code, exchange tokens; hermes_cli/auth.py: save into
HERMES_HOME/auth.json). Protocol on stdout, one JSON object per line:
  {"event": "code", "user_code": "...", "verification_url": "..."}
  {"event": "approved", "models": [...]} | {"event": "expired"} | {"event": "error", "message": "..."}
Closing stdin cancels.
"""

from __future__ import annotations

import json
import sys
import threading
import time


def emit(**kw):
    sys.stdout.write(json.dumps(kw) + "\n")
    sys.stdout.flush()


def main() -> int:
    import httpx
    from hermes_cli.web_routers import oauth as web_oauth
    from hermes_cli.auth import _save_codex_tokens

    cancelled = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.read(), cancelled.set()), daemon=True).start()
    try:
        device = web_oauth._codex_request_user_code(httpx)
    except Exception as exc:  # network / account not enabled for device login
        emit(event="error", message=str(exc))
        return 1
    emit(event="code", user_code=device["user_code"], verification_url=f"{web_oauth._CODEX_ISSUER}/codex/device")
    payload = {"device_auth_id": device["device_auth_id"], "user_code": device["user_code"]}
    deadline = time.monotonic() + web_oauth._CODEX_EXPIRES_IN
    with httpx.Client(timeout=httpx.Timeout(15.0)) as client:
        while time.monotonic() < deadline:
            if cancelled.wait(device["interval"]):
                emit(event="error", message="cancelled")
                return 1
            try:
                poll = client.post(f"{web_oauth._CODEX_ISSUER}/api/accounts/deviceauth/token", json=payload, headers=web_oauth._JSON_HEADERS)
            except httpx.TransportError:
                continue
            if poll.status_code in (403, 404):
                continue  # not approved yet
            if poll.status_code != 200:
                emit(event="error", message=f"OpenAI returned {poll.status_code}")
                return 1
            try:
                _save_codex_tokens(web_oauth._codex_exchange_tokens(httpx, poll.json()))
            except Exception as exc:
                emit(event="error", message=str(exc))
                return 1
            models: list[str] = []
            try:  # the models this ChatGPT account may use (live list, Hermes' curated list as fallback)
                from hermes_cli.auth_codex import resolve_codex_runtime_credentials
                from hermes_cli.codex_models import get_codex_model_ids

                creds = resolve_codex_runtime_credentials()
                models = get_codex_model_ids(creds.get("api_key") or creds.get("access_token"))
            except Exception:
                from hermes_cli.codex_models import DEFAULT_CODEX_MODELS

                models = list(DEFAULT_CODEX_MODELS)
            emit(event="approved", models=models)
            return 0
    emit(event="expired")
    return 1


if __name__ == "__main__":
    sys.exit(main())
