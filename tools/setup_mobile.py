#!/usr/bin/env python3
"""Explicit, opt-in installer for iOS/Android build prerequisites (`make setup-ios|setup-android`).

WHY a separate tool: the CLI must never install SDKs (src/tooling.ts only reports them), but a developer
who asks for it should get one command. Everything is skipped when already present, downloads are pinned
and checksum-verified, and the large simulator/emulator parts are opt-in behind a free-disk guard because
filling the disk is worse than a refusal.
VERIFIED: package names, archive URLs and SHA-1 sums come from Google's repository2-3.xml (2026-10-06).
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

IOS_TARGETS = ["aarch64-apple-ios", "x86_64-apple-ios", "aarch64-apple-ios-sim"]
ANDROID_TARGETS = ["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"]
# Same list src/tooling.ts checks; `tauri ios init` would otherwise install them with Homebrew itself.
IOS_FORMULAE = [("xcodegen", "xcodegen"), ("pod", "cocoapods"), ("idevicesyslog", "libimobiledevice")]
CMDLINE_TOOLS_BUILD = "16111833"
CMDLINE_TOOLS = {  # (system, machine) -> (archive, sha1)
    ("Darwin", "arm64"): ("commandlinetools-mac_arm64-16111833_latest.zip", "ad03dc49bfacfd52c110b14104ea548b8a07e830"),
    ("Darwin", "x86_64"): ("commandlinetools-mac_x86_64-16111833_latest.zip", "112cf9618794a997ff273537d55bee02c22abffe"),
    ("Linux", "x86_64"): ("commandlinetools-linux-16111833_latest.zip", "e025545c62a8e64c7559119566a569fb1dec5f60"),
    ("Linux", "aarch64"): ("commandlinetools-linux-16111833_latest.zip", "e025545c62a8e64c7559119566a569fb1dec5f60"),
}
ANDROID_NDK = "30.0.16248370"
ANDROID_BUILD = ["platform-tools", "platforms;android-37.0", "build-tools;37.0.0", f"ndk;{ANDROID_NDK}"]
AVD_NAME = "defuss-tauri"
# Free-space guards in GB: download plus unpacked size plus headroom; estimates, not measurements.
NEED_ANDROID_BUILD, NEED_EMULATOR, NEED_SIMULATOR = 6, 9, 12


def log(level: str, message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')} {level} {message}", flush=True)


def run(args: list[str], **kwargs) -> None:
    log("INFO", "run " + " ".join(args))
    subprocess.run(args, check=True, **kwargs)


def free_gb(path: Path) -> int:
    return shutil.disk_usage(path).free // 1024**3


def require_free_gb(path: Path, needed: int, what: str) -> None:
    available = free_gb(path)
    if available < needed:
        raise RuntimeError(f"{what} needs about {needed} GB free on {path}, {available} GB available; free space or skip it")


def cmdline_tools_archive(system: str, machine: str) -> tuple[str, str]:
    key = (system, "arm64" if machine in ("arm64", "aarch64") and system == "Darwin" else machine)
    if key not in CMDLINE_TOOLS:
        raise RuntimeError(f"no pinned Android command-line tools for {system}/{machine}")
    return CMDLINE_TOOLS[key]


def verify_sha1(path: Path, expected: str) -> None:
    actual = hashlib.sha1(path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"checksum mismatch for {path.name}: {actual} != {expected}")


def rustup_targets(targets: list[str]) -> None:
    installed = subprocess.run(["rustup", "target", "list", "--installed"], check=True, capture_output=True, text=True).stdout.split()
    missing = [t for t in targets if t not in installed]
    if missing:
        run(["rustup", "target", "add", *missing])
    else:
        log("INFO", "Rust targets already installed")


def setup_ios(simulator: bool) -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("iOS builds need macOS with Xcode")
    developer = subprocess.run(["xcode-select", "-p"], capture_output=True, text=True).stdout.strip()
    if "Xcode" not in developer:
        raise RuntimeError(f"full Xcode is not selected ({developer or 'none'}): sudo xcode-select -s /Applications/Xcode.app")
    rustup_targets(IOS_TARGETS)
    missing = [formula for binary, formula in IOS_FORMULAE if not shutil.which(binary)]
    if missing:
        run(["brew", "install", *missing])
    else:
        log("INFO", "xcodegen, CocoaPods and libimobiledevice already installed")
    runtimes = subprocess.run(["xcrun", "simctl", "list", "runtimes"], check=True, capture_output=True, text=True).stdout
    if any(line.startswith("iOS ") for line in runtimes.splitlines()):
        log("INFO", "iOS Simulator runtime already installed")
    elif simulator:
        require_free_gb(Path.home(), NEED_SIMULATOR, "the iOS Simulator runtime")
        run(["xcodebuild", "-downloadPlatform", "iOS"])
    else:
        log("WARN", "no iOS Simulator runtime; device builds work, simulator runs need `make setup-ios SIMULATOR=1`")


def android_home() -> Path:
    if os.environ.get("ANDROID_HOME"):
        return Path(os.environ["ANDROID_HOME"]).expanduser()
    return Path.home() / ("Library/Android/sdk" if platform.system() == "Darwin" else "Android/Sdk")


def install_cmdline_tools(sdk: Path) -> Path:
    sdkmanager = sdk / "cmdline-tools/latest/bin/sdkmanager"
    if sdkmanager.exists():
        return sdkmanager
    archive, sha1 = cmdline_tools_archive(platform.system(), platform.machine())
    with tempfile.TemporaryDirectory() as temporary:
        download = Path(temporary) / archive
        log("INFO", f"download Android command-line tools {CMDLINE_TOOLS_BUILD}")
        urllib.request.urlretrieve(f"https://dl.google.com/android/repository/{archive}", download)
        verify_sha1(download, sha1)
        with zipfile.ZipFile(download) as bundle:
            bundle.extractall(temporary)
        # The archive's single top folder must live at cmdline-tools/latest for sdkmanager to find its root.
        target = sdk / "cmdline-tools/latest"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(Path(temporary) / "cmdline-tools"), target)
    for tool in (target / "bin").iterdir():
        tool.chmod(0o755)  # zipfile drops Unix permissions
    return sdkmanager


def setup_android(emulator: bool) -> None:
    if not shutil.which("java"):
        raise RuntimeError("a JDK is required (java on PATH); Gradle 9.6 runs on Java 17 to 26")
    sdk = android_home()
    sdk.mkdir(parents=True, exist_ok=True)
    if not (sdk / "ndk" / ANDROID_NDK).exists():
        require_free_gb(sdk, NEED_ANDROID_BUILD, "the Android SDK and NDK")
    sdkmanager = install_cmdline_tools(sdk)
    run([str(sdkmanager), f"--sdk_root={sdk}", "--licenses"], input="y\n" * 20, text=True, stdout=subprocess.DEVNULL)
    run([str(sdkmanager), f"--sdk_root={sdk}", *ANDROID_BUILD])
    rustup_targets(ANDROID_TARGETS)
    if emulator:
        image = f"system-images;android-37.0;google_apis;{'arm64-v8a' if platform.machine() in ('arm64', 'aarch64') else 'x86_64'}"
        if not (sdk / "emulator").exists():
            require_free_gb(sdk, NEED_EMULATOR, "the Android emulator and system image")
        run([str(sdkmanager), f"--sdk_root={sdk}", "emulator", image])
        avds = subprocess.run([str(sdk / "cmdline-tools/latest/bin/avdmanager"), "list", "avd", "-c"], check=True, capture_output=True, text=True).stdout.split()
        if AVD_NAME not in avds:
            run([str(sdk / "cmdline-tools/latest/bin/avdmanager"), "create", "avd", "-n", AVD_NAME, "-k", image], input="no\n", text=True)
    else:
        log("WARN", "no emulator installed; a USB device works, a virtual one needs `make setup-android EMULATOR=1`")
    log("INFO", f"add to your shell profile: export ANDROID_HOME=\"{sdk}\" NDK_HOME=\"{sdk / 'ndk' / ANDROID_NDK}\"")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("platform", choices=["ios", "android"])
    parser.add_argument("--simulator", action="store_true", help="also install the iOS Simulator runtime (large)")
    parser.add_argument("--emulator", action="store_true", help="also install the Android emulator, a system image and an AVD (large)")
    args = parser.parse_args()
    try:
        setup_ios(args.simulator) if args.platform == "ios" else setup_android(args.emulator)
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        log("ERROR", str(error))
        return 1


if __name__ == "__main__":
    sys.exit(main())
