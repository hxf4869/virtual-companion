#!/usr/bin/env python3
"""MEM-EVAL (§26.4 / R45) sample-set generator.

Produces the annotation worksets the Owner fills in:
  candidates.tsv  ≥200 rows — memory-candidate precision samples
                  (columns: sample_id, message, expected_label[=PENDING for
                  Owner to judge grounded/not], owner_note)
  recall_scenarios.tsv ≥200 rows — recall-precision scenarios
                  (columns: scenario_id, relationship, query,
                  expected_memory_hint)

Deterministic output (fixed seed) so re-runs reproduce the same workset.
Usage: python3 gen_mem_eval_samples.py OUT_DIR
"""
import csv
import random
import sys
from pathlib import Path

random.seed(20260821)  # deterministic workset

TOPICS = ["工作压力", "搬家", "养猫", "夜跑", "学吉他", "戒咖啡", "装修", "考研",
          "相亲", "旅行计划", "健身", "读书会", "做饭", "游戏", "种花"]
FOODS = ["清蒸鱼", "辣火锅", "燕麦", "拿铁", "素菜", "海鲜", "面食"]
NICKS = ["小林", "阿凯", "老周", "大鹏", "小夏", "阿杰"]
SCHEDULES = ["早睡早起", "晚睡晚起", "习惯熬夜", "六点起床"]


def candidates(n: int = 220) -> list[dict]:
    rows = []
    for i in range(n):
        kind = i % 4
        if kind == 0:  # nickname preference (grounded)
            msg = f"以后请叫我{NICKS[i % len(NICKS)]}{i}号"
            expected = "grounded"
        elif kind == 1:  # food/drink preference (grounded)
            msg = f"喜欢吃{FOODS[i % len(FOODS)]}，不太能吃辣（{i}）"
            expected = "grounded"
        elif kind == 2:  # sleep schedule (grounded)
            msg = f"我{schedules(i)}，周末也一样（{i}）"
            expected = "grounded"
        else:  # vague chatter (Owner judges; seed says not-grounded)
            msg = f"今天聊到{TOPICS[i % len(TOPICS)]}的话题，感觉还行（{i}）"
            expected = "not_grounded"
        rows.append({"sample_id": f"C{i + 1:04d}", "message": msg,
                     "expected_label": expected, "owner_note": ""})
    return rows


def schedules(i: int) -> str:
    return SCHEDULES[i % len(SCHEDULES)]


def recall_scenarios(n: int = 220) -> list[dict]:
    rows = []
    for i in range(n):
        topic = TOPICS[i % len(TOPICS)]
        food = FOODS[i % len(FOODS)]
        if i % 2 == 0:
            q, hint = f"我之前说过{topic}相关的事吗", f"{topic}场景记忆"
        else:
            q, hint = f"我爱吃什么来着", f"{food}偏好记忆"
        rows.append({"scenario_id": f"R{i + 1:04d}", "relationship":
                     "rel-A" if i % 3 else "rel-B",
                     "query": q, "expected_memory_hint": hint})
    return rows


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    with (out / "candidates.tsv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["sample_id", "message",
                                          "expected_label", "owner_note"],
                           delimiter="\t")
        w.writeheader()
        w.writerows(candidates())
    with (out / "recall_scenarios.tsv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["scenario_id", "relationship",
                                          "query", "expected_memory_hint"],
                           delimiter="\t")
        w.writeheader()
        w.writerows(recall_scenarios())
    print(f"workset written to {out.resolve()} "
          f"(candidates.tsv≥200, recall_scenarios.tsv≥200)")


if __name__ == "__main__":
    main()
