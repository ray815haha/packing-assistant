"""Tests for accounts & sync: the sync engine and Supabase client (in Node,
against the fake Supabase in tests/fake_supabase.py), the backends keeping a
synced trip's saved_at, and the setup tool. JS tests need Node.js 18+."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeSupabase  # noqa: E402
from packing_assistant.catalog import load_trips, save_trip  # noqa: E402
from tools import setup_sync  # noqa: E402

NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js not installed")
class SyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeSupabase().start()
        cls.short = FakeSupabase(access_ttl=1).start()
        env = {**os.environ, "FAKE_URL": cls.fake.url, "FAKE_KEY": cls.fake.key, "FAKE_SHORT_URL": cls.short.url}
        out = subprocess.run([NODE, str(ROOT / "tests" / "sync_check.mjs")], capture_output=True, text=True,
                             timeout=120, env=env)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    @classmethod
    def tearDownClass(cls):
        cls.fake.stop()
        cls.short.stop()

    def test_every_sync_succeeded(self):
        self.assertEqual(self.r["failures"], [])

    def test_trips_travel_between_devices(self):
        self.assertEqual(self.r["signup"], "ok")
        self.assertEqual(self.r["firstPush"], {"trips": 1, "rows": 1})
        self.assertEqual(self.r["signin"], "ok")
        self.assertEqual(self.r["secondDevice"], {"savedAt": 1000, "tshirt": 3, "sameId": True})
        self.assertEqual(self.r["edit"], [2000, 5])
        self.assertEqual(self.r["delete"], {"a": [], "b": []})

    def test_conflicts(self):
        self.assertEqual(self.r["conflict"], [9, 9])  # the later change wins on both
        self.assertEqual(self.r["sameName"], {"a": [4], "b": [4]})  # one Rome: the newer
        self.assertEqual(self.r["deleteVsEdit"], 7)  # a change elsewhere beats a delete here

    def test_accounts_are_private(self):
        self.assertEqual(self.r["bobSignup"], "ok")
        self.assertEqual(self.r["bob"], {"trips": [], "rows": 0})
        self.assertEqual(self.r["bobWrite"], "42501")  # row-level security

    def test_sign_in_errors(self):
        self.assertEqual(self.r["errors"], {
            "wrongPassword": "invalid_credentials", "duplicate": "user_already_exists", "weak": "weak_password",
            "badEmail": "email_address_invalid", "offline": "offline", "badKey": "http_401",
        })

    def test_tokens_are_refreshed(self):
        self.assertEqual(self.r["refresh"], {"rows": 2, "rotated": True, "signedIn": True})
        self.assertEqual(self.r["ended"], {"state": "signed-out", "error": "expired", "user": None})

    def test_password_reset_link(self):
        self.assertEqual(self.r["redirect"], {"type": "recovery", "email": "alice@example.com"})
        self.assertEqual(self.r["newPassword"], "ok")
        self.assertIsNone(self.r["shareLinkIgnored"])
        self.assertIn("expired", self.r["badLink"]["error"])
        self.assertEqual(self.r["resetEmail"], "ok")
        self.assertIn(("recovery", "alice@example.com", "http://127.0.0.1:8765/"), self.fake.emails)

    def test_sign_out_and_join(self):
        so = self.r["signOut"]
        self.assertGreater(so["before"], 0)
        self.assertEqual(so["after"], ["Unsynced"])  # only trips not yet synced stay
        self.assertIsNone(so["user"])
        self.assertEqual(so["state"], "signed-out")
        self.assertIn("Lisbon", self.r["join"]["a"])  # trips already on a device join the account
        self.assertEqual(self.r["join"]["a"], self.r["join"]["d"])

    def test_delete_account(self):
        self.assertEqual(self.r["deleteAccount"], "ok")
        self.assertEqual(self.r["afterDelete"], {"user": None, "signIn": "invalid_credentials"})
        self.assertFalse(any(u["email"] == "bob@example.com" for u in self.fake.users.values()))

    def test_settings_checks(self):
        self.assertEqual(self.r["config"], {
            "ok": True, "plainHttp": False, "localTest": True, "secretKey": False,
            "serviceRole": True, "anonRole": False, "empty": False, "path": False,
        })

    def test_plan(self):
        p = self.r["plan"]
        self.assertEqual(p["saveLocal"], ["b"])  # changed elsewhere since we last synced
        self.assertEqual(p["deleteLocal"], [])
        self.assertEqual(p["push"], [["d", False]])  # new here
        self.assertEqual(p["known"], {"a": {"t": 10}, "b": {"t": 20}, "c": {"t": 10, "del": True},
                                      "d": {"t": 30}, "e": {"t": 5, "del": True}})
        self.assertEqual(self.r["resurrect"], [["a", False]])


class SavedAtTests(unittest.TestCase):
    def test_server_keeps_a_synced_trips_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trips.json"
            save_trip({"id": "abc", "name": "Synced", "saved_at": 1234567890}, path)
            save_trip({"name": "Fresh"}, path)
            save_trip({"name": "Odd", "saved_at": "soon"}, path)
            save_trip({"name": "Future", "saved_at": time.time() + 10 * 86400}, path)
            trips = {t["name"]: t for t in load_trips(path)}
        self.assertEqual(trips["Synced"]["saved_at"], 1234567890)
        self.assertEqual(trips["Synced"]["id"], "abc")
        for name in ("Fresh", "Odd", "Future"):
            self.assertAlmostEqual(trips[name]["saved_at"], time.time(), delta=5)


class SetupToolTests(unittest.TestCase):
    def test_urls(self):
        self.assertEqual(setup_sync.normalize_url(" https://abcd.supabase.co/rest/v1/ "), "https://abcd.supabase.co")
        self.assertEqual(setup_sync.normalize_url("http://127.0.0.1:8790"), "http://127.0.0.1:8790")
        for bad in ("abcd.supabase.co", "http://abcd.supabase.co", "ftp://x.y"):
            with self.assertRaises(ValueError):
                setup_sync.normalize_url(bad)

    def test_keys(self):
        import base64

        def jwt(role):
            payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
            return f"eyJhbGciOiJIUzI1NiJ9.{payload}.signature"

        self.assertIsNone(setup_sync.key_problem("sb_publishable_abc123"))
        self.assertIsNone(setup_sync.key_problem(jwt("anon")))
        self.assertIn("secret", setup_sync.key_problem("sb_secret_abc123"))
        self.assertIn("service_role", setup_sync.key_problem(jwt("service_role")))
        self.assertIsNotNone(setup_sync.key_problem("hello"))
        self.assertIsNotNone(setup_sync.key_problem(""))

    def test_checks_the_project(self):
        fake = FakeSupabase().start()
        try:
            notes = setup_sync.check_project(fake.url, fake.key)
            self.assertFalse([n for n in notes if n.startswith("!")], notes)
            self.assertTrue(any("Confirm email is off" in n for n in notes))
            bad = setup_sync.check_project(fake.url, "sb_publishable_wrong")
            self.assertTrue(bad[0].startswith("! Supabase didn't accept"))
        finally:
            fake.stop()
        self.assertTrue(setup_sync.check_project("http://127.0.0.1:9", "k")[0].startswith("! Can't reach"))

    def test_writes_the_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sync.json"
            setup_sync.write_config("https://abcd.supabase.co", " sb_publishable_x ", path)
            self.assertEqual(json.loads(path.read_text()), {"supabase_url": "https://abcd.supabase.co",
                                                            "supabase_key": "sb_publishable_x"})

    def test_shipped_settings_are_safe(self):
        cfg = json.loads((ROOT / "web" / "sync.json").read_text(encoding="utf-8"))
        self.assertEqual(set(cfg), {"supabase_url", "supabase_key"})
        if cfg["supabase_key"]:  # once set up: a public key, an https address
            self.assertIsNone(setup_sync.key_problem(cfg["supabase_key"]))
            self.assertTrue(cfg["supabase_url"].startswith("https://"))

    def test_setup_sql(self):
        sql = (ROOT / "supabase" / "setup.sql").read_text(encoding="utf-8").lower()
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all on table public.trips from anon", sql)
        self.assertIn("grant select, insert, update, delete on table public.trips to authenticated", sql)
        self.assertEqual(sql.count("create policy"), 4)
        self.assertIn("security definer", sql)


if __name__ == "__main__":
    unittest.main()
