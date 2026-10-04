"""Turns on accounts & sync: puts your Supabase project's address and public
key into web/sync.json (see the README, "Accounts and sync").

    python tools/setup_sync.py              # asks for them (or double-click "Set up sync.bat")
    python tools/setup_sync.py --url https://abcd.supabase.co --key sb_publishable_...
    python tools/setup_sync.py --off        # turn sync off again

It checks the project before saving: that the key is a public one (never a
secret / service_role key, which would bypass the protection of everyone's
trips), that email sign-in is on, and that supabase/setup.sql has been run.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "web" / "sync.json"


def normalize_url(url: str) -> str:
    """'https://abcd.supabase.co/rest/v1/' -> 'https://abcd.supabase.co'. Raises ValueError."""
    url = url.strip().rstrip("/")
    m = re.match(r"^(https://[a-z0-9.-]+(:\d+)?)(/.*)?$", url, re.I) or \
        re.match(r"^(http://(127\.0\.0\.1|localhost)(:\d+)?)(/.*)?$", url, re.I)
    if not m:
        raise ValueError("The Project URL should look like https://abcd1234.supabase.co")
    return m.group(1)


def key_problem(key: str) -> str | None:
    """Why this key can't go in a web page, or None if it's fine."""
    key = key.strip()
    if not key:
        return "The key is empty."
    if key.lower().startswith("sb_secret_"):
        return "That's a secret key. Use the publishable key (sb_publishable_...) instead: never put a secret key in the app."
    parts = key.split(".")
    if len(parts) == 3:  # a legacy JWT key: anon is fine, service_role is not
        try:
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        except ValueError:
            return "That key can't be read. Copy it again from Supabase."
        if payload.get("role") == "service_role":
            return "That's the service_role key. Use the anon (or publishable) key instead: never put service_role in the app."
        if payload.get("role") != "anon":
            return "That doesn't look like the anon key. Copy the anon or publishable key from Supabase."
    elif not key.lower().startswith("sb_publishable_"):
        return "That doesn't look like a Supabase key. Copy the publishable (or anon) key."
    return None


def _get(url: str, key: str, timeout: float = 10):
    req = urllib.request.Request(url, headers={"apikey": key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def check_project(url: str, key: str) -> list[str]:
    """Look at the project; returns notes (problems start with '!')."""
    notes = []
    try:
        status, settings = _get(f"{url}/auth/v1/settings", key)
    except (urllib.error.URLError, OSError) as e:
        return [f"! Can't reach {url} ({getattr(e, 'reason', e)}). Check the Project URL and your connection."]
    if status == 401:
        return ["! Supabase didn't accept the key. Copy the publishable (or anon) key again."]
    if status != 200 or not isinstance(settings, dict):
        return [f"! {url} doesn't answer like a Supabase project (HTTP {status})."]
    if not (settings.get("external") or {}).get("email"):
        notes.append("! Email sign-in is off: turn on Authentication > Sign In / Providers > Email.")
    if settings.get("disable_signup"):
        notes.append("! New sign-ups are turned off: people can't create accounts.")
    if settings.get("mailer_autoconfirm"):
        notes.append("Confirm email is off: new accounts can sign in straight away.")
    else:
        notes.append("Confirm email is on: new accounts must click an emailed link first, which needs an "
                     "email (SMTP) provider set up in Supabase (Authentication > Emails). Without one, turn "
                     "Confirm email off.")
    status, body = _get(f"{url}/rest/v1/trips?select=id&limit=1", key)
    code = (body or {}).get("code") if isinstance(body, dict) else None
    if status == 404 or code == "PGRST205":
        notes.append("! The trips table isn't there yet: run supabase/setup.sql in the SQL Editor.")
    elif status == 200:
        notes.append("! Visitors who aren't signed in can read the trips table: run supabase/setup.sql again.")
    return notes


def write_config(url: str, key: str, path: Path = CONFIG) -> None:
    path.write_text(json.dumps({"supabase_url": url, "supabase_key": key.strip()}, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Turn on accounts & sync with your Supabase project.")
    ap.add_argument("--url", help="the Project URL, e.g. https://abcd1234.supabase.co")
    ap.add_argument("--key", help="the publishable (or anon) key")
    ap.add_argument("--off", action="store_true", help="turn sync off")
    ap.add_argument("--no-check", action="store_true", help="don't contact the project first")
    args = ap.parse_args(argv)

    if args.off:
        write_config("", "")
        print("Accounts & sync are off. Publish again (Publish to GitHub.bat) to update the website.")
        return 0

    print("Accounts & sync: connect the app to your Supabase project.")
    print("Both values are in Supabase under Project Settings > API Keys / Data API.\n")
    try:
        url = normalize_url(args.url or input("Project URL (https://....supabase.co): "))
        key = (args.key or input("Publishable key (sb_publishable_...) or anon key: ")).strip()
    except ValueError as e:
        print(f"\n{e}")
        return 1
    except EOFError:
        return 1
    problem = key_problem(key)
    if problem:
        print(f"\n{problem}")
        return 1
    if not args.no_check:
        notes = check_project(url, key)
        print()
        for n in notes:
            print(("  PROBLEM: " + n[2:]) if n.startswith("! ") else ("  " + n))
        if any(n.startswith("! Can't reach") or n.startswith("! Supabase didn't") or "doesn't answer" in n for n in notes):
            print("\nNothing was saved.")
            return 1
    write_config(url, key)
    print(f"\nSaved to {CONFIG.relative_to(ROOT)}.")
    print("Restart the app (close its window and start it again) to see the account button,")
    print("and run Publish to GitHub.bat to put it on the website.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
