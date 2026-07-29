#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import sys
import yaml

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / ".harness/paid-feature-denylist.yaml"
DEPENDENCY_NAMES = {
    "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
    "package.json", "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"
}
CONFIG_SUFFIXES = {".properties", ".toml"}
CONFIG_DIR_PREFIXES = ("deploy/", "src/main/resources/", "service/", "frontend/")


def should_scan(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if path.name in DEPENDENCY_NAMES:
        return True
    if rel.startswith(CONFIG_DIR_PREFIXES) and path.suffix.lower() in {".yaml", ".yml", ".json", *CONFIG_SUFFIXES}:
        return True
    return False


def main() -> int:
    policy = yaml.safe_load(POLICY.read_text(encoding="utf-8"))
    violations: list[str] = []
    files = [p for p in ROOT.rglob("*") if p.is_file() and should_scan(p)]
    for rule in policy.get("rules", []):
        for pattern in rule.get("patterns", []):
            for path in files:
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                if pattern.lower() in text.lower():
                    violations.append(f"{rule['id']}: {pattern!r} found in {path.relative_to(ROOT)}")
    if violations:
        for item in violations:
            print(f"ERROR: {item}", file=sys.stderr)
        return 1
    print("Paid-feature dependency check: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
