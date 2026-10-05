"""Real temporary directories and evidence documents test the native release-evidence boundary.

Synthetic evidence is validator input only, never emitted as actual native verification.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from fingerprint import source_fingerprint
from release_gate import evaluate, requirements, validate, FOLDER_FIRST, FOLDER_SECOND
from policy import check


class EngineeringTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="defuss-engineering-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_fingerprint_ignores_outputs_but_tracks_code_and_policy(self):
        (self.root / "src").mkdir(); source = self.root / "src/a.ts"; source.write_text("a")
        a = source_fingerprint(self.root)
        (self.root / "output").mkdir(); (self.root / "output/log").write_text("run")
        self.assertEqual(source_fingerprint(self.root), a)
        source.write_text("b"); self.assertNotEqual(source_fingerprint(self.root), a)

    def sample_report(self):
        run_id = "a" * 32
        phases = [{"status": "VERIFIED", "runId": run_id + suffix, "origin": "http://127.0.0.1:3000", "userAgent": "synthetic validator fixture", "error": None, "checks": {key: True for key in fields}} for suffix, fields in ((":first", FOLDER_FIRST), (":second", FOLDER_SECOND))]
        return {"schema": 1, "status": "VERIFIED", "scope": "folder-loopback-lifecycle", "platform": "linux", "profile": "dev", "source_fingerprint": "fixture", "timestamp": datetime.now(timezone.utc).isoformat(), "environment": {"os": "fixture", "rust": "fixture"}, "artifact": {"sha256": "1"*64, "cargo_lock_sha256": "2"*64, "bytes": 1}, "phases": phases}

    def test_release_gate_validates_full_lifecycle_not_just_status(self):
        report = self.sample_report()
        expected = ("linux", "dev", "folder-loopback-lifecycle")
        validate(report, expected, "fixture")
        for transform in [lambda r:r.update(schema=True), lambda r:r["artifact"].update(bytes=True), lambda r:r.update(status="UNKNOWN"), lambda r:r.update(source_fingerprint="old"), lambda r:r["phases"][1]["checks"].pop("indexeddb_persists"), lambda r:r["phases"][1].update(origin="http://127.0.0.1:4000"), lambda r:r["artifact"].pop("cargo_lock_sha256"), lambda r:r["phases"][1].update(runId="b"*32+":second"), lambda r:r.update(timestamp="2026-10-04T12:00:00")]:
            invalid = deepcopy(report); transform(invalid)
            with self.assertRaises((ValueError, KeyError)):
                validate(invalid, expected, "fixture")

    def test_release_gate_missing_matrix_fails(self):
        failures = evaluate(self.root)
        self.assertEqual(len(failures), len(requirements()))
        self.assertEqual(len(failures), 27)

    def test_additional_native_claims_need_command_observations(self):
        from release_gate import CLAIMS
        report = self.sample_report(); report.update(scope="distribution", profile="release", checks={key: True for key in CLAIMS["distribution"]})
        with self.assertRaisesRegex(ValueError, "evidence"):
            validate(report, ("linux","release","distribution"), "fixture")
        report["evidence"] = [{"command": "synthetic validator input", "observation": "not a real native run"}]
        validate(report, ("linux","release","distribution"), "fixture")

    def test_current_architecture_policy(self):
        self.assertEqual(check(ROOT), [])


if __name__ == "__main__":
    unittest.main()
