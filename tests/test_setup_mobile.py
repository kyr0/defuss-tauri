"""Real files and the real disk; the network installs themselves are exercised by `make setup-ios|setup-android`."""
from __future__ import annotations
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from setup_mobile import cmdline_tools_archive, require_free_gb, verify_sha1


class SetupMobileTests(unittest.TestCase):
    def test_archive_is_pinned_per_host(self):
        self.assertIn("mac_arm64", cmdline_tools_archive("Darwin", "arm64")[0])
        self.assertIn("mac_x86_64", cmdline_tools_archive("Darwin", "x86_64")[0])
        self.assertIn("linux", cmdline_tools_archive("Linux", "aarch64")[0])
        with self.assertRaisesRegex(RuntimeError, "no pinned"):
            cmdline_tools_archive("Windows", "AMD64")

    def test_checksum_rejects_a_changed_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "tools.zip"
            archive.write_bytes(b"pinned bytes")
            verify_sha1(archive, hashlib.sha1(b"pinned bytes").hexdigest())
            archive.write_bytes(b"tampered bytes")
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                verify_sha1(archive, hashlib.sha1(b"pinned bytes").hexdigest())

    def test_disk_guard_refuses_instead_of_filling_the_disk(self):
        require_free_gb(Path.home(), 0, "nothing")
        with self.assertRaisesRegex(RuntimeError, "needs about 1000000 GB free"):
            require_free_gb(Path.home(), 1_000_000, "an impossible download")


if __name__ == "__main__":
    unittest.main()
