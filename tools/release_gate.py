#!/usr/bin/env python3
"""Native release evidence is fail-closed, separate from source-level fast verification.

VERIFIED: missing, malformed, stale or incomplete evidence cannot pass this validator.
UNKNOWN: evidence honesty is not guaranteed against an actor who can rewrite the harness.
"""
from __future__ import annotations
from datetime import datetime
import json
from pathlib import Path
import re
import sys
from fingerprint import ROOT, source_fingerprint

PLATFORMS = ("linux", "macos", "windows")
PROFILES = ("dev", "release")
FOLDER_FIRST = {"secure_context", "service_worker_api", "worker_activated", "worker_controls_client", "worker_intercepts_fetch", "missing_worker_404", "storage_writes"}
FOLDER_SECOND = FOLDER_FIRST | {"stable_origin", "local_storage_persists", "cache_storage_persists", "indexeddb_persists"}
CLAIMS = {
    "url-lifecycle": {"exact_target_url", "service_not_started_by_wrapper", "service_survives_normal_exit", "service_survives_forced_exit", "offline_build", "recovery_after_service_start", "authentication_preserved", "websocket"},
    "https-self-signed-lifecycle": {"main_navigation", "subresources", "worker_registration", "worker_activation", "worker_controlled_fetch", "worker_update", "restart_persistence", "wss", "exception_scope", "os_trust_store_unchanged"},
    "worker-upgrade": {"old_worker_active", "new_application_build", "new_worker_activated", "new_worker_controls_fetch", "storage_preserved"},
    "distribution": {"no_introduced_js_runtime", "assets_once", "installed_without_node", "signature_valid", "no_post_sign_mutation", "bundle_sizes_recorded"},
}


def requirements() -> list[tuple[str, str, str]]:
    result = [(system, profile, scope) for system in PLATFORMS for profile in PROFILES for scope in ("folder-loopback-lifecycle", "url-lifecycle", "https-self-signed-lifecycle", "worker-upgrade")]
    return result + [(system, "release", "distribution") for system in PLATFORMS]


def validate(report: dict, expected: tuple[str, str, str], fingerprint: str) -> None:
    system, profile, scope = expected
    if not isinstance(report, dict) or type(report.get("schema")) is not int or report.get("schema") != 1 or report.get("status") != "VERIFIED":
        raise ValueError("report is not schema-1 VERIFIED evidence")
    if (report.get("platform"), report.get("profile"), report.get("scope")) != expected:
        raise ValueError("wrong platform, profile or scope")
    if report.get("source_fingerprint") != fingerprint:
        raise ValueError("evidence is stale for current source/policy inputs")
    stamp = datetime.fromisoformat(report.get("timestamp", ""))
    if stamp.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    artifact = report.get("artifact", {})
    if any(not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get(key, ""))) for key in ("sha256", "cargo_lock_sha256")) or type(artifact.get("bytes")) is not int or artifact["bytes"] <= 0:
        raise ValueError("missing binary size/hash or dependency-lock digest")
    environment = report.get("environment", {})
    if not environment.get("os") or not environment.get("rust"):
        raise ValueError("OS/Rust provenance missing")
    if scope == "folder-loopback-lifecycle":
        phases = report.get("phases", [])
        if len(phases) != 2:
            raise ValueError("requires first launch and restart evidence")
        run_ids = [p.get("runId", "") for p in phases]
        if not re.fullmatch(r"[a-f0-9]{32}:first", run_ids[0]) or run_ids[1] != run_ids[0].replace(":first", ":second"):
            raise ValueError("probe runs do not identify the same isolated profile")
        for phase, expected_checks in zip(phases, (FOLDER_FIRST, FOLDER_SECOND)):
            if phase.get("status") != "VERIFIED" or phase.get("error") is not None or not phase.get("userAgent") or not str(phase.get("origin", "")).startswith("http://127.0.0.1:"):
                raise ValueError("invalid native browser observation")
            if any(phase.get("checks", {}).get(key) is not True for key in expected_checks):
                raise ValueError("missing or failed in-WebView lifecycle check")
        if phases[0]["origin"] != phases[1]["origin"]:
            raise ValueError("origin changed on restart")
    else:
        if scope not in CLAIMS or any(report.get("checks", {}).get(key) is not True for key in CLAIMS[scope]):
            raise ValueError("missing or failed required native/distribution claim")
        # Reports beyond the built-in probe must name retained command logs and observations.
        if not isinstance(report.get("evidence"), list) or not report["evidence"] or any(not isinstance(item, dict) or not item.get("command") or not item.get("observation") for item in report["evidence"]):
            raise ValueError("missing command/observation evidence for additional native gate")


def evaluate(root: Path = ROOT) -> list[str]:
    fingerprint = source_fingerprint(root)
    failures = []
    for expected in requirements():
        system, profile, scope = expected
        path = root / "output/native" / system / profile / f"{scope}.json"
        try:
            report = json.loads(path.read_text("utf8"))
            validate(report, expected, fingerprint)
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
            failures.append(f"{system}/{profile}/{scope}: {error}")
    return failures


def main() -> int:
    failures = evaluate()
    for failure in failures:
        print(f"UNKNOWN[release.requirement]: {failure}")
    print(f"VERIFIED[release]={'false' if failures else 'true'}")
    if failures:
        print("NEXT: run native probes on their actual OS, implement/falsify unresolved adapters, retain evidence for current inputs. Fast tests cannot waive this gate.")
    return 2 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
