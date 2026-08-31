#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "scripts/checks/paid-feature-denylist.yaml"
DEPENDENCY_NAMES = {
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "pyproject.toml",
    "poetry.lock",
    "uv.lock",
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
    "go.mod",
    "go.sum",
}
CONFIG_SUFFIXES = {".properties", ".toml"}
CONFIG_DIR_PREFIXES = ("backend/", "frontend/", "ops/")
PRUNED_DIRS = {
    ".git",
    ".idea",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}


def should_scan(path: Path, root: Path = ROOT) -> bool:
    rel = path.relative_to(root).as_posix()
    if path.name in DEPENDENCY_NAMES or path.name.startswith("requirements"):
        return True
    return rel.startswith(CONFIG_DIR_PREFIXES) and path.suffix.lower() in {
        ".yaml",
        ".yml",
        ".json",
        *CONFIG_SUFFIXES,
    }


def fallback_files(root: Path) -> list[Path]:
    result: list[Path] = []
    for directory, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if name not in PRUNED_DIRS)
        base = Path(directory)
        for name in sorted(filenames):
            path = base / name
            if should_scan(path, root):
                result.append(path)
    return result


def discover_files(root: Path = ROOT) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        return fallback_files(root)
    paths: list[Path] = []
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        relative = raw.decode("utf-8", errors="surrogateescape").replace("\\", "/")
        if any(part in PRUNED_DIRS for part in Path(relative).parts):
            continue
        path = root / relative
        if path.is_file() and should_scan(path, root):
            paths.append(path)
    return sorted(set(paths), key=lambda path: path.relative_to(root).as_posix())


def is_allowed_location(relative: str, allowed: list[str]) -> bool:
    return any(relative == prefix.rstrip("/") or relative.startswith(prefix.rstrip("/") + "/") for prefix in allowed)


def main() -> int:
    policy = yaml.safe_load(POLICY.read_text(encoding="utf-8")) or {}
    violations: list[str] = []
    unreadable: list[str] = []
    contents: dict[Path, str] = {}
    for path in discover_files():
        try:
            contents[path] = path.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeError) as exc:
            unreadable.append(f"{path.relative_to(ROOT).as_posix()}: {exc}")
    if unreadable:
        for item in unreadable:
            print(f"ERROR: dependency/config file is unreadable: {item}", file=sys.stderr)
        return 1

    for rule in policy.get("rules", []):
        allowed = [str(item).replace("\\", "/") for item in rule.get("allowedOnlyIn", [])]
        for pattern in rule.get("patterns", []):
            needle = str(pattern).lower()
            for path, text in contents.items():
                relative = path.relative_to(ROOT).as_posix()
                if needle in text.lower() and not is_allowed_location(relative, allowed):
                    violations.append(f"{rule['id']}: {pattern!r} found in {relative}")
    if violations:
        for item in sorted(set(violations)):
            print(f"ERROR: {item}", file=sys.stderr)
        return 1
    print(f"Paid-feature dependency check: PASS ({len(contents)} tracked or untracked project files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
