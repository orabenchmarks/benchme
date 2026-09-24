"""A fresh workspace per run, and a signed-in session for the task's app.

Signing in is setup, not the task: every arm starts on the same authenticated
page. Sign-up → the verification code from the workspace inbox → verify →
login, all over HTTP; the session cookie is then handed to the browser through
CDP (`Storage.setCookies`) before the first page load.
"""

from __future__ import annotations

import re
import secrets
from http.cookies import SimpleCookie
from urllib.parse import urlparse

import httpx

EMAIL = "agent@example.com"


def mint(base: str, scenario: str, seed: int, operator_key: str | None = None) -> str:
    headers = {"x-benchme-operator-key": operator_key} if operator_key else {}
    response = httpx.post(f"{base}/api/workspaces", json={"scenario": scenario, "seed": seed}, headers=headers, timeout=60)
    response.raise_for_status()
    return response.json()["id"]


def sign_in(base: str, workspace: str, app: str) -> list[dict]:
    """Sign up + verify + log in to one app; returns CDP cookie params."""
    root = f"{base}/w/{workspace}/{app}"
    password = secrets.token_urlsafe(12)
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        signup = client.post(f"{root}/signup", data={"email": EMAIL, "password": password, "name": "Agent"})
        if signup.status_code == 404:
            return []  # a read-only app (the vault) has no accounts; nothing to sign in to
        signup.raise_for_status()
        mail = client.get(f"{base}/w/{workspace}/mail/api/v1/messages").json()
        codes = [m for m in mail if m.get("to") == EMAIL and app in m.get("from", "")]
        match = re.search(r"\b(\d{6})\b", codes[-1]["body"]) if codes else None
        if not match:
            raise RuntimeError(f"no verification code for {app}")
        client.post(f"{root}/verify", data={"email": EMAIL, "code": match.group(1)}).raise_for_status()
        response = client.post(f"{root}/login", data={"email": EMAIL, "password": password})
        if response.status_code != 303:
            raise RuntimeError(f"login to {app} answered {response.status_code}")
    host = urlparse(base).hostname or "localhost"
    cookies = []
    for header in response.headers.get_list("set-cookie"):
        parsed = SimpleCookie()
        parsed.load(header)
        for name, morsel in parsed.items():
            cookies.append({"name": name, "value": morsel.value, "domain": host, "path": morsel["path"] or "/", "httpOnly": True})
    if not cookies:
        raise RuntimeError(f"login to {app} set no session cookie")
    return cookies
