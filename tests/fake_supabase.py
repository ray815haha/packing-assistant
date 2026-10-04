"""A small stand-in for the parts of Supabase the app uses, for tests and for
trying accounts & sync without a real project:

    python tests/fake_supabase.py                # http://127.0.0.1:8790
    python tests/fake_supabase.py --confirm-email --ttl 30

It answers like Supabase's Auth API (sign up, sign in, refresh, sign out,
password reset, the user) and Data API (the `trips` table from
supabase/setup.sql, upserts, the delete_my_account function), including
their error formats. It keeps everything in memory, sends no emails (it
records them), and its row-level security is the rule from setup.sql: each
signed-in user reads and writes only their own rows; anonymous callers get
nothing. Not for real use.
"""

from __future__ import annotations

import argparse
import json
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

KEY = "sb_publishable_fake_local_test_key_0001"


class FakeSupabase(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 0, key: str = KEY, confirm_email: bool = False, access_ttl: int = 3600):
        super().__init__(("127.0.0.1", port), _Handler)
        self.key = key
        self.confirm_email = confirm_email
        self.access_ttl = access_ttl
        self.users: dict[str, dict] = {}  # email -> {id, email, password, confirmed}
        self.access: dict[str, tuple[str, int]] = {}  # access token -> (user id, expires at)
        self.refresh: dict[str, str] = {}  # refresh token -> user id
        self.rows: dict[tuple[str, str], dict] = {}  # (user id, trip id) -> row
        self.emails: list[tuple[str, str, str]] = []  # (kind, address, redirect_to) "sent"
        self.lock = threading.Lock()
        self._last = datetime.now(timezone.utc)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def start(self) -> "FakeSupabase":
        threading.Thread(target=self.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        self.shutdown()
        self.server_close()

    # -- helpers ----------------------------------------------------------------
    def stamp(self) -> str:
        """Strictly increasing server time, like now() in the trigger."""
        now = datetime.now(timezone.utc)
        if now <= self._last:
            now = self._last + timedelta(microseconds=1)
        self._last = now
        return now.isoformat(timespec="microseconds")

    def session(self, user: dict) -> dict:
        access, refresh = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        exp = int(time.time()) + self.access_ttl
        self.access[access] = (user["id"], exp)
        self.refresh[refresh] = user["id"]
        return {"access_token": access, "token_type": "bearer", "expires_in": self.access_ttl, "expires_at": exp,
                "refresh_token": refresh, "user": public_user(user)}

    def user_by_id(self, uid: str):
        return next((u for u in self.users.values() if u["id"] == uid), None)


def public_user(u: dict) -> dict:
    return {"id": u["id"], "aud": "authenticated", "role": "authenticated", "email": u["email"],
            "email_confirmed_at": "2026-01-01T00:00:00Z" if u["confirmed"] else None}


class _Handler(BaseHTTPRequestHandler):
    server: FakeSupabase

    def log_message(self, fmt, *args):  # quiet
        pass

    # -- plumbing ------------------------------------------------------------------
    def _send(self, status: int, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-client-info")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

    def _auth_error(self, status, code, msg):
        self._send(status, {"code": status, "error_code": code, "msg": msg})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw) if raw else None

    def _user(self):
        """The signed-in user from the bearer token: (user, None) or (None, why)."""
        auth = self.headers.get("Authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        if not token or token == self.server.key:
            return None, "anon"
        hit = self.server.access.get(token)
        if not hit:
            return None, "bad"
        uid, exp = hit
        if exp < time.time():
            return None, "expired"
        return self.server.user_by_id(uid), None

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _route(self, method):
        if self.headers.get("apikey") != self.server.key:
            return self._send(401, {"message": "Invalid API key", "hint": "Double check your Supabase `anon` or `service_role` API key."})
        url = urlparse(self.path)
        q = {k: v[-1] for k, v in parse_qs(url.query).items()}
        with self.server.lock:
            if url.path.startswith("/auth/v1/"):
                return self._auth(method, url.path[len("/auth/v1/"):], q)
            if url.path.startswith("/rest/v1/"):
                return self._rest(method, url.path[len("/rest/v1/"):], q)
        self._send(404, {"message": "no route"})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    # -- Auth API ----------------------------------------------------------------
    def _auth(self, method, path, q):
        s = self.server
        body = self._body() if method in ("POST", "PUT") else None
        body = body or {}
        if method == "GET" and path == "settings":
            return self._send(200, {"external": {"email": True}, "disable_signup": False,
                                    "mailer_autoconfirm": not s.confirm_email})
        if method == "POST" and path == "signup":
            email = str(body.get("email", "")).strip().lower()
            password = str(body.get("password", ""))
            if "@" not in email or "." not in email.split("@")[-1]:
                return self._auth_error(400, "email_address_invalid", f'Email address "{email}" is invalid')
            if len(password) < 6:
                return self._send(422, {"code": 422, "error_code": "weak_password",
                                        "msg": "Password should be at least 6 characters.",
                                        "weak_password": {"reasons": ["length"]}})
            if email in s.users:
                return self._auth_error(422, "user_already_exists", "User already registered")
            user = {"id": str(uuid.uuid4()), "email": email, "password": password, "confirmed": not s.confirm_email}
            s.users[email] = user
            if s.confirm_email:
                s.emails.append(("confirm", email, q.get("redirect_to", "")))
                return self._send(200, public_user(user))
            return self._send(200, s.session(user))
        if method == "POST" and path == "token":
            if q.get("grant_type") == "password":
                user = s.users.get(str(body.get("email", "")).strip().lower())
                if not user or user["password"] != body.get("password"):
                    return self._auth_error(400, "invalid_credentials", "Invalid login credentials")
                if not user["confirmed"]:
                    return self._auth_error(400, "email_not_confirmed", "Email not confirmed")
                return self._send(200, s.session(user))
            if q.get("grant_type") == "refresh_token":
                uid = s.refresh.pop(str(body.get("refresh_token", "")), None)  # rotated: each works once
                user = s.user_by_id(uid) if uid else None
                if not user:
                    return self._auth_error(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found")
                return self._send(200, s.session(user))
            return self._auth_error(400, "validation_failed", "unsupported_grant_type")
        if method == "POST" and path == "logout":
            auth = self.headers.get("Authorization", "")
            s.access.pop(auth[7:], None)
            return self._send(204)
        if method == "POST" and path == "recover":
            s.emails.append(("recovery", str(body.get("email", "")).lower(), q.get("redirect_to", "")))
            return self._send(200, {})
        if path == "user" and method in ("GET", "PUT"):
            user, why = self._user()
            if not user:
                return self._auth_error(401, "bad_jwt", f"invalid JWT: {why}")
            if method == "PUT" and "password" in body:
                if len(str(body["password"])) < 6:
                    return self._auth_error(422, "weak_password", "Password should be at least 6 characters.")
                user["password"] = str(body["password"])
            return self._send(200, public_user(user))
        self._send(404, {"code": 404, "error_code": "not_found", "msg": "not found"})

    # -- Data API ----------------------------------------------------------------
    def _rest(self, method, path, q):
        s = self.server
        user, why = self._user()
        if why == "expired":
            return self._send(401, {"code": "PGRST301", "details": None, "hint": None, "message": "JWT expired"})
        if why == "bad":
            return self._send(401, {"code": "PGRST301", "details": None, "hint": None, "message": "JWSError JWSInvalidSignature"})
        if path == "rpc/delete_my_account" and method == "POST":
            if not user:
                return self._send(401, {"code": "42501", "message": "permission denied for function delete_my_account"})
            del s.users[user["email"]]
            for k in [k for k in s.rows if k[0] == user["id"]]:
                del s.rows[k]
            for tok in [t for t, (uid, _) in s.access.items() if uid == user["id"]]:
                del s.access[tok]
            for tok in [t for t, uid in s.refresh.items() if uid == user["id"]]:
                del s.refresh[tok]
            return self._send(204)
        if path != "trips":
            return self._send(404, {"code": "PGRST205", "message": f"Could not find the table 'public.{path}' in the schema cache"})
        if not user:  # setup.sql grants nothing to anon
            return self._send(401, {"code": "42501", "details": None, "hint": None, "message": "permission denied for table trips"})
        if method == "GET":
            rows = [r for (uid, _), r in s.rows.items() if uid == user["id"]]
            flt = q.get("updated_at", "")
            if flt.startswith("gt."):
                since = datetime.fromisoformat(flt[3:].replace("Z", "+00:00"))
                rows = [r for r in rows if datetime.fromisoformat(r["updated_at"]) > since]
            rows.sort(key=lambda r: (r["updated_at"], r["id"]))
            offset, limit = int(q.get("offset", 0)), int(q.get("limit", 1000))
            cols = [c for c in q.get("select", "*").split(",") if c]
            rows = rows[offset:offset + limit]
            if cols != ["*"]:
                rows = [{c: r[c] for c in cols if c in r} for r in rows]
            return self._send(200, rows)
        if method == "POST":
            body = self._body()
            items = body if isinstance(body, list) else [body]
            upsert = "resolution=merge-duplicates" in self.headers.get("Prefer", "")
            out = []
            for item in items:
                row = {"user_id": item.get("user_id", user["id"]), "id": str(item.get("id", "")),
                       "name": str(item.get("name", "")), "data": item.get("data", {}),
                       "deleted": bool(item.get("deleted", False))}
                if row["user_id"] != user["id"]:  # the policy's "with check"
                    return self._send(403, {"code": "42501", "details": None, "hint": None,
                                            "message": 'new row violates row-level security policy for table "trips"'})
                if not 1 <= len(row["id"]) <= 40 or len(row["name"]) > 60:
                    return self._send(400, {"code": "23514", "message": 'new row for relation "trips" violates check constraint'})
                key = (row["user_id"], row["id"])
                if key in s.rows and not upsert:
                    return self._send(409, {"code": "23505", "message": 'duplicate key value violates unique constraint "trips_pkey"'})
                row["updated_at"] = s.stamp()
                s.rows[key] = row
                out.append(dict(row))
            return self._send(201, out if "return=representation" in self.headers.get("Prefer", "") else None)
        self._send(405, {"message": "method not allowed"})


def main() -> None:
    ap = argparse.ArgumentParser(description="Run a stand-in for Supabase (accounts & sync) on this computer.")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--confirm-email", action="store_true", help="new accounts must confirm their email first")
    ap.add_argument("--ttl", type=int, default=3600, help="seconds an access token lasts")
    args = ap.parse_args()
    server = FakeSupabase(args.port, confirm_email=args.confirm_email, access_ttl=args.ttl)
    print(f"Fake Supabase at {server.url}  (key: {server.key})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
