"""Output-directory safety regressions for openapi_tool.py generate().

Run standalone with the same PyYAML environment the tool itself requires:

    uv run --quiet --with PyYAML==6.0.3 python scripts/dev/test_openapi_tool_safety.py

Covers the default-directory symlink bypass: the tool-owned default output
(specs/openapi/dist) may keep its recursive-delete permission only while the
lexical chain from the repository root down to it is symlink-free. All
dangerous layouts are built inside throwaway fixture repositories under
tempfile; the real repository, the home directory and system paths are never
targeted. Every case drives the real CLI, so the production guard is what
actually answers."""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOOL = REPO / "scripts" / "dev" / "openapi_tool.py"


class OpenAPIToolSafetyTest(unittest.TestCase):
    def setUp(self):
        work = Path(tempfile.mkdtemp(prefix="openapi-tool-safety-"))
        self.addCleanup(shutil.rmtree, work, True)
        self.work = work
        self.repo = work / "repo"
        shutil.copytree(REPO / "specs/openapi", self.repo / "specs/openapi")
        # The committed dist travels with the copy; the fixture must start
        # without it so default generation creates it fresh and the symlink
        # layouts below can replace it.
        shutil.rmtree(self.repo / "specs/openapi/dist")

    def generate(self, *args):
        return subprocess.run(
            [sys.executable, str(TOOL), "generate", *args, "--root", str(self.repo)],
            capture_output=True, text=True,
        )

    def assert_refused(self, proc, sentinel, expect_symlink_hint=False):
        self.assertNotEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("refusing", proc.stderr)
        if expect_symlink_hint:
            self.assertIn("symlink", proc.stderr)
        self.assertEqual(sentinel.read_text(), "sentinel")
        # No generation write reached the refused target.
        self.assertFalse((sentinel.parent / "api-bundle.yaml").exists())
        self.assertFalse((sentinel.parent / "openapi.snapshot.json").exists())

    def test_default_generation_and_diff_still_work(self):
        proc = self.generate()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue((self.repo / "specs/openapi/dist/api-bundle.yaml").exists())
        diff = subprocess.run(
            [sys.executable, str(TOOL), "diff", "--root", str(self.repo)],
            capture_output=True, text=True,
        )
        self.assertEqual(diff.returncode, 0, diff.stderr)

    def test_root_alias_still_generates(self):
        # A path alias for the repository root itself is a normal access and
        # must stay normalized; only redirections below the root are refused.
        alias = self.work / "repo-alias"
        alias.symlink_to(self.repo)
        proc = subprocess.run(
            [sys.executable, str(TOOL), "generate", "--root", str(alias)],
            capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_nonempty_custom_target_refused(self):
        target = self.work / "custom"
        target.mkdir()
        (target / "keep.txt").write_text("sentinel")
        self.assert_refused(self.generate("--output", str(target)), target / "keep.txt")

    def test_empty_custom_target_allowed(self):
        target = self.work / "empty"
        target.mkdir()
        proc = self.generate("--output", str(target))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue((target / "api-bundle.yaml").exists())

    def test_default_dir_symlinked_to_repo_source_refused(self):
        source_area = self.repo / "srcarea"
        source_area.mkdir()
        (source_area / "keep.txt").write_text("sentinel")
        (self.repo / "specs/openapi/dist").symlink_to(source_area)
        # Default invocation through the redirected alias...
        self.assert_refused(self.generate(), source_area / "keep.txt", True)
        # ...explicit --output naming the alias itself...
        self.assert_refused(
            self.generate("--output", str(self.repo / "specs/openapi/dist")),
            source_area / "keep.txt", True,
        )
        # ...and explicit --output naming the resolved redirect target.
        self.assert_refused(
            self.generate("--output", str(source_area)),
            source_area / "keep.txt", True,
        )

    def test_default_dir_symlinked_outside_repo_refused(self):
        outside = self.work / "outside"
        outside.mkdir()
        (outside / "keep.txt").write_text("sentinel")
        (self.repo / "specs/openapi/dist").symlink_to(outside)
        self.assert_refused(self.generate(), outside / "keep.txt", True)

    def test_parent_component_redirect_refused(self):
        elsewhere = self.work / "elsewhere"
        elsewhere.mkdir()
        shutil.move(str(self.repo / "specs/openapi"), str(elsewhere / "openapi"))
        (self.repo / "specs/openapi").symlink_to(elsewhere / "openapi")
        proc = self.generate()
        self.assertNotEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("symlink", proc.stderr)
        # No deletion or generation write happened at the redirect target.
        self.assertFalse((elsewhere / "openapi/dist").exists())


if __name__ == "__main__":
    try:
        import yaml  # noqa: F401 — the tool under test imports PyYAML itself.
    except ImportError:
        print(
            "PyYAML is required (openapi_tool.py imports it). Run with:\n"
            "  uv run --quiet --with PyYAML==6.0.3 python"
            " scripts/dev/test_openapi_tool_safety.py",
            file=sys.stderr,
        )
        raise SystemExit(2)
    unittest.main()
