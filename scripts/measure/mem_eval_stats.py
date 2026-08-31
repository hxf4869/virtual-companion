#!/usr/bin/env python3
"""MEM-EVAL (§26.4 / R45) statistics tool.

Reads Owner-filled annotation files and prints the §26.4 metrics against
their thresholds:
  --candidates FILE   TSV: sample_id,message,expected_label,owner_judged
                      (owner_judged ∈ grounded|not_grounded; Owner overwrites
                      the expected_label column after review)
                      Metric: Memory Precision = grounded-judged / total ≥90%
  --recall FILE       TSV: scenario_id,relationship,query,hint,judged_hit
                      (judged_hit ∈ hit|miss|wrong)
                      Metric: Recall Precision = hit / total ≥95%
  --resurrection N    delete-resurrection count from MEASURE phase 80 (must be 0)
  --cross-leak N      cross-relationship leaks from MEASURE phase 81 (must be 0)
Exit code 0 only when every supplied metric meets its threshold.
"""
import argparse
import csv
import sys


def load_tsv(path: str) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates")
    ap.add_argument("--recall")
    ap.add_argument("--resurrection", type=int)
    ap.add_argument("--cross-leak", type=int, dest="cross_leak")
    args = ap.parse_args()

    if not any((args.candidates, args.recall,
                args.resurrection is not None, args.cross_leak is not None)):
        ap.error("at least one metric is required")

    ok = True

    if args.candidates:
        rows = [r for r in load_tsv(args.candidates) if r.get("owner_judged")]
        grounded = sum(1 for r in rows if r["owner_judged"] == "grounded")
        precision = grounded / len(rows) if rows else 0.0
        meets = precision >= 0.90 and len(rows) >= 200
        ok &= meets
        print(f"Memory Precision: {precision:.1%} over {len(rows)} judged "
              f"(threshold ≥90%, n≥200) -> {'PASS' if meets else 'FAIL'}")

    if args.recall:
        rows = [r for r in load_tsv(args.recall) if r.get("judged_hit")]
        hits = sum(1 for r in rows if r["judged_hit"] == "hit")
        precision = hits / len(rows) if rows else 0.0
        meets = precision >= 0.95 and len(rows) >= 200
        ok &= meets
        print(f"Recall Precision: {precision:.1%} over {len(rows)} judged "
              f"(threshold ≥95%, n≥200) -> {'PASS' if meets else 'FAIL'}")

    if args.resurrection is not None:
        meets = args.resurrection == 0
        ok &= meets
        print(f"Delete Resurrection: {args.resurrection} "
              f"(threshold =0) -> {'PASS' if meets else 'FAIL'}")

    if args.cross_leak is not None:
        meets = args.cross_leak == 0
        ok &= meets
        print(f"Cross-Relationship Leaks: {args.cross_leak} "
              f"(threshold =0) -> {'PASS' if meets else 'FAIL'}")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
