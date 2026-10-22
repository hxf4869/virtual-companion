#!/usr/bin/env python3
"""Stub-based unit regression for the VC-R59 resource lifecycle.

The negative cases pin the ownership contract: only objects carrying this
invocation's nonce are ever recorded as created (an intruder appearing
inside the creation window under the shared project label is neither
recorded nor removed, only reported), same-name replacements are preserved,
absence is proven solely by rc0/count0 daemon queries (a failed query is
never "gone"), a pre-existing trial tag is refused rather than overwritten,
image absence is distinguished from unknown, and run.sh refuses to reuse an
output directory and propagates a failed cleanup into the real exit status
(asserting cleanup is defined, so a missing-command shell error can never
pose as a negative pass).

The docker CLI is simulated in-process for the python-level tests and via a
generated executable stub on PATH for the run.sh-level tests — both share
one dispatcher. No real Docker daemon is touched.
"""

import json
import os
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import resources  # noqa: E402

RUN_SH = HERE / "run.sh"


def _ok(stdout=""):
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout,
                                       stderr="")


def _rc(rc, stderr=""):
    return subprocess.CompletedProcess(args=[], returncode=rc, stdout="",
                                       stderr=stderr)


def parse_filters(args):
    filters = []
    for i, token in enumerate(args):
        if token == "--filter" and i + 1 < len(args):
            filters.append(args[i + 1])
    return filters


def _matches(filters, *, cid=None, name=None, labels=None):
    for flt in filters:
        if flt.startswith("label="):
            key, _, value = flt[len("label="):].partition("=")
            if (labels or {}).get(key) != value:
                return False
        elif flt.startswith("id=") and cid is not None:
            if cid != flt[len("id="):]:
                return False
        elif flt.startswith("name=") and name is not None:
            pat = flt[len("name="):]
            if not (pat.startswith("^/") and pat.endswith("$")):
                return False
            if name != pat[2:-1]:
                return False
    return True


def docker_dispatch(state, args, fail_substrings=()):
    """One simulated docker invocation against a mutable object state."""
    joined = " ".join(args)
    for sub in fail_substrings:
        if sub and sub in joined:
            return _rc(1, stderr="simulated daemon failure")
    if args[:2] == ["volume", "inspect"]:
        vol = state["volumes"].get(args[2])
        if vol is None:
            return _rc(1)
        return _ok(json.dumps([{"Name": args[2], "Driver": vol["driver"],
                                "CreatedAt": vol["created_at"],
                                "Labels": vol["labels"],
                                "Mountpoint": "/var/lib/docker/volumes/x"}]))
    if args[:2] == ["network", "inspect"]:
        net = state["networks"].get(args[2])
        if net is None:
            return _rc(1)
        return _ok(json.dumps([{"Name": args[2], "Id": net["id"],
                                "Labels": net["labels"], "Driver": "bridge",
                                "Created": "2026-01-01T00:00:00Z"}]))
    if args[:2] == ["image", "inspect"]:
        image = state["images"].get(args[2])
        if image is None:
            return _rc(1)
        return _ok(json.dumps([{"Id": image}]))
    if args[:2] == ["image", "ls"]:
        return _ok("\n".join(state["images"]))
    if args[:1] == ["inspect"]:
        cid = args[1]
        con = state["containers"].get(cid)
        if con is None:
            return _rc(1)
        return _ok(json.dumps([{
            "Id": cid, "Name": "/" + con["name"],
            "Config": {"Labels": con["labels"],
                       "Image": con.get("image", "img:tag")},
            "Mounts": con.get("mounts", []),
            "NetworkSettings": {"Networks": {}},
        }]))
    if args[:1] == ["ps"]:
        filters = parse_filters(args)
        cids = [cid for cid, con in state["containers"].items()
                if _matches(filters, cid=cid, name=con["name"],
                            labels=con["labels"])]
        return _ok("\n".join(cids))
    if len(args) >= 2 and args[1] == "ls" and args[0] in ("volume", "network"):
        filters = parse_filters(args)
        names = [n for n, spec in state[args[0] + "s"].items()
                 if _matches(filters, name=n, labels=spec["labels"])]
        return _ok("\n".join(names))
    if args[:1] == ["stop"]:
        return _ok(args[-1])
    if args[:1] == ["rm"]:
        if args[-1] not in state["containers"]:
            return _rc(1)
        del state["containers"][args[-1]]
        return _ok(args[-1])
    if args[:2] in (["volume", "rm"], ["network", "rm"]):
        kind = args[0] + "s"
        if args[-1] not in state[kind]:
            return _rc(1)
        del state[kind][args[-1]]
        return _ok(args[-1])
    if args[:1] == ["rmi"]:
        if args[-1] not in state["images"]:
            return _rc(1)
        del state["images"][args[-1]]
        return _ok(args[-1])
    return _rc(125, stderr=f"stub: unsupported docker {' '.join(args)}")


def fresh_state():
    return {"containers": {}, "volumes": {}, "networks": {}, "images": {}}


class SimDocker:
    """In-memory docker_cli replacement; records every invocation.

    `hook`, if set, runs before each dispatch so a test can mutate the
    state mid-sequence (e.g. a same-name replacement between listing and
    inspect).
    """

    def __init__(self, state=None, fail_substrings=()):
        self.state = state if state is not None else fresh_state()
        self.calls = []
        self.fail_substrings = list(fail_substrings)
        self.hook = None

    def add_container(self, cid, name, labels=None, mounts=None):
        self.state["containers"][cid] = {"name": name, "labels": labels or {},
                                         "mounts": mounts or []}

    def add_volume(self, name, labels=None, driver="local",
                   created_at="2026-01-01T00:00:00Z"):
        self.state["volumes"][name] = {"labels": labels or {},
                                       "driver": driver,
                                       "created_at": created_at}

    def add_network(self, name, net_id, labels=None):
        self.state["networks"][name] = {"id": net_id, "labels": labels or {}}

    def add_image(self, ref, image_id):
        self.state["images"][ref] = image_id

    def verbs(self):
        return [" ".join(c) for c in self.calls]

    def __call__(self, args):
        self.calls.append(list(args))
        if self.hook is not None:
            self.hook(list(args))
        return docker_dispatch(self.state, args, self.fail_substrings)


class ResourceTestBase(unittest.TestCase):
    def setUp(self):
        self.sim = SimDocker()
        self._orig_cli = resources.docker_cli
        self._orig_sleep = resources.ABSENCE_SLEEP_S
        resources.docker_cli = self.sim
        resources.ABSENCE_SLEEP_S = 0.0

    def tearDown(self):
        resources.docker_cli = self._orig_cli
        resources.ABSENCE_SLEEP_S = self._orig_sleep


class AbsenceProofTest(ResourceTestBase):
    def test_daemon_query_failure_is_not_container_absence(self):
        self.sim.fail_substrings = ["--filter id="]
        absent, note = resources.container_absent("cafe1234")
        self.assertFalse(absent)
        self.assertIn("listing query failed", note)

    def test_daemon_query_failure_is_not_volume_absence(self):
        self.sim.fail_substrings = ["volume ls"]
        absent, note = resources.volume_absent("v1")
        self.assertFalse(absent)
        self.assertIn("query failed", note)

    def test_absence_requires_rc0_listing_without_match(self):
        absent, _ = resources.container_absent("gone1234")
        self.assertTrue(absent)
        absent, note = resources.volume_absent("nope")
        self.assertTrue(absent)

    def test_verify_absent_surfaces_daemon_failure(self):
        self.sim.fail_substrings = ["network ls"]
        capture = {"containers": [], "volumes": [], "networks": [{"name": "n1"}]}
        problems = resources.verify_absent(capture, {})
        self.assertTrue(any("not proven gone" in p for p in problems))


class RequireAbsentTest(ResourceTestBase):
    def test_clean_preflight_passes(self):
        self.assertEqual(
            resources.require_absent("p1", "nonce1", ["p1_db-data"], ["i:t"]), [])

    def test_prestored_trial_tag_refused(self):
        self.sim.add_image("virtual-companion-runtime:t1", "sha256:aa")
        problems = resources.require_absent("p1", "nonce1", [], ["virtual-companion-runtime:t1"])
        self.assertTrue(any("trial image tag already exists" in p for p in problems))

    def test_daemon_query_failure_is_a_problem_not_absence(self):
        self.sim.fail_substrings = ["image ls"]
        problems = resources.require_absent("p1", "nonce1", [], ["i:t"])
        self.assertTrue(any("image listing query failed" in p for p in problems))

    def test_nonce_collision_refused(self):
        self.sim.add_container("cid1", "other", {resources.NONCE_LABEL: "nonce1"})
        problems = resources.require_absent("p1", "nonce1", [], [])
        self.assertTrue(any("nonce" in p for p in problems))


class RecordBuiltTest(ResourceTestBase):
    def test_absent_distinguished_from_unknown(self):
        built = resources.record_built(["a:t"])
        self.assertEqual(built, {"a:t": None})
        self.sim.fail_substrings = ["image ls"]
        with self.assertRaises(RuntimeError):
            resources.record_built(["a:t"])

    def test_lists_identity(self):
        self.sim.add_image("a:t", "sha256:cafe")
        self.assertEqual(resources.record_built(["a:t"]), {"a:t": "sha256:cafe"})

    def test_untag_only_while_identity_matches(self):
        built = {"a:t": "sha256:aa"}
        self.sim.add_image("a:t", "sha256:aa")
        notes = resources.untag_if_matching(built)
        self.assertEqual(notes, [])
        self.assertIn("rmi a:t", self.sim.verbs())
        # identity changed underneath: never untag someone else's image
        sim2 = SimDocker()
        resources.docker_cli = sim2
        sim2.add_image("a:t", "sha256:bb")
        notes = resources.untag_if_matching(built)
        self.assertTrue(any("identity changed" in n for n in notes))
        self.assertNotIn("rmi a:t", sim2.verbs())


class CaptureReceiptTest(ResourceTestBase):
    def test_intruder_inside_creation_window_not_recorded(self):
        # Root's counter-example: preflight empty; this run's create made A
        # (nonce) and failed; ANOTHER creator left B under the same project
        # label (no nonce). Capture must record only A.
        nonce = "n0"
        self.sim.add_container("cidA", "p1-db-1", {resources.NONCE_LABEL: nonce})
        self.sim.add_container("cidB", "p1-foreign", {resources.PROJECT_LABEL: "p1"})
        self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: nonce})
        self.sim.add_volume("p1_foreign-vol", {resources.PROJECT_LABEL: "p1"})
        self.sim.add_network("p1_default", "netid1", {resources.NONCE_LABEL: nonce})
        inv = resources.capture_inventory(nonce, "p1")
        self.assertEqual([c["cid"] for c in inv["containers"]], ["cidA"])
        self.assertEqual([v["name"] for v in inv["volumes"]], ["p1_db-data"])
        self.assertEqual([n["name"] for n in inv["networks"]], ["p1_default"])
        self.assertEqual(inv["volumes"][0]["nonce"], nonce)
        self.assertEqual(inv["networks"][0]["id"], "netid1")

    def test_capture_query_failure_raises(self):
        self.sim.fail_substrings = ["ps -aq"]
        with self.assertRaises(RuntimeError):
            resources.capture_inventory("n0", "p1")


class CleanupRecordedTest(ResourceTestBase):
    def make_inventory(self):
        nonce = "n0"
        self.sim.add_container("cidA", "p1-db-1",
                               {resources.NONCE_LABEL: nonce})
        self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: nonce})
        self.sim.add_network("p1_default", "netid1",
                             {resources.NONCE_LABEL: nonce})
        return resources.capture_inventory(nonce, "p1")

    def test_only_recorded_resources_removed_intruder_preserved(self):
        capture = self.make_inventory()
        self.sim.add_container("cidB", "p1-foreign",
                               {resources.PROJECT_LABEL: "p1"})
        self.sim.add_volume("p1_foreign-vol", {resources.PROJECT_LABEL: "p1"})
        self.sim.add_image("img:t", "sha256:aa")
        collectors = {"project": "p1", "containers": [
            {"cid": "cidObs", "kind": "observer", "name": "p1-observer"}]}
        self.sim.add_container("cidObs", "p1-observer", {})
        with tempfile.TemporaryDirectory() as tmp:
            leftovers_path = os.path.join(tmp, "leftovers.json")
            categories = resources.cleanup_recorded(
                capture, {"img:t": "sha256:aa"}, collectors, leftovers_path,
                project="p1")
            leftovers = json.loads(Path(leftovers_path).read_text())
        verbs = self.sim.verbs()
        self.assertIn("rm -f cidA", verbs)
        self.assertIn("rm -f cidObs", verbs)
        self.assertIn("volume rm p1_db-data", verbs)
        self.assertIn("network rm p1_default", verbs)
        self.assertIn("rmi img:t", verbs)
        # the intruder is preserved and only REPORTED, never touched
        self.assertNotIn("stop -t 5 cidB", verbs)
        self.assertNotIn("rm -f cidB", verbs)
        self.assertNotIn("volume rm p1_foreign-vol", verbs)
        self.assertIn("cidB", leftovers["unexpected_labelled"]["containers"])
        self.assertIn("p1_foreign-vol",
                      leftovers["unexpected_labelled"]["volume"])
        self.assertGreater(categories, 0)  # unproven leftovers fail cleanup

    def test_replacement_volume_preserved(self):
        capture = self.make_inventory()
        # same name + same project, but a DIFFERENT creation identity
        self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: "n0"},
                            created_at="2027-01-01T00:00:00Z")
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                capture, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertNotIn("volume rm p1_db-data", self.sim.verbs())
        self.assertGreater(categories, 0)

    def test_replacement_network_preserved(self):
        capture = self.make_inventory()
        self.sim.add_network("p1_default", "different-immutable-id",
                             {resources.NONCE_LABEL: "n0"})
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                capture, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertNotIn("network rm p1_default", self.sim.verbs())
        self.assertGreater(categories, 0)

    def test_container_identity_mismatch_preserved(self):
        capture = self.make_inventory()
        self.sim.add_container("cidA", "p1-replaced-thing", {})
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                capture, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertNotIn("stop -t 5 cidA", self.sim.verbs())
        self.assertGreater(categories, 0)

    def test_unprovable_removal_is_leftover_not_gone(self):
        capture = self.make_inventory()
        self.sim.fail_substrings = ["--filter id="]  # absence never provable
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                capture, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertGreater(categories, 0)

    def test_clean_full_cycle(self):
        capture = self.make_inventory()
        self.sim.add_image("img:t", "sha256:aa")
        with tempfile.TemporaryDirectory() as tmp:
            leftovers_path = os.path.join(tmp, "l.json")
            categories = resources.cleanup_recorded(
                capture, {"img:t": "sha256:aa"}, None, leftovers_path,
                project="p1")
            self.assertEqual(json.loads(Path(leftovers_path).read_text()), {})
        self.assertEqual(categories, 0)
        self.assertEqual(self.sim.state, fresh_state())


class StartGateTest(ResourceTestBase):
    """Pre-start completeness gate: only proven receipts may start."""

    COMPOSE = {
        "services": {"db": {}, "runtime": {}, "migrate": {},
                     "fake-provider": {}},
        "volumes": {"db-data": {"name": "p1_db-data"}},
        "networks": {"default": {"name": "p1_default"}},
    }

    def seed_receipts(self, services=("db", "runtime", "migrate",
                                      "fake-provider"),
                      db_volume_receipt=True):
        nonce = "n0"
        db_mounts = [{"Type": "volume", "Name": "p1_db-data",
                      "Destination": "/var/lib/postgresql"}]
        for svc in services:
            self.sim.add_container(
                f"cid_{svc}", f"p1-{svc}-1",
                {resources.NONCE_LABEL: nonce,
                 "com.docker.compose.service": svc},
                mounts=db_mounts if svc == "db" else [])
        if db_volume_receipt:
            self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: nonce})
        self.sim.add_network("p1_default", "netid1",
                             {resources.NONCE_LABEL: nonce})
        return resources.capture_inventory(nonce, "p1")

    def test_full_receipts_pass_gate(self):
        capture = self.seed_receipts()
        self.assertEqual(
            resources.verify_start_readiness(self.COMPOSE, capture), [])

    def test_foreign_container_holding_expected_name_refuses_start(self):
        # Root's case: a foreign object occupies the expected migrate (or
        # runtime) name; our create could not produce that service. Start
        # must be refused, the foreigner never replaced/started/removed.
        capture = self.seed_receipts(services=("db", "runtime",
                                               "fake-provider"))
        self.sim.add_container("cid_foreign_migrate", "p1-migrate-1",
                               {resources.PROJECT_LABEL: "p1"})
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("service migrate has no nonce-receipted container"
                            in p for p in problems))
        # and the cleanup path still never touches the foreigner
        with tempfile.TemporaryDirectory() as tmp:
            resources.cleanup_recorded(capture, {}, None,
                                       os.path.join(tmp, "l.json"),
                                       project="p1")
        self.assertNotIn("rm -f cid_foreign_migrate", self.sim.verbs())
        self.assertNotIn("stop -t 5 cid_foreign_migrate", self.sim.verbs())

    def test_foreign_db_volume_refuses_start(self):
        # The db container is receipted and mounts the expected db-data
        # name, but that volume is foreign (no nonce receipt): never start
        # the db on an unproven volume.
        capture = self.seed_receipts(db_volume_receipt=False)
        self.sim.add_volume("p1_db-data", {resources.PROJECT_LABEL: "p1"})
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("volume db-data (p1_db-data) has no complete "
                            "nonce receipt" in p for p in problems))
        self.assertTrue(any("mounts unproven volume p1_db-data" in p
                            for p in problems))
        with tempfile.TemporaryDirectory() as tmp:
            resources.cleanup_recorded(capture, {}, None,
                                       os.path.join(tmp, "l.json"),
                                       project="p1")
        self.assertNotIn("volume rm p1_db-data", self.sim.verbs())

    def test_unreadable_receipt_identity_refuses_start(self):
        capture = self.seed_receipts()
        capture["containers"].append({"cid": "cid_opaque", "name": None})
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("lacks a service identity" in p for p in problems))

    def test_unverified_volume_receipt_refuses_start(self):
        # Root's replay shape: an inspect-failed capture entry carries only
        # the name — the gate must refuse, not pass on name membership.
        capture = self.seed_receipts()
        capture["volumes"][0] = {"name": "p1_db-data", "identity": None}
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("volume p1_db-data receipt unverified or incomplete"
                            in p for p in problems))
        self.assertTrue(any("volume db-data (p1_db-data) has no complete nonce "
                            "receipt" in p for p in problems))

    def test_unverified_network_receipt_refuses_start(self):
        capture = self.seed_receipts()
        capture["networks"][0] = {"name": "p1_default",
                                  "unverified": "identity unreadable at capture"}
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("network p1_default receipt unverified or incomplete"
                            in p for p in problems))

    def test_nonce_mismatched_volume_receipt_refuses_start(self):
        # A persisted record whose nonce is not this run's must be rejected
        # at both the gate and the cleanup input boundary.
        capture = self.seed_receipts()
        capture["volumes"][0]["nonce"] = "nFOREIGN"
        problems = resources.verify_start_readiness(self.COMPOSE, capture)
        self.assertTrue(any("receipt unverified or incomplete" in p
                            for p in problems))
        with tempfile.TemporaryDirectory() as tmp:
            resources.cleanup_recorded(capture, {}, None,
                                       os.path.join(tmp, "l.json"),
                                       project="p1")
        self.assertNotIn("volume rm p1_db-data", self.sim.verbs())


class CaptureReplaceTest(ResourceTestBase):
    """List→inspect replacement (Root's stub replay): a foreign same-name
    object appearing between the nonce listing and the detail inspect must
    never be promoted into this run's receipt; the replacer is preserved
    and only reported."""

    def test_volume_replaced_between_listing_and_inspect(self):
        nonce = "n0"
        self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: nonce})

        def replace_with_foreign(args):
            if args[:2] == ["volume", "inspect"]:
                self.sim.add_volume(
                    "p1_db-data", {resources.NONCE_LABEL: "nFOREIGN"},
                    created_at="2027-01-01T00:00:00Z")
                self.sim.hook = None  # replace exactly once

        self.sim.hook = replace_with_foreign
        inv = resources.capture_inventory(nonce, "p1")
        entry = inv["volumes"][0]
        self.assertEqual(entry["name"], "p1_db-data")
        self.assertIn("unverified", entry)
        self.assertNotIn("driver", entry)
        self.assertNotIn("created_at", entry)
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                inv, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertNotIn("volume rm p1_db-data", self.sim.verbs())
        self.assertGreater(categories, 0)

    def test_network_replaced_between_listing_and_inspect(self):
        nonce = "n0"
        self.sim.add_network("p1_default", "netid-ours",
                             {resources.NONCE_LABEL: nonce})

        def replace_with_foreign(args):
            if args[:2] == ["network", "inspect"]:
                self.sim.add_network(
                    "p1_default", "netid-foreign",
                    {resources.NONCE_LABEL: "nFOREIGN"})
                self.sim.hook = None

        self.sim.hook = replace_with_foreign
        inv = resources.capture_inventory(nonce, "p1")
        entry = inv["networks"][0]
        self.assertIn("unverified", entry)
        self.assertNotIn("id", entry)
        with tempfile.TemporaryDirectory() as tmp:
            categories = resources.cleanup_recorded(
                inv, {}, None, os.path.join(tmp, "l.json"), project="p1")
        self.assertNotIn("network rm p1_default", self.sim.verbs())
        self.assertGreater(categories, 0)

    def test_unreadable_identity_recorded_as_unverified(self):
        self.sim.add_volume("p1_db-data", {resources.NONCE_LABEL: "n0"})
        self.sim.fail_substrings = ["volume inspect"]
        inv = resources.capture_inventory("n0", "p1")
        self.assertEqual(inv["volumes"],
                         [{"name": "p1_db-data",
                           "unverified": "identity unreadable at capture"}])


class ReceiptStateTest(ResourceTestBase):
    """Missing/unreadable REQUIRED receipt records are unknown, never an
    empty success; explicit valid empty records are real answers."""

    def test_load_state_distinguishes_missing_unknown_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            self.assertEqual(resources._load_state(str(p / "nope.json")),
                             ("missing", None))
            (p / "bad.json").write_text("{corrupt")
            self.assertEqual(resources._load_state(str(p / "bad.json"))[0],
                             "unknown")
            (p / "null.json").write_text("null")
            self.assertEqual(resources._load_state(str(p / "null.json"))[0],
                             "unknown")
            (p / "empty.json").write_text("{}")
            self.assertEqual(resources._load_state(str(p / "empty.json")),
                             ("ok", {}))

    def test_unknown_built_blocks_clean_but_confirmed_container_cleaned(self):
        self.sim.add_container("cidA", "p1-db-1",
                               {resources.NONCE_LABEL: "n0",
                                "com.docker.compose.service": "db"})
        capture = resources.capture_inventory("n0", "p1")
        note = "built receipt record unreadable (JSONDecodeError)"
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "l.json")
            categories = resources.cleanup_recorded(
                capture, None, None, out, project="p1", unknown=[note])
            leftovers = json.loads(Path(out).read_text())
        self.assertIn("rm -f cidA", self.sim.verbs())   # confirmed: cleaned
        self.assertEqual(leftovers["unverified"], [note])
        self.assertGreater(categories, 0)               # but never "clean"


class ReceiptStateCliTest(unittest.TestCase):
    """The CLI boundary: direct rc for missing/corrupt/valid-empty records."""

    def run_cli(self, tmp, capture_doc, built_doc, collectors_doc):
        tmp = Path(tmp)
        stub_bin = tmp / "bin"
        stub_bin.mkdir()
        stub = stub_bin / "docker"
        stub.write_text("#!/bin/sh\nexec python3 '%s' __docker_stub__ \"$@\"\n"
                        % str(Path(__file__).resolve()))
        stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
        (tmp / "state.json").write_text(json.dumps(fresh_state()))
        paths = {}
        for name, doc in (("capture", capture_doc), ("built", built_doc),
                          ("collectors", collectors_doc)):
            paths[name] = tmp / f"{name}.json"
            if doc is not None:
                paths[name].write_text(doc)
        leftovers = tmp / "leftovers.json"
        env = dict(os.environ, PATH=f"{stub_bin}:{os.environ['PATH']}",
                   STUB_STATE=str(tmp), STUB_CALLS=str(tmp / "calls.log"))
        proc = subprocess.run(
            ["python3", str(HERE / "resources.py"), "cleanup",
             "--capture", str(paths["capture"]), "--built", str(paths["built"]),
             "--collectors", str(paths["collectors"]),
             "--leftovers-out", str(leftovers), "--project", "p1"],
            capture_output=True, text=True, env=env)
        return proc, json.loads(leftovers.read_text())

    VALID_EMPTY_CAPTURE = ('{"project":"p1","nonce":"n0","containers":[],'
                           '"volumes":[],"networks":[]}')

    def test_missing_built_record_is_unverified(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc, leftovers = self.run_cli(tmp, self.VALID_EMPTY_CAPTURE,
                                           None, None)
            self.assertEqual(proc.returncode, 1)
            self.assertTrue(any("built receipt record missing" in m
                                for m in leftovers["unverified"]))

    def test_valid_empty_records_are_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc, leftovers = self.run_cli(tmp, self.VALID_EMPTY_CAPTURE,
                                           "{}", None)   # collectors absent OK
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(leftovers, {})

    def test_corrupt_collectors_record_is_unverified(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc, leftovers = self.run_cli(tmp, self.VALID_EMPTY_CAPTURE,
                                           "{}", "{corrupt")
            self.assertEqual(proc.returncode, 1)
            self.assertTrue(any("collectors record unreadable" in m
                                for m in leftovers["unverified"]))

    def test_missing_capture_record_is_unverified(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc, leftovers = self.run_cli(tmp, None, "{}", None)
            self.assertEqual(proc.returncode, 1)
            self.assertTrue(any("capture receipt record missing" in m
                                for m in leftovers["unverified"]))


class RunShStubTest(unittest.TestCase):
    """run.sh-level negatives via a generated docker stub on PATH."""

    def run_sh(self, env_extra):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            stub_bin = tmp / "bin"
            stub_bin.mkdir()
            stub = stub_bin / "docker"
            stub.write_text(
                "#!/bin/sh\nexec python3 '%s' __docker_stub__ \"$@\"\n"
                % str(Path(__file__).resolve()))
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
            state = fresh_state()
            (tmp / "state.json").write_text(json.dumps(state))
            calls_path = tmp / "calls.log"
            env = dict(os.environ,
                       PATH=f"{stub_bin}:{os.environ['PATH']}",
                       STUB_STATE=str(tmp),
                       STUB_CALLS=str(calls_path),
                       G12_TRIAL_ID="stubtrial",
                       G12_HTTPS_PORT="18448",
                       **env_extra)
            proc = subprocess.run(
                ["bash", str(RUN_SH)],
                capture_output=True, text=True, env=env, cwd=str(HERE))
            calls = []
            if calls_path.exists():
                calls = [json.loads(line)
                         for line in calls_path.read_text().splitlines() if line]
            return proc, calls, tmp

    def test_existing_dir_with_prior_state_refused_zero_docker(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            out.mkdir()
            (out / ".stack-creating").write_text("")
            (out / "collectors.json").write_text("{}")
            (out / "compose.env").write_text("K=V")
            (out / "stack.compose.json").write_text("{}")
            proc, calls, _ = self.run_sh({"G12_OUTPUT_DIR": str(out)})
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("refusing to reuse", proc.stderr)
            self.assertEqual(calls, [])  # zero docker invocations

    def test_claimed_dir_refused_zero_docker(self):
        # An empty dir already carrying the atomic claim marker is prior
        # state: refused before any docker invocation.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "empty"
            out.mkdir()
            (out / ".g12-owner").mkdir()
            proc, calls, _ = self.run_sh({"G12_OUTPUT_DIR": str(out)})
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("refusing to reuse", proc.stderr)
            self.assertEqual(calls, [])

    def drive_cleanup(self, tmp, docker_state, collectors_doc=None,
                      capture_doc=None, built_doc=None, skip_collectors=False,
                      launch_attempted=False):
        """Source run.sh for real and invoke its cleanup() with the stub."""
        state_path = tmp / "state.json"
        state_path.write_text(json.dumps(docker_state))
        out = tmp / "out"
        out.mkdir(exist_ok=True)
        if collectors_doc is None:
            collectors_doc = ('{"project":"vcg12c-stubtrial","containers":'
                              '[{"cid":"cidobs0000001","kind":"observer",'
                              '"name":"vcg12c-stubtrial-observer"}]}')
        if capture_doc is None:
            capture_doc = ('{"project":"vcg12c-stubtrial","nonce":"n0",'
                           '"containers":[],"volumes":[],"networks":[]}')
        if built_doc is None:
            built_doc = "{}"
        files = {
            "created-resources.json": capture_doc,
            "built-images.json": built_doc,
        }
        if not skip_collectors:
            files["collectors.json"] = collectors_doc
        lines = ["set -euo pipefail",
                 "export G12_SOURCE_ONLY=1 G12_OUTPUT_DIR=%s"
                 % shlex.quote(str(out)),
                 "source %s" % shlex.quote(str(RUN_SH)),
                 "type cleanup >/dev/null 2>&1 || { echo 'cleanup not defined'; exit 9; }"]
        for name, doc in files.items():
            if doc is not None:
                lines.append("printf '%%s' '%s' > %s"
                             % (doc.replace("'", "'\\''"),
                                shlex.quote(str(out / name))))
        lines += ["touch %s" % shlex.quote(str(out / ".stack-creating"))]
        if launch_attempted:
            # run.sh touches this marker right before the collector launch
            lines.append("touch %s"
                         % shlex.quote(str(out / ".collectors-launched")))
        lines += ["true", "cleanup"]
        driver = tmp / "drive.sh"
        driver.write_text("\n".join(lines) + "\n")
        stub_bin = tmp / "bin"
        stub_bin.mkdir(exist_ok=True)
        stub = stub_bin / "docker"
        if not stub.exists():
            stub.write_text(
                "#!/bin/sh\nexec python3 '%s' __docker_stub__ \"$@\"\n"
                % str(Path(__file__).resolve()))
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
        env = dict(os.environ,
                   PATH=f"{stub_bin}:{os.environ['PATH']}",
                   STUB_STATE=str(tmp),
                   STUB_CALLS=str(tmp / "calls.log"))
        return subprocess.run(["bash", str(driver)], capture_output=True,
                              text=True, env=env, cwd=str(HERE)), out

    def test_cleanup_failure_propagates(self):
        # Business path SUCCEEDS (`true`); the cleanup daemon queries fail,
        # so the collector removal can never be proven gone -> the real
        # direct rc must be nonzero (an EXIT-trap `return` would hide this).
        # The stub log must be non-empty: the failure has to come from the
        # real cleanup logic, not from a missing command/file.
        with tempfile.TemporaryDirectory() as tmp:
            state = fresh_state()
            state["containers"]["cidobs0000001"] = {
                "name": "vcg12c-stubtrial-observer", "labels": {}}
            # absence can never be proven: id-listing queries fail
            (Path(tmp) / "fail").write_text("--filter id=")
            proc, out = self.drive_cleanup(Path(tmp), state)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("cleanup leftover", proc.stderr)
            self.assertTrue((out / "cleanup.leftovers.json").exists())
            # ownership records are kept for recovery, not deleted
            self.assertTrue((out / ".stack-creating").exists())
            calls = [json.loads(line) for line
                     in (Path(tmp) / "calls.log").read_text().splitlines() if line]
            self.assertTrue(calls)
            self.assertTrue(any(c[:1] == ["stop"] or c[:1] == ["rm"]
                                for c in calls))

    def test_cleanup_success_keeps_zero_rc(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = fresh_state()
            state["containers"]["cidobs0000001"] = {
                "name": "vcg12c-stubtrial-observer", "labels": {}}
            proc, out = self.drive_cleanup(Path(tmp), state)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertFalse((out / ".stack-creating").exists())
            calls = [json.loads(line) for line
                     in (Path(tmp) / "calls.log").read_text().splitlines() if line]
            self.assertTrue(any(c[:2] == ["rm", "-f"] for c in calls))

    def test_unreadable_built_record_never_reports_clean(self):
        # Root's no-docker stub replay: a partial build already produced
        # this run's private tags, but the built record is corrupt and no
        # container was created. Cleanup must exit nonzero (unverified),
        # keep the recovery records — including the corrupt built file and
        # the creating marker — and never fold the unknown into a clean {}.
        with tempfile.TemporaryDirectory() as tmp:
            state = fresh_state()  # the unrecorded tag "exists" in reality
            state["images"]["virtual-companion-runtime:vcg12c-stubtrial-ab12cd34"] = \
                "sha256:unknownleftover"
            proc, out = self.drive_cleanup(
                Path(tmp), state,
                skip_collectors=True,  # collectors never launched: optional
                capture_doc='{"project":"vcg12c-stubtrial","nonce":"n0",'
                            '"containers":[],"volumes":[],"networks":[]}',
                built_doc="{corrupt json")
            self.assertEqual(proc.returncode, 1)
            self.assertIn("built receipt record unreadable", proc.stderr)
            leftovers = json.loads((out / "cleanup.leftovers.json").read_text())
            self.assertTrue(leftovers["unverified"])
            # recovery clues are kept: marker, corrupt record, capture/nonce
            self.assertTrue((out / ".stack-creating").exists())
            self.assertTrue((out / "built-images.json").exists())
            self.assertTrue((out / "created-resources.json").exists())
            # and the unrecorded tag was never touched (no scan, no guess)
            calls = [json.loads(line) for line
                     in (Path(tmp) / "calls.log").read_text().splitlines() if line]
            self.assertFalse(any(c[:1] == ["rmi"] for c in calls))

    def test_attempted_launch_missing_receipt_is_unverified(self):
        # Root's deterministic counter-example: launch was attempted (the
        # run touched the marker), the record was lost, and a helper this
        # run created is still alive in the daemon. Cleanup must exit
        # nonzero, keep the marker/records, list the unknown, and never
        # touch the unrecorded helper (no scan, no adoption, no prefix rm).
        with tempfile.TemporaryDirectory() as tmp:
            state = fresh_state()
            state["containers"]["cidobs0000001"] = {
                "name": "vcg12c-stubtrial-observer", "labels": {}}
            proc, out = self.drive_cleanup(
                Path(tmp), state, skip_collectors=True, launch_attempted=True)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("launch was attempted", proc.stderr)
            leftovers = json.loads(
                (out / "cleanup.leftovers.json").read_text())
            self.assertTrue(any("launch was attempted" in m
                                for m in leftovers["unverified"]))
            self.assertTrue((out / ".stack-creating").exists())
            self.assertTrue((out / ".collectors-launched").exists())
            self.assertTrue((out / "created-resources.json").exists())
            calls = [json.loads(line) for line
                     in (Path(tmp) / "calls.log").read_text().splitlines() if line]
            self.assertFalse(any(c[:1] == ["stop"] or c[:2] == ["rm", "-f"]
                                 for c in calls))  # helper untouched
            state_now = json.loads((Path(tmp) / "state.json").read_text())
            self.assertIn("cidobs0000001", state_now["containers"])

    def test_unattempted_launch_missing_receipt_stays_clean(self):
        # Launch never attempted: a missing collectors record is optional —
        # valid empty capture/built stay a clean rc 0, and an unrelated
        # same-named helper (not ours, no record) is neither touched nor
        # able to turn the run dirty.
        with tempfile.TemporaryDirectory() as tmp:
            state = fresh_state()
            state["containers"]["cidobs0000001"] = {
                "name": "vcg12c-stubtrial-observer", "labels": {}}
            proc, out = self.drive_cleanup(Path(tmp), state,
                                           skip_collectors=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertFalse((out / ".stack-creating").exists())
            state_now = json.loads((Path(tmp) / "state.json").read_text())
            self.assertIn("cidobs0000001", state_now["containers"])
            self.assertEqual(json.loads(
                (out / "cleanup.leftovers.json").read_text()), {})


def stub_main(args):
    tmp = Path(os.environ["STUB_STATE"])
    state = json.loads((tmp / "state.json").read_text())
    fail = []
    fail_file = tmp / "fail"
    if fail_file.exists():
        fail = [fail_file.read_text().strip()]
    with open(os.environ["STUB_CALLS"], "a") as fh:
        fh.write(json.dumps(args) + "\n")
    result = docker_dispatch(state, args, fail)
    (tmp / "state.json").write_text(json.dumps(state))
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "__docker_stub__":
        sys.exit(stub_main(sys.argv[2:]))
    unittest.main(verbosity=2)
