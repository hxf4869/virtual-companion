#!/usr/bin/env python3
"""B1-COST (§25.9 / §22.19 / R45): 实际单位成本与供应商账单对账.

Inputs:
  --usage TSV     exported settled usage: columns date, generations,
                  input_tokens, output_tokens, settled_cost_usd
                  (produce with infra/db/measure/export-usage.sql against the
                  production/CI database)
  --bill TSV      provider invoice export: columns date, cost_usd
                  (one row per day, same currency)
Compares per-day settled cost against the bill, reports the absolute and
relative discrepancy, and fails (exit 1) when any day drifts beyond
--tolerance (default 5%) — 模拟口径 vs 真实账单的对账红线.
"""
import argparse
import csv
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--usage", required=True)
    ap.add_argument("--bill", required=True)
    ap.add_argument("--tolerance", type=float, default=0.05)
    args = ap.parse_args()

    with open(args.usage, newline="") as f:
        usage = {r["date"]: float(r["settled_cost_usd"])
                 for r in csv.DictReader(f, delimiter="\t")}
    with open(args.bill, newline="") as f:
        bill = {r["date"]: float(r["cost_usd"])
                for r in csv.DictReader(f, delimiter="\t")}

    days = sorted(set(usage) | set(bill))
    bad = []
    print(f"{'date':<12}{'settled':>12}{'billed':>12}{'drift':>10}")
    for d in days:
        u = usage.get(d, 0.0)
        b = bill.get(d, 0.0)
        drift = (abs(u - b) / b) if b > 0 else (0.0 if u == 0 else 1.0)
        flag = "" if drift <= args.tolerance else "  <-- OVER TOLERANCE"
        if flag:
            bad.append(d)
        print(f"{d:<12}{u:>12.4f}{b:>12.4f}{drift:>9.1%}{flag}")

    total_u = sum(usage.values())
    total_b = sum(bill.values())
    print(f"\nTOTAL settled={total_u:.4f} billed={total_b:.4f} "
          f"days={len(days)} over_tolerance={len(bad)}")
    if bad:
        print("RECONCILIATION FAIL")
        sys.exit(1)
    print("RECONCILIATION PASS")


if __name__ == "__main__":
    main()
