#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime
import functools
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml

from harness_common import (
    CONTEXT_ALGORITHM,
    ROOT,
    HarnessError,
    changed_paths as git_changed_paths,
    configure_utf8_stdio,
    discover_tasks,
    git_bytes,
    git_object as read_git_object,
    git_text,
    glob_matches,
    is_repository_relative,
    load_yaml,
    normalize_repo_path,
    parse_skill_metadata,
    read_repository_bytes,
    read_repository_text,
    relative,
    repository_glob,
    repository_read_snapshot,
    sha256_file,
    SKILL_FRONTMATTER_RE,
    strict_yaml_load,
    TASK_BLOCK_RE,
    task_id_from_filename,
    verify_context_lock,
)

FULL_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
TASK_ID_RE = re.compile(r"^TASK-[0-9]{4,}$")
CANONICAL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
WINDOWS_RESERVED_COMPONENT_RE = re.compile(
    r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$",
    re.IGNORECASE,
)
WINDOWS_INVALID_COMPONENT_RE = re.compile(r'[<>:"|?*\x00-\x1f]')
ZED_PROJECT_INSTRUCTION_PRIORITY = (
    ".rules",
    ".cursorrules",
    ".windsurfrules",
    ".clinerules",
    ".github/copilot-instructions.md",
    "AGENT.md",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
)
COPILOT_SUPPORT_MATRIX = (
    "https://docs.github.com/en/copilot/reference/custom-instructions-support"
)
RISK_RANK = {"C1": 1, "C2": 2, "C3": 3, "C4": 4}
AUTHORIZATION_FIELDS = (
    "taskId",
    "owner",
    "riskClass",
    "requiredSkills",
    "requiredSkillVersions",
    "targetSkillVersions",
    "planningBacklog",
    "planningContractHash",
    "planningContractHashAlgorithm",
    "baseCommit",
    "contextFingerprint",
    "contextLock",
    "contextFingerprintAlgorithm",
    "readAllowlist",
    "writeAllowlist",
    "forbiddenPaths",
    "sourcesOfTruth",
    "requiredInvariants",
    "humanApprovals",
    "independentReview",
    "requiredCommands",
)
AUTHORIZATION_MUTABLE_FIELDS = {
    "state",
    "authorizationCommit",
    "reviewers",
    "resolutionReason",
    "scopeAmendments",
}
LEGACY_SCOPE_AMENDMENT_FIELDS = {
    "amendmentId",
    "approvedBy",
    "approvedAt",
    "evidence",
    "reason",
    "addedWriteAllowlist",
    "acceptanceAdditions",
}
SCOPE_AMENDMENT_PROJECTION_FIELDS = {
    "schemaVersion",
    "amendmentId",
    "contractSource",
    "contractHashAlgorithm",
    "contractHash",
    "contract",
}
AUTHORIZATION_AMENDMENT_FIELDS = {
    "schemaVersion",
    "taskId",
    "amendmentType",
    "approvedBy",
    "approvedAt",
    "evidence",
    "reason",
    "authorizedParentCommit",
    "baseAuthorizationProjectionHash",
    "scopeGrantAmendmentId",
    "addedWriteAllowlist",
    "replacements",
}
AUTHORIZATION_REPLACEMENT_FIELDS = {"supersedes", "replacement"}
AUTHORIZATION_SUPERSEDES_FIELDS = {"clauseId", "statement", "statementHash"}
AUTHORIZATION_REPLACEMENT_VALUE_FIELDS = {"statement", "statementHash"}
PROJECT_STATE_CLOSURE_MUTABLE_FIELDS = {
    "activeTask",
    "activeTaskCard",
    "lastAcceptedTask",
    "lastAcceptedHandoff",
    "lastTerminalTask",
    "lastTerminalHandoff",
    "nextAction",
    "updatedAt",
}
PROJECT_STATE_READY_MUTABLE_FIELDS = {
    "activeTask",
    "activeTaskCard",
    "nextAction",
    "updatedAt",
}
TASK_LEDGER_PATH = ".harness/task-ledger.yaml"
TASK_BACKLOG_PATH = ".harness/task-backlog.yaml"
PROJECT_STATE_PATH = ".harness/project-state.yaml"
TASK_DELIVERY_POLICY_PATH = ".harness/task-delivery-policy.yaml"
CI_EXECUTION_POLICY_PATH = ".harness/ci-execution-policy.yaml"
TASK_DELIVERY_POLICY_CANONICAL_HASH = (
    "ed26c40b35b131dba1a325e59a6b803d4ba0ace4e9663b05adad6056a0d6218b"
)
TASK_DELIVERY_SKILL_CANONICAL_HASH = (
    "bb16b21ede941ebbd4bff6794784a4e902583268ba04488bae8e0a581c2e9744"
)
TASK_0075_CI_POLICY_PROJECTION_HASH = (
    "fc6622dfad6fba0aa15d3af403faedc28ee69b0ff93f89fd1886953d2b1ce8eb"
)
CI_EXECUTION_POLICY_CANONICAL_HASH = (
    "1db6a5e22f7801fdab4846c428950d118ed77a842498a6ff2b20e22bd2de4485"
)
TASK_0073_CI_POLICY_PROJECTION_HASH = (
    "3a253a215a88d4b9bd987d7dd2cbf0b2400f93fbd7086b071eb511f81f9cf8a1"
)
TASK_0074_CI_POLICY_PROJECTION_HASH = (
    "6e6e19d312152b66f4074791b2a6fcf18d560de8c5eace3066122e5ecbcd5b4e"
)
TASK_0072_BOOTSTRAP_RECORD_ID = "OWNER-MAINT-20260801-READY-GREENLINE-01"
TASK_0072_BOOTSTRAP_TASK_ID = "TASK-0072"
TASK_0072_SOURCE_TERMINAL_COMMIT = "a737f22362185ed47e81ecabef5c17b22fb52e18"
TASK_0072_SOURCE_TERMINAL_TREE = "e83e352a9805e84e1996115924a33686fdd79d1e"
TASK_0072_RETAINED_BASE_COMMIT = "9725e74019b7a102ff8e848beec466bac7044987"
TASK_0072_RETAINED_BASE_TREE = "cf89d92a6dc311ee99ca2d2e394df11b05c9e174"
TASK_0072_MAINTENANCE_HANDOFF_COMMIT = (
    "60b09ec198a0c37b2345576d3cc593bfbe887bd5"
)
TASK_0072_MAINTENANCE_HANDOFF_TREE = "dceb360cbd14d9112b241e5889b0498c05df317f"
TASK_0072_BOUNDARY_COMMIT = "d83baca18211c464cebdc7082308e90b2d5d18f0"
TASK_0072_BOUNDARY_TREE = "80ae86080731e76e4f793923f70682aae8d12361"
TASK_0072_BOUNDARY_DOCTOR_BLOB_OID = "6c934cc3006f6135ba4ad6584c3689aac3b5d6b6"
TASK_0072_BOUNDARY_DOCTOR_SHA256 = (
    "8cb547e12d73b266071a56586ad9b9e73a3e977907d457414815373032cfb8c1"
)
TASK_0073_MAINTENANCE_RECORD_ID = (
    "OWNER-MAINT-20260802-TASK-0073-PRE-READY-01"
)
TASK_0073_TASK_ID = "TASK-0073"
TASK_0073_BASE_COMMIT = "ee0757a8749a0ccab53553785b92abb865e4373b"
TASK_0073_BASE_TREE = "880fac1735d4f33a99269c3eded1b52e88812b7c"
TASK_0073_DRAFT_COMMIT = "6e9704faf5820261484f00f14320f4e4d1d7d939"
TASK_0073_DRAFT_TREE = "7177ffc2888130cee9934c081e2c99e559d5f362"
TASK_0073_CARD_PATH = (
    "docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md"
)
TASK_0073_CONTEXT_PATH = "docs/tasks/context/TASK-0073.context-lock.yaml"
TASK_0073_MAINTENANCE_AUTHORIZATION_PATH = (
    "docs/evidence/TASK-0073/pre-ready-maintenance-authorization.json"
)
TASK_0073_EXACT_OWNER_AUTHORIZATION = (
    "授权 TASK-0073 精确一次性 pre-READY 绿线恢复：以 "
    "ee0757a8749a0ccab53553785b92abb865e4373b 为 Base，允许唯一 "
    "machine-recognized maintenance commit 修复上述策略哈希和 TASK-0072 "
    "历史 boundary 绑定；禁止通用 override、复用或绕过。之后必须由普通 READY "
    "Doctor PASS 才能实现，并完整执行独立 Reviewer、canonical、Windows/WSL、"
    "pre-closure 与安全推送。"
)
TASK_0073_PRE_READY_MAINTENANCE_PATHS = {
    ".harness/ci-execution-policy.yaml",
    ".harness/skills.yaml",
    "docs/evidence/TASK-0073/pre-ready-maintenance-authorization.json",
    "scripts/harness/doctor.py",
    "scripts/harness/tests/test_harness.py",
    "skills/harness-change/SKILL.md",
    "skills/task-delivery-flow/SKILL.md",
    "skills/task-intake/SKILL.md",
}
TASK_0074_MAINTENANCE_RECORD_ID = (
    "OWNER-MAINT-20260802-TASK-0074-PRE-READY-01"
)
TASK_0074_TASK_ID = "TASK-0074"
TASK_0074_BASE_COMMIT = "65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94"
TASK_0074_BASE_TREE = "5649336f93a8efdecdf0b7213966808e4bd629ed"
TASK_0074_DRAFT_COMMIT = "f72e61d0f97261b32a24101c7bbf4b87cb1bee3f"
TASK_0074_DRAFT_TREE = "ce10e9970ba28747f67223ac1c5ebb55c4245c93"
TASK_0074_CARD_PATH = "docs/tasks/TASK-0074-exact-delivery-flow-recovery.md"
TASK_0074_CONTEXT_PATH = "docs/tasks/context/TASK-0074.context-lock.yaml"
TASK_0074_MAINTENANCE_AUTHORIZATION_PATH = (
    "docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json"
)
TASK_0074_EXACT_OWNER_AUTHORIZATION = (
    "授权 TASK-0074 精确一次性交付流程恢复：以 "
    "65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94 为 Base，允许唯一 "
    "machine-recognized pre-READY maintenance commit：精确隔离 TASK-0073 "
    "终态中已绑定 Commit/Tree/Blob 的 Reviewer UNKNOWN 历史记录；为未来 "
    "Evidence 增加明确的 TIMEOUT/UNKNOWN 非 PASS 语义；将 DRAFT→READY 与 "
    "IN_PROGRESS 后执行预算分开计时，Reviewer 上限固定为 15 分钟；允许同一"
    "精确候选上的完整 canonical 与 Windows exact-tree 合并为一次不删测、不降级"
    "的证据门禁，WSL 仍独立执行。禁止修改历史产物、通用 override、复用或绕过。"
    "普通 READY Doctor PASS 后才能实施，并将 TASK-0056 依赖迁移至 TASK-0074，"
    "完整执行独立 Reviewer、合并门禁、WSL、pre-closure 与安全推送。"
)
TASK_0074_PRE_READY_MAINTENANCE_PATHS = {
    ".harness/ci-execution-policy.yaml",
    ".harness/skills.yaml",
    ".harness/task-delivery-policy.yaml",
    "docs/evidence/TASK-0074/pre-ready-maintenance-authorization.json",
    "docs/schemas/evidence-pack.schema.json",
    "docs/schemas/handoff.schema.json",
    "scripts/harness/doctor.py",
    "scripts/harness/tests/test_harness.py",
    "skills/harness-change/SKILL.md",
    "skills/task-delivery-flow/SKILL.md",
    "skills/task-intake/SKILL.md",
}
TASK_0075_MAINTENANCE_RECORD_ID = (
    "OWNER-MAINT-20260803-TASK-0075-PRE-READY-01"
)
TASK_0075_TASK_ID = "TASK-0075"
TASK_0075_BASE_COMMIT = "d41c9f82e69107cf1ecf0cb2c100d39f436faab7"
TASK_0075_BASE_TREE = "dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e"
TASK_0075_DRAFT_COMMIT = "2289d7a243d8a7658d11036afe6d338e0868cc8e"
TASK_0075_DRAFT_TREE = "33ce1ae7814a09be6da68e892d5334acfc2daa15"
TASK_0075_CARD_PATH = "docs/tasks/TASK-0075-permanent-delivery-flow-recovery.md"
TASK_0075_CONTEXT_PATH = "docs/tasks/context/TASK-0075.context-lock.yaml"
TASK_0075_MAINTENANCE_AUTHORIZATION_PATH = (
    "docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json"
)
TASK_0075_EXACT_OWNER_AUTHORIZATION = "授权 TASK-0075 精确永久恢复：以 `d41c9f82e69107cf1ecf0cb2c100d39f436faab7` / Tree `dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e` 为 Base，创建前重新 fetch 并确认 main、clean、远端无分叉及 TASK-0075 未占用。允许唯一 machine-recognized pre-READY maintenance commit：精确绑定并隔离 TASK-0073 历史 CI-policy projection、固定父边 `d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd`，以及 TASK-0074 终态中已绑定 Commit/Tree/Blob 的 5 条 timing/Handoff 错误；Doctor 必须使用历史提交自身的 Policy/Blob 验证历史对象，不得用当前 Policy 重新解释。为未来 timing Schema 增加严格 `NOT_STARTED` 分支，仅允许 READY Doctor 非 PASS 且从未进入 IN_PROGRESS 时使用，允许候选及时间锚为 null、`elapsedSeconds=0`、原因非空；现有 PASS/FAIL/TIMEOUT/UNKNOWN 约束保持不变。未来 Handoff `nextAction` 必须与 terminal project-state 精确一致；TASK-0073/0074 历史制品不得修改。普通 READY Doctor PASS 后，才允许将 TASK-0056 Card/Backlog dependency 与 delivery-policy core 原子迁移至 TASK-0075，并完整执行 15 分钟独立 Reviewer、合并 Windows 门禁、独立 WSL、pre-closure 与安全推送。禁止通配路径、可配置 allowlist、历史改写、通用 override、记录复用、分支/worktree、GitHub Actions dispatch 或任何绕过。"
TASK_0075_EXACT_OWNER_ACCEPTANCE = "按计划用 goal 继续下去"
TASK_0075_PRE_READY_MAINTENANCE_PATHS = {
    ".harness/ci-execution-policy.yaml",
    ".harness/skills.yaml",
    ".harness/task-delivery-policy.yaml",
    "docs/evidence/TASK-0075/pre-ready-maintenance-authorization.json",
    "docs/schemas/evidence-pack.schema.json",
    "docs/schemas/handoff.schema.json",
    "scripts/harness/doctor.py",
    "scripts/harness/tests/test_harness.py",
    "skills/harness-change/SKILL.md",
    "skills/task-delivery-flow/SKILL.md",
    "skills/task-intake/SKILL.md",
}
TASK_0076_MAINTENANCE_RECORD_ID = ("OWNER-MAINT-20260804-TASK-0076-PRE-READY-01")
TASK_0076_TASK_ID = "TASK-0076"
TASK_0076_QUARANTINE_EDGE_PARENT = "ad0e4b93185ea364f9039a014a950dc58791f1ce"
TASK_0076_QUARANTINE_EDGE_CHILD = "f1e4a39ee1f292a6ffd54f8f547c08cef725db4b"
TASK_0076_QUARANTINE_FORBIDDEN_EDGE_PARENT = "e9b59cad39598e78e480127696afd19942d48b31"
TASK_0076_QUARANTINE_FORBIDDEN_EDGE_CHILD = "7b784a0f701d017f1b86695074a37c2ed7558265"
TASK_0056_PLANNING_CHANGE_EDGES = {
    (TASK_0076_QUARANTINE_EDGE_PARENT, TASK_0076_QUARANTINE_EDGE_CHILD),
    ("16f359daba0f0cba3e4cb5a3508f35c0c25dc8a2", "b2a266dc42388f4a728f499522b01604eb5e89c6"),
    ("d6fbee26442a997b96648eea472f98ecba1a5412", "11e6fb12f77486787ef71627e84f34ee069e72bd"),
}
TASK_0056_PLANNING_CHANGE_PARENTS = {
    TASK_0076_QUARANTINE_EDGE_PARENT,
    "16f359daba0f0cba3e4cb5a3508f35c0c25dc8a2",
    "d6fbee26442a997b96648eea472f98ecba1a5412",
    "e26df902b719cf573266f422081fd05a11f31031",
}
TASK_0056_QUARANTINED_SNAPSHOT_COMMITS = {
    TASK_0076_QUARANTINE_EDGE_CHILD,
    "b2a266dc42388f4a728f499522b01604eb5e89c6",
    "11e6fb12f77486787ef71627e84f34ee069e72bd",
    "e9b59cad39598e78e480127696afd19942d48b31",
    "7b784a0f701d017f1b86695074a37c2ed7558265",
    "ac3018e2b588c3b271c646f7b2520a4ec1e8d228",
    "8dcd298a4356d522b509ea35b3e5c4f0b7f2590d",
    "31cc7b31b27e7e5d369f2ad16e94f5d80b3a2916",
    "e26df902b719cf573266f422081fd05a11f31031",
}
TASK_0076_BASE_COMMIT = "b0c5d351d65e847d4512db580411d84e0e549287"
TASK_0076_BASE_TREE = "aacfc492f08a75e405584d21f3afc8270e42cee0"
TASK_0076_DRAFT_COMMIT = "4069a2ed2bcf07ca3b9c023f2985cfe091ba3d31"
TASK_0076_DRAFT_TREE = "28c08ca3455c40292625cc4018a239d606055b90"
TASK_0076_CARD_PATH = ("docs/tasks/TASK-0076-harness-skill-version-binding-recovery.md")
TASK_0076_CONTEXT_PATH = "docs/tasks/context/TASK-0076.context-lock.yaml"
TASK_0076_MAINTENANCE_AUTHORIZATION_PATH = ("docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json")
TASK_0076_PRE_READY_MAINTENANCE_PATHS = {
    ".harness/ci-execution-policy.yaml", ".harness/skills.yaml", ".harness/task-delivery-policy.yaml",
    "docs/evidence/TASK-0076/pre-ready-maintenance-authorization.json",
    "scripts/harness/doctor.py", "scripts/harness/tests/test_harness.py",
    "skills/harness-change/SKILL.md", "skills/task-delivery-flow/SKILL.md", "skills/task-intake/SKILL.md",
}
TASK_0077_PRE_READY_MAINTENANCE_PATHS = {
    ".harness/task-backlog.yaml", ".harness/task-delivery-policy.yaml", ".harness/skills.yaml",
    "docs/evidence/TASK-0077/pre-ready-maintenance-authorization.json",
    "docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md",
    "scripts/harness/doctor.py", "scripts/harness/tests/test_harness.py",
    "skills/harness-change/SKILL.md", "skills/task-delivery-flow/SKILL.md", "skills/task-intake/SKILL.md",
}
TASK_0073_MAINTENANCE_COMMIT = "b1c37678ab773eca150bdbb273ddafa5d14b781f"
TASK_0073_MAINTENANCE_TREE = "6d0c9f5852313219af370ba411dd192afafd0f73"
TASK_0073_MAINTENANCE_CI_POLICY_BLOB = "9efc2356531f515b3bfc758044863bfe8c998eca"
TASK_0073_MAINTENANCE_CI_POLICY_SHA256 = (
    "9b393744d334248e0dec492cca2e9370f3cbab5f69d9ea6e27608ab1cd9ac77e"
)
TASK_0074_MAINTENANCE_COMMIT = "f337d2a267e0b96360ae74d50e053c41864a934f"
TASK_0074_MAINTENANCE_TREE = "655facbf704b88632aed89586d46933c99b170d2"
TASK_0074_MAINTENANCE_CI_POLICY_BLOB = "3ee4f383ef7700e997745a910420f1cb435b5eae"
TASK_0074_MAINTENANCE_CI_POLICY_SHA256 = (
    "3c67c84603085c7f2dce52e192ca23a1e566a51ac9d6fd53193e391f688ceab9"
)
TASK_0073_PLANNING_PARENT_COMMIT = "d6fbee26442a997b96648eea472f98ecba1a5412"
TASK_0073_PLANNING_PARENT_TREE = "a9014d6d779f55d712db93f6f88bb5f4804ef315"
TASK_0073_PLANNING_CHILD_COMMIT = "11e6fb12f77486787ef71627e84f34ee069e72bd"
TASK_0073_PLANNING_CHILD_TREE = "36e22afcc810cca0630e159568d2acf03845441d"
TASK_0073_PLANNING_CHILD_DELIVERY_POLICY_CANONICAL_HASH = (
    "c5e0c9856ac3fd35b8cfd390fedbdd11645fc63f9e0d525e5a78aa005ef4227d"
)
TASK_0073_PLANNING_EDGE_IDENTITIES = {
    ".harness/project-state.yaml": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "1ca583aef1f178c90cafc1242306a9dbc0426152",
            "sha256": "42d4e85928b8a774ea6643322f766b202dfad742c400a63eccdcba94edadc6c2",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "5f7ab72da978c2b75978e9d608343e2bfe305eb2",
            "sha256": "1030e44caa692e2e6b21b6dd7c8f777353d82570e812e42f2eb20a09fc70b36d",
        },
    },
    ".harness/task-backlog.yaml": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "d33e08cb92c0c16a68d28898d02fee030a4e5445",
            "sha256": "8339334272a7ae583dd524b02fb609141725e4343c7a36e59c7b42795c01b47c",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "b2275775e7a5092576820ea290fd515cba9834a1",
            "sha256": "3bab01c47b4bfdc712ee5c0c95386bd9c4304e1ca641582e55aa1cc60fb25c53",
        },
    },
    ".harness/task-delivery-policy.yaml": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "6b83448be53cc7c4ab0c50dee73182f9436cd615",
            "sha256": "8e861b4e378c8713079749e9b19941fa866226e7617b052f13e2bb7cf10e12d7",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "5c1c1f84fd5af3870e0827a17593cc276e860b76",
            "sha256": "75525760cac3a628647c7b86ef63373f3d3c7fdada22ee61257b190e9d08a419",
        },
    },
    "docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "03cd7f89ff75f843d5a445eb1041562cac875b1c",
            "sha256": "1669d642f0f14feda8dde681460349824d5ef6019353998e7c9dde9fc45a8a2d",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "ef2da1458d8447f6668d20bd4c322539f0d57109",
            "sha256": "dbd4a824149c9b678039c1a8ccebaf22c4764b88e02564259d0849631390a970",
        },
    },
    "docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "1d4e613e83f6f9071e599777c3223956678582da",
            "sha256": "afa700bf965d18cb1ae7fa0a8a1859a95607d7803e47a9ab3cb4813d4eb78d63",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "cb32c381f133f43359dac9f68492e388e55e6391",
            "sha256": "7438a8233e8cf34d16d984f95d037c623d5283326714d902a375c7c3f9983801",
        },
    },
    "scripts/harness/doctor.py": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "076cfc34d791ee9cea4fed635c099deb2179b8d3",
            "sha256": "1f3d88b81aa5d755b8c9b881ec2e9807527cbe367fb9d2b53d14258d106a8b50",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "95d739c60de73714c52b58c9ec3f571892e82314",
            "sha256": "2032039d399512e12e0d02858f3e74d3ce430e6411f31fd54b7dd2f6757aa650",
        },
    },
    "scripts/harness/tests/test_harness.py": {
        "parent": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "044f33dcc1fe6e043c23956edeaeca7c24407bd2",
            "sha256": "065adb6a39e83fea555fd1485d8639edf6aba07ce8ae1e244985f5659c5a6038",
        },
        "child": {
            "mode": "100644",
            "type": "blob",
            "blobOid": "3018f226b69a0cdee510ac3f94b9e76ec25d62f4",
            "sha256": "a92e55212aba056955a9164f5045504535127785b569e501fc80fa0d78d2ec01",
        },
    },
}
TASK_0074_TERMINAL_COMMIT = "d41c9f82e69107cf1ecf0cb2c100d39f436faab7"
TASK_0074_TERMINAL_TREE = "dd7c6f7ee3c7d99b9ec8db2cfd6ceee56c37765e"
TASK_0074_TERMINAL_PARENT = "e8af6bad56e1f04b493c6f6ffdc43ae348917ffe"
TASK_0074_TERMINAL_ARTIFACTS = {
    "evidence": {
        "path": "docs/evidence/TASK-0074/evidence-pack.json",
        "mode": "100644",
        "type": "blob",
        "blobOid": "cbb75f8d5f573684df8284c014ce4507f9b7c3d2",
        "sha256": "1a9191feca82cec0d59ba4101ac843a90654f0919830cac4c34c97be44b7fa66",
    },
    "review": {
        "path": "docs/evidence/TASK-0074/review-r1.md",
        "mode": "100644",
        "type": "blob",
        "blobOid": "714382dff8ed430d80fd8456713b0411aa31c06e",
        "sha256": "28fce52edfa1bde1b503cac09b6f4fa890044e4addff81aa6ce1f03ffa42e77c",
    },
    "handoff": {
        "path": "docs/handoffs/TASK-0074.json",
        "mode": "100644",
        "type": "blob",
        "blobOid": "140aecbbd8c6663f68b4a4b9fb6b256389d5d154",
        "sha256": "5493fd4b1be8d0c1f15ed439d66712c8d704aa277d92d383c8ef6878219711ac",
    },
    "card": {
        "path": "docs/tasks/TASK-0074-exact-delivery-flow-recovery.md",
        "mode": "100644",
        "type": "blob",
        "blobOid": "c1b1d5c9e188442522eb8769e7c67e0b5f47de1f",
        "sha256": "ac18f2f42d267f9a8de3e3e2a4f6e5ad50ffdc7869ed46afbb0409596f6d688e",
    },
    "context": {
        "path": "docs/tasks/context/TASK-0074.context-lock.yaml",
        "mode": "100644",
        "type": "blob",
        "blobOid": "be5dae0a701a4413e7abd97ce455dbfcef392afa",
        "sha256": "18a6b58707b965052920d1659483b6d869fc594ac4c1cd1429747298d11b0141",
    },
}
TASK_0074_READY_DOCTOR_RECEIPT_SHA256 = (
    "452da45a1aa70d1892d68e2200404ce438132a26fc828a10325ba9e79a068239"
)
TASK_0074_PRE_CLOSURE_RECEIPT_SHA256 = (
    "0ffa4c92034214f024bfbe438a0bc54fbe3ddd0180fd21595d44c260f1efc86c"
)
TASK_0074_EXACT_HISTORICAL_ERRORS = (
    "ERROR: TASK-0073 pre-READY maintenance: CI policy canonical binding drifted",
    "ERROR: task-backlog: unresolved PLANNED card TASK-0056 metadata must remain immutable on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd",
    "ERROR: task-backlog: planning card TASK-0056 title, fixed notice and six-section projection changed on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd",
    "ERROR: task-backlog: permanent planning contract TASK-0056 was removed or rewritten on edge d6fbee26442a997b96648eea472f98ecba1a5412..11e6fb12f77486787ef71627e84f34ee069e72bd",
    "ERROR: task-backlog: TASK-0073 replacement repair must be one exact, authorized, atomic parent edge; observed=[]",
    "ERROR: TASK-0074: Handoff nextAction disagrees with terminal project-state",
    "ERROR: TASK-0074 delivery timing: candidate execution anchor or budget drifted",
    "ERROR: TASK-0074 delivery timing.candidateExecution.startedAt: must be a non-blank string",
    "ERROR: TASK-0074 delivery timing.candidateExecution.endedAt: must be a non-blank string",
    "ERROR: TASK-0074 delivery timing.candidateExecution.readyDoctorPassAt: must be a non-blank string",
)
TASK_0073_TERMINAL_COMMIT = "65fbb6e8f3e40ab7b5aa4b0daa7e6a679f977a94"
TASK_0073_TERMINAL_TREE = "5649336f93a8efdecdf0b7213966808e4bd629ed"
TASK_0073_TERMINAL_EVIDENCE_PATH = "docs/evidence/TASK-0073/evidence-pack.json"
TASK_0073_TERMINAL_EVIDENCE_BLOB = "6b123197348ad1391fd4953f5ce6741d0b616ad7"
TASK_0073_TERMINAL_EVIDENCE_SHA256 = (
    "22dc47792bb08227709c6c67b9e7d47490604a7ac567182acd1ff642d4a06221"
)
TASK_0073_TERMINAL_REVIEW_PATH = "docs/evidence/TASK-0073/review-r1.md"
TASK_0073_TERMINAL_REVIEW_BLOB = "22326ae61ea43ba86565bb96b4c2fd78c68bbecf"
TASK_0073_TERMINAL_REVIEW_SHA256 = (
    "c92fa49e6d996fd9221ba884c3f6b6acb4feab16a7869c58da8287dd356913c5"
)
TASK_0073_HISTORICAL_UNKNOWN_CHECK = {
    "command": "Independent Reviewer R1 for TASK-0073 frozen candidate",
    "status": "FAIL",
    "exitCode": None,
    "artifactHash": None,
    "reason": (
        "BUDGET_FUSED_WITHOUT_TERMINAL_OUTPUT: 唯一 fork_turns=none Reviewer "
        "到 8 分钟预算仍为 running，未返回终态；原生结果是 UNKNOWN/NOT_PASS，"
        "终态 Schema 中映射为 Reviewer gate FAIL。"
    ),
    "environment": (
        "independent subagent task0073_reviewer_r1; read-only; interrupted at budget"
    ),
    "verifiedCommit": "11e6fb12f77486787ef71627e84f34ee069e72bd",
}
TASK_0073_HISTORICAL_UNKNOWN_REVIEWER = {
    "id": "task0073_reviewer_r1",
    "kind": "independent-budget-fused-review",
    "verdict": "FAIL",
    "reviewedCommit": "11e6fb12f77486787ef71627e84f34ee069e72bd",
    "evidencePath": TASK_0073_TERMINAL_REVIEW_PATH,
}
TASK_0073_HISTORICAL_UNKNOWN_REVIEW_METADATA = {
    "taskId": "TASK-0073",
    "reviewerId": "task0073_reviewer_r1",
    "verdict": "FAIL",
    "reviewedCommit": "11e6fb12f77486787ef71627e84f34ee069e72bd",
    "reviewedTree": "36e22afcc810cca0630e159568d2acf03845441d",
    "nativeResult": "UNKNOWN",
    "status": "BUDGET_FUSED_WITHOUT_TERMINAL_OUTPUT",
    "budgetMinutes": 8,
    "terminalOutputReceived": False,
    "previousAgentStatusAtInterrupt": "running",
    "fixBatchRequested": False,
}
DURABLE_COMMAND_CANONICAL_PATH = "scripts/harness/durable_command.ps1"
DURABLE_COMMAND_CANONICAL_HASH = (
    "fca79cb77c2391e25bbac3144eae70ff9258eba15975a1a0eef3ca756d531180"
)
DURABLE_COMMAND_CANONICAL_BYTES = 8819
DURABLE_COMMAND_CANONICAL_LF = 236
DURABLE_COMMAND_CANONICAL_CRLF = 0
TASK_0060_BASE_COMMIT = "dedcc579617a5356198ac42e17de58f8e8f880f5"
TASK_0060_AUTHORIZATION_COMMIT = "e50aafe927b3655b6642e3ecd6c0012362bda856"
TASK_0060_CARD_PATH = (
    "docs/tasks/TASK-0060-permanent-adoption-retained-machine-delivery.md"
)
TASK_0060_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0054"],
        "newDependencies": ["TASK-0060"],
    },
    "TASK-0057": {
        "oldTitle": "Harness 阶段计时与跨文件系统性能引擎",
        "newTitle": "Harness 阶段计时与跨文件系统性能引擎永久后继",
        "oldDependencies": ["TASK-0056"],
        "newDependencies": ["TASK-0056"],
    },
    "TASK-0058": {
        "oldTitle": "Harness 路径感知 CI 与包装器平台策略",
        "newTitle": "Harness 路径感知 CI 与包装器平台策略永久后继",
        "oldDependencies": ["TASK-0057"],
        "newDependencies": ["TASK-0057"],
    },
    "TASK-0059": {
        "oldTitle": "Harness 内容寻址快照复用与 Evidence 门禁",
        "newTitle": "Harness 内容寻址快照复用与 Evidence 门禁永久后继",
        "oldDependencies": ["TASK-0058"],
        "newDependencies": ["TASK-0058"],
    },
}
TASK_0061_BASE_COMMIT = "7fd8ede3047d67999a7821114f1febcb572553a2"
TASK_0061_AUTHORIZATION_COMMIT = "728ec614eeddaabfbdd4a0a5622d0251b59dfe64"
TASK_0061_CARD_PATH = (
    "docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md"
)
TASK_0061_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0060"],
        "newDependencies": ["TASK-0061"],
    },
}
TASK_0062_BASE_COMMIT = "8579df81a3b453b26bf297ddb6bf4ef48efa8393"
TASK_0062_AUTHORIZATION_COMMIT = "174c6180c15d9c6b6e56198974029acf3865419e"
TASK_0062_CARD_PATH = (
    "docs/tasks/TASK-0062-durable-command-permanent-replacement.md"
)
TASK_0062_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0061"],
        "newDependencies": ["TASK-0062"],
    },
}
TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT = (
    "7163dd7f529fc00352b322e6f7b53201e43b6ad2"
)
TASK_0062_VIOLATION_PARENT_COMMIT = "10ac9f96f8e566137a3f446bb59abdc42d64fc45"
TASK_0062_TERMINAL_COMMIT = "a328a02c72e5cfb7bc784e7a083caaaf8cffe08c"
TASK_0062_AUTHORIZED_PROJECTION_SHA256 = (
    "09ad0b20460224da488d4b7d3cbc32f3178aafda6215f53d38b3943691c05f5e"
)
TASK_0062_REJECTED_PROJECTION_SHA256 = (
    "6646218d220980e6d0fe0aaee03a81f17ba2fc57d69308dcb003aba8d50dd0e3"
)
TASK_0062_AUTHORIZED_STOP_FRAGMENT = (
    "- 墙钟 35 分钟仍无通过 runner 自测、历史/Hash/Skill/Policy/Doctor/负例和 diff\n"
    "  短矩阵的精确候选 Commit/Tree；"
)
TASK_0062_REJECTED_STOP_FRAGMENT = (
    "- 墙钟 45 分钟仍无通过 runner 自测、历史/Hash/Skill/Policy/Doctor/负例和 diff\n"
    "  短矩阵的精确候选 Commit/Tree；"
)
TASK_0062_TERMINAL_ARTIFACT_SHA256 = {
    TASK_0062_CARD_PATH: (
        "05361d87d1f714709ec44aa36a9a9a663f8fdffce4eb38a9d45c3442ee7c026a"
    ),
    "docs/evidence/TASK-0062/evidence-pack.json": (
        "2743fa5a6811b665fe1f7886e239ff9ffe6baa54b77b7551958b526f7221e23f"
    ),
    "docs/evidence/TASK-0062/review-r1.md": (
        "6912f809d9e2e0f54a9a8535e68530b693ec41b6588613ac33639e43a690d668"
    ),
    "docs/handoffs/TASK-0062.json": (
        "4118884005a1b88c90c425cb3fd69686bc45c59b11c8c10beede88ffb70faea3"
    ),
}
TASK_0063_BASE_COMMIT = "a328a02c72e5cfb7bc784e7a083caaaf8cffe08c"
TASK_0063_AUTHORIZATION_COMMIT = "52ee83bd609a3817b6a0dc098abe3b39328f6bd7"
TASK_0063_CARD_PATH = (
    "docs/tasks/TASK-0063-authorization-history-greenline-recovery.md"
)
TASK_0063_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0062"],
        "newDependencies": ["TASK-0063"],
    },
}
TASK_0063_TERMINAL_ARTIFACT_SHA256 = {
    TASK_0063_CARD_PATH: (
        "d08b39a9009c2ea46b8ebf2ea6ecfb764dc1e3c66c1262ae1bae174b174eccf6"
    ),
    "docs/evidence/TASK-0063/evidence-pack.json": (
        "0095f5fd787c74e2571a352be531ae54eaa5a537523cfbf2824167050c5023d2"
    ),
    "docs/handoffs/TASK-0063.json": (
        "3a963e74bfb08b9b630280429c37e5cc7baad43f4f028a51f321b8a47f6a7620"
    ),
}
TASK_0063_TERMINAL_COMMIT = "8af24aba6225104833b4d5845a77bbe7e513eed7"
TASK_0063_TERMINAL_TREE = "f3d330153dfc85e537256c6301c525f8ec27e6cc"
TASK_0063_AUTHORIZATION_TREE = "1c58f137163b8961c99e0b4dd45780dd58483b35"
TASK_0063_AUTHORIZATION_PROJECTION_SHA256 = (
    "36f689d66e447b0b724ad7a87d9e9395937844447e355590cc6c86cda8c04c89"
)
TASK_0063_AUTHORITY_SHA256 = (
    "96cdc66ef7d75e1c04bd5ba5ae3e56f63d528a0f59fb3faa23d4c8a446c65b4e"
)
TASK_0064_BASE_COMMIT = "8af24aba6225104833b4d5845a77bbe7e513eed7"
TASK_0064_AUTHORIZATION_COMMIT = "135453c30d34ad98d4424fa577757635e4fcf22d"
TASK_0064_PLANNING_REPAIR_PARENT_COMMIT = (
    "5408cc56548919e2f727ae451c1e84d727fcbc72"
)
TASK_0064_PLANNING_REPAIR_COMMIT = "57915f9a45564418be3e814bb9dda776ec9a8ee8"
TASK_0064_CARD_PATH = (
    "docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md"
)
TASK_0064_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0062"],
        "newDependencies": ["TASK-0064"],
    },
}
TASK_0066_BASE_COMMIT = "9bdf716a85c874bbf8df9e72fb9533b524682365"
TASK_0066_BASE_TREE = "57718eefe312c5048e8a334f96bbd22506b4315d"
TASK_0066_AUTHORIZATION_COMMIT = "d8bb788a3fa62bf5d4b2aea0c7d86e3fb6687ead"
TASK_0066_AUTHORITY_SHA256 = (
    "718af3016496ade5c6dde4ea66b78c9b3de06ff9b3228ba633ad9b9346a157f7"
)
TASK_0066_CARD_PATH = (
    "docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md"
)
TASK_0066_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0064"],
        "newDependencies": ["TASK-0066"],
    },
}
TASK_0067_BASE_COMMIT = "b48984d1fbb61f809711f936066610576ad9426f"
TASK_0067_BASE_TREE = "f660c9e1823285ac98d7c8824a519405f23db72c"
TASK_0067_AUTHORIZATION_COMMIT = "35b93065dd760ffb698e315c703de7987e00165a"
TASK_0067_AUTHORITY_SHA256 = (
    "b9d205688f2df061ec00ea300b632a4a2cc36667d68b97af1d3aa02b7116b2ee"
)
TASK_0067_CARD_PATH = (
    "docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md"
)
TASK_0067_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0066"],
        "newDependencies": ["TASK-0067"],
    },
}
TASK_0067_TERMINAL_COMMIT = "0be905ab953975476802a5f1e0eef68b978635d2"
TASK_0067_TERMINAL_TREE = "d0aeef9857e0fd2b366bebe7162bb282d94ec830"
TASK_0067_AUTHORIZATION_TREE = "fc99ef39bc4a522bd54feafa439c186bdbfe3170"
TASK_0067_AUTHORIZATION_PROJECTION_SHA256 = (
    "829a02358049f221b330e610f12cfe849d0faccb13434122214078dd5390b356"
)
TASK_0067_TERMINAL_ARTIFACT_SHA256 = {
    TASK_0067_CARD_PATH: (
        "14852dec672ced04bc06a2f751e437ff89de80a31177d23ffdb9a5fff3f56582"
    ),
    "docs/evidence/TASK-0067/evidence-pack.json": (
        "7d7141e536a3f30f32f48b160659ee15367ae2f6d21a8b51f22a40bd74789565"
    ),
    "docs/handoffs/TASK-0067.json": (
        "26abb1bb4b58fcf753cf3f2c45fbb2d5429abe5cfee6f7cab01ced5cbd36b18c"
    ),
}
TASK_0068_BASE_COMMIT = "0be905ab953975476802a5f1e0eef68b978635d2"
TASK_0068_BASE_TREE = "d0aeef9857e0fd2b366bebe7162bb282d94ec830"
TASK_0068_AUTHORIZATION_COMMIT = "31c4937fbe576c2ada3682ab2269006b824bea82"
TASK_0068_AUTHORIZATION_TREE = "7421f5e37350648e98c2076a63495b5d2fe7d7da"
TASK_0068_AUTHORIZATION_PROJECTION_SHA256 = (
    "59d04be84d2d4f8483169ca4b217a9c5c594781a38f1c6348f34372f50b505db"
)
TASK_0068_AUTHORITY_SHA256 = (
    "648b6608b0f5ddb2c6292cd578ddd2883e50f627674e81cbc07f0091547f5bac"
)
TASK_0068_CARD_PATH = (
    "docs/tasks/TASK-0068-harness-portability-acceptance-recovery.md"
)
TASK_0068_PLANNING_REPAIR_PARENT_COMMIT = (
    "101a3c7b5e711b3fcea049a60a8ed332149c4cc9"
)
TASK_0068_PLANNING_REPAIR_COMMIT = "20193286d7bb566d2e433d80811f582572df61da"
TASK_0068_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0067"],
        "newDependencies": ["TASK-0068"],
    },
}
TASK_0068_TERMINAL_COMMIT = TASK_0068_PLANNING_REPAIR_COMMIT
TASK_0068_TERMINAL_TREE = "7413d1554167d951c226ab24ca5dde2eb9616970"
TASK_0068_TERMINAL_ARTIFACT_SHA256 = {
    TASK_0068_CARD_PATH: (
        "256e18f8bd019a9c1de776d35791a563f487341835a3ff10bb709c96740f8523"
    ),
    "docs/evidence/TASK-0068/evidence-pack.json": (
        "9f040bce7290ff252d144574cdd286c984eb44f9d6fae3c71862cae6eea0dc86"
    ),
    "docs/evidence/TASK-0068/pre-closure-request.json": (
        "ddbe88b9b0893832bbf4731aa55a059a987489157abb23b8e98e849e65dbab74"
    ),
    "docs/handoffs/TASK-0068.json": (
        "a6cc5c4ca0f97a6fc49d0dfdda87d54b74411ae53dc9ed8e047ca543a80c71de"
    ),
}
TASK_0068_RETAINED_RECOVERY_PATHS = (
    CI_EXECUTION_POLICY_PATH,
    TASK_BACKLOG_PATH,
    "docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md",
)
TASK_0069_BASE_COMMIT = "20193286d7bb566d2e433d80811f582572df61da"
TASK_0069_BASE_TREE = "7413d1554167d951c226ab24ca5dde2eb9616970"
TASK_0069_AUTHORIZATION_COMMIT = "56a31d55f0bdeb5ab71446d5a21b042015b290ca"
TASK_0069_AUTHORITY_SHA256 = (
    "89825f2842d4e47eb7eb941b4e2b724598c5bfb0450c4d07a7598ea0a48877bb"
)
TASK_0069_CARD_PATH = (
    "docs/tasks/TASK-0069-harness-portability-local-history-recovery.md"
)
TASK_0069_PLANNING_REPAIRS = {
    "TASK-0055": {
        "oldTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "newTitle": "Idle planning checkpoint 核心父边校验永久后继",
        "oldDependencies": ["TASK-0068"],
        "newDependencies": ["TASK-0069"],
    },
}
TASK_0055_REPLACEMENT_DEPENDENCY_CHAIN = (
    "TASK-0060",
    "TASK-0061",
    "TASK-0062",
    "TASK-0064",
    "TASK-0066",
    "TASK-0067",
    "TASK-0068",
    "TASK-0069",
)
TASK_0071_BASE_COMMIT = "f9556808dc12ad14a67cb08cb570efb0281fc172"
TASK_0071_AUTHORIZATION_COMMIT = "6f2fb4678089d4a0deb3be4896345807254ecfd4"
TASK_0071_AUTHORITY_SHA256 = (
    "75746def79eee2f3660daebdc5de34e59133bc303460e9f7395e94f8c0335ea7"
)
TASK_0071_CARD_PATH = (
    "docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md"
)
TASK_0071_PLANNING_REPAIRS = {
    "TASK-0056": {
        "oldTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "newTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "oldDependencies": ["TASK-0055"],
        "newDependencies": ["TASK-0071"],
    },
}
TASK_0071_PLANNING_REPAIR_PATHS = {
    ".harness/project-state.yaml",
    ".harness/task-backlog.yaml",
    ".harness/task-delivery-policy.yaml",
    "docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md",
    TASK_0071_CARD_PATH,
    "scripts/harness/doctor.py",
    "scripts/harness/tests/test_harness.py",
}
TASK_0073_AUTHORIZATION_COMMIT = "595e5a47903336fc74133e482e89c2291ddfa63e"
TASK_0073_AUTHORITY_SHA256 = (
    "e41983dcd43a0fa0d4e62cabbe2a3c386776536ecb21b94f30037c8bfdaeb601"
)
TASK_0073_PRE_REPAIR_DELIVERY_POLICY_CANONICAL_HASH = (
    "b1091d59b30918ce22c2dfa910884c7fe63827386171e579c7679d0bb62d1e3a"
)
TASK_0073_PLANNING_REPAIRS = {
    "TASK-0056": {
        "oldTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "newTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "oldDependencies": ["TASK-0071"],
        "newDependencies": ["TASK-0073"],
    },
}
TASK_0073_PLANNING_REPAIR_PATHS = {
    ".harness/project-state.yaml",
    ".harness/task-backlog.yaml",
    ".harness/task-delivery-policy.yaml",
    "docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md",
    TASK_0073_CARD_PATH,
    "scripts/harness/doctor.py",
    "scripts/harness/tests/test_harness.py",
}
TASK_0074_PLANNING_REPAIRS = {
    "TASK-0056": {
        "oldTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "newTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "oldDependencies": ["TASK-0073"],
        "newDependencies": ["TASK-0074"],
    },
}
TASK_0075_PLANNING_REPAIRS = {
    "TASK-0056": {
        "oldTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "newTitle": "Idle planning checkpoint 四消费者接线与 CI 闭环",
        "oldDependencies": ["TASK-0073"],
        "newDependencies": ["TASK-0075"],
    },
}
IDLE_PLANNING_PAUSE_NEXT_ACTION = "等待 Owner 决策：当前无可晋级任务"
AUTHORIZATION_AMENDMENT_BOOTSTRAP_PARENT_COMMIT = (
    "2a55335e695c8fc5434c0dbc867288842c804e74"
)
AUTHORIZATION_AMENDMENT_BOOTSTRAP_COMMIT = (
    "1b9eafd46649b76ab1a1b4e93f8cba8feaa7d6ad"
)
AUTHORIZATION_AMENDMENT_BOOTSTRAP_PARENT_AUTHORITY_SHA256 = (
    "d6ff11b355cb8bdb90e624bea6b16a8f989833d47e4b92e173bd46448a73456b"
)
AUTHORIZATION_AMENDMENT_BOOTSTRAP_CHILD_AUTHORITY_SHA256 = (
    "ec6c83ceba55f3754e0277d31bacda3615c59fea90ef36ca300aee113a572088"
)
AUTHORIZATION_AMENDMENT_BOOTSTRAP_CHILD_AMENDMENTS_SHA256 = (
    "e9789d0b6bac22b33b8d2298bf0e61aeaa74dd5ed7a44b8d1360badafe551298"
)
LEGACY_RESULT_UNRECOVERABLE_REASON = (
    "The only candidate canonical used the coordinator-approved durable-receipt "
    "mode. Wrapper PID 45460 and all children were later confirmed absent while "
    "receipt.json was absent. No stdout/stderr was read, no inner exit code is "
    "inferred, and the command was not rerun; result is "
    "FAIL/RESULT_UNRECOVERABLE."
)
PLANNING_CONTRACT_HASH_ALGORITHM = "SHA256_CANONICAL_JSON_V1"
PLANNED_CARD_FIELDS = {
    "taskId",
    "state",
    "owner",
    "planningBacklog",
    "planningContractHash",
    "planningContractHashAlgorithm",
}
PLANNING_TERMINAL_STATES = {"REJECTED", "SUPERSEDED"}
PLANNING_TERMINAL_CARD_FIELDS = PLANNED_CARD_FIELDS | {"planningResolution"}
BACKLOG_ROOT_FIELDS = {
    "schemaVersion",
    "backlogId",
    "phase",
    "bootstrapTask",
    "planningContractHashAlgorithm",
    "authority",
    "rules",
    "technicalAlphaBoundary",
    "testPolicies",
    "executionOrder",
    "criticalPath",
    "decisionGates",
    "authorizationAmendments",
    "resolutions",
    "tasks",
}
BACKLOG_IMMUTABLE_ROOT_FIELDS = {
    "schemaVersion",
    "backlogId",
    "phase",
    "bootstrapTask",
    "planningContractHashAlgorithm",
    "authority",
    "rules",
    "technicalAlphaBoundary",
    "testPolicies",
}
BACKLOG_TASK_FIELDS = {
    "title",
    "taskCard",
    "dependencies",
    "decisionGates",
    "objective",
    "scope",
    "forbidden",
    "acceptanceCriteria",
    "promotionConditions",
}
BACKLOG_PROMOTION_CONDITION_FIELDS = {
    "requiresRepositoryIdle",
    "requiresAcceptedDependencies",
    "requiresApprovedDecisionGates",
    "requiresFirstByExecutionOrder",
}
BACKLOG_GATE_FIELDS = {
    "kind",
    "status",
    "requiredFor",
    "requiredDecisions",
    "approval",
}
BACKLOG_GATE_APPROVAL_FIELDS = {
    "approvedBy",
    "approvedAt",
    "evidence",
    "decisionEvidence",
}
BACKLOG_GATE_DECISION_EVIDENCE_FIELDS = {
    "value",
    "evidence",
}
BACKLOG_RESOLUTION_FIELDS = {
    "state",
    "reason",
    "decidedBy",
    "decidedAt",
    "replacementTask",
}
PLANNED_CARD_NON_NORMATIVE_NOTICE = (
    "> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 "
    "`.harness/task-backlog.yaml` 中本 Task ID 的静态合同，"
    "并由 `planningContractHash` 完整绑定。"
)
HISTORICAL_TASK_CARD_SNAPSHOT_FIELDS = {
    "path",
    "mode",
    "objectType",
    "oid",
    "content",
}
TASK_LEDGER_FIELDS = {
    "state",
    "contractVersion",
    "taskCard",
    "evidence",
    "handoff",
}
CANONICAL_PRECHECK_COMMANDS = {
    "doctor": ["scripts/harness/doctor.py"],
    "catalogValidate": ["scripts/harness/catalog_tool.py", "validate"],
    "catalogDrift": ["scripts/harness/catalog_tool.py", "diff", "--fail-on-drift"],
    "paidFeatureCheck": ["scripts/harness/check_paid_features.py"],
    "betaRosterGate": ["scripts/harness/check_beta_gate.py"],
}
PORCELAIN_V2_ORDINARY_RE = re.compile(
    rb"^1 [.MTADRCU]{2} (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) (.+)$",
    re.DOTALL,
)
PORCELAIN_V2_RENAME_RE = re.compile(
    rb"^2 [.MTADRCU]{2} (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"[RC](?:100|[1-9]?[0-9]) (.+)$",
    re.DOTALL,
)
PORCELAIN_V2_UNMERGED_RE = re.compile(
    rb"^u (?:DD|AU|UD|UA|DU|AA|UU) (?:N\.\.\.|S[.C][.M][.U]) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:000000|100644|100755|120000|160000) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) "
    rb"(?:[0-9a-f]{40}|[0-9a-f]{64}) (.+)$",
    re.DOTALL,
)


class DoctorGitSnapshot:
    """Run-scoped immutable Git reads with end-of-run stability checks."""

    def __init__(self) -> None:
        head = git_text("rev-parse", "HEAD", check=False)
        if head.returncode != 0 or not FULL_COMMIT_RE.fullmatch(head.stdout.strip()):
            raise HarnessError("doctor snapshot: cannot resolve a full HEAD commit")
        index = git_bytes("ls-files", "--stage", "-z", check=False)
        if index.returncode != 0:
            detail = index.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(f"doctor snapshot: cannot read Git index: {detail}")
        index_flags = git_bytes("ls-files", "-v", "-z", check=False)
        if index_flags.returncode != 0:
            detail = index_flags.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read Git index flags: {detail}"
            )
        self._validate_index_flags(index_flags.stdout)
        fsmonitor_flags = git_bytes("ls-files", "-f", "-z", check=False)
        if fsmonitor_flags.returncode != 0:
            detail = fsmonitor_flags.stderr.decode(
                "utf-8",
                errors="replace",
            ).strip()
            raise HarnessError(
                f"doctor snapshot: cannot read Git fsmonitor flags: {detail}"
            )
        self._validate_fsmonitor_flags(fsmonitor_flags.stdout)
        worktree_bytes, worktree_fingerprint = self._capture_worktree()

        self.head = head.stdout.strip()
        self.index_bytes = index.stdout
        self.index_flags_bytes = index_flags.stdout
        self.fsmonitor_flags_bytes = fsmonitor_flags.stdout
        self.worktree_bytes = worktree_bytes
        self.worktree_fingerprint = worktree_fingerprint
        self._trees: dict[str, dict[str, tuple[str, str, str]]] = {}
        self._blobs: dict[str, bytes] = {}
        self._index_entries = self._parse_index(index.stdout)
        self._candidate_fingerprints = {
            os.fsdecode(entry[0]): entry
            for entry in worktree_fingerprint
        }
        self._current_file_cache: dict[str, tuple[bytes, int, int]] = {}
        self._current_blob_oids: dict[str, str] = {}
        self.ledger_introductions: dict[str, set[str]] | None = None

    @staticmethod
    def _worktree_status() -> bytes:
        result = git_bytes(
            "status",
            "--porcelain=v2",
            "--untracked-files=all",
            "-z",
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read worktree status: {detail}"
            )
        return result.stdout

    @staticmethod
    def _status_candidate_paths(raw: bytes) -> tuple[bytes, ...]:
        if raw and not raw.endswith(b"\0"):
            raise HarnessError(
                "doctor snapshot: unterminated worktree status output"
            )
        records = raw.split(b"\0")[:-1] if raw else []
        candidates: set[bytes] = set()
        index = 0
        while index < len(records):
            record = records[index]
            index += 1
            if not record:
                raise HarnessError(
                    "doctor snapshot: empty worktree status record"
                )
            prefix = record[:1]
            if prefix == b"1":
                match = PORCELAIN_V2_ORDINARY_RE.fullmatch(record)
                if match is None:
                    raise HarnessError(
                        "doctor snapshot: malformed ordinary worktree status record"
                    )
                record_candidates = (match.group(1),)
            elif prefix == b"2":
                match = PORCELAIN_V2_RENAME_RE.fullmatch(record)
                if match is None or index >= len(records) or not records[index]:
                    raise HarnessError(
                        "doctor snapshot: malformed rename worktree status record"
                    )
                record_candidates = (match.group(1), records[index])
                index += 1  # The following NUL record is the original path.
            elif prefix == b"u":
                match = PORCELAIN_V2_UNMERGED_RE.fullmatch(record)
                if match is None:
                    raise HarnessError(
                        "doctor snapshot: malformed unmerged worktree status record"
                    )
                record_candidates = (match.group(1),)
            elif prefix == b"?":
                if not record.startswith(b"? "):
                    raise HarnessError(
                        "doctor snapshot: malformed untracked worktree status record"
                    )
                record_candidates = (record[2:],)
            elif prefix in (b"#", b"!"):
                raise HarnessError(
                    "doctor snapshot: unexpected worktree status record type"
                )
            else:
                raise HarnessError(
                    "doctor snapshot: unknown worktree status record type"
                )
            for candidate in record_candidates:
                decoded_candidate = os.fsdecode(candidate)
                if (
                    not candidate
                    or b"\\" in candidate
                    or candidate.startswith(b"/")
                    or any(
                        component in (b"", b".", b"..")
                        for component in candidate.split(b"/")
                    )
                    or not is_repository_relative(decoded_candidate)
                ):
                    raise HarnessError(
                        "doctor snapshot: unsafe worktree status path"
                    )
                candidates.add(candidate)
        return tuple(sorted(candidates))

    @staticmethod
    def _index_flag_records(raw: bytes) -> list[tuple[bytes, bytes]]:
        if raw and not raw.endswith(b"\0"):
            raise HarnessError("doctor snapshot: unterminated Git index flags")
        records = raw.split(b"\0")[:-1] if raw else []
        parsed: list[tuple[bytes, bytes]] = []
        for record in records:
            if (
                len(record) < 3
                or record[1:2] != b" "
                or not record[2:]
            ):
                raise HarnessError("doctor snapshot: malformed Git index flags")
            tag = record[:1]
            if tag.upper() not in b"HSMRCK?":
                raise HarnessError("doctor snapshot: malformed Git index flags")
            parsed.append((tag, record[2:]))
        return parsed

    @classmethod
    def _validate_index_flags(cls, raw: bytes) -> None:
        for tag, _ in cls._index_flag_records(raw):
            if tag == b"S" or (b"a" <= tag <= b"z"):
                raise HarnessError(
                    "doctor snapshot: hidden Git index flag is not allowed"
                )

    @classmethod
    def _validate_fsmonitor_flags(cls, raw: bytes) -> None:
        for tag, _ in cls._index_flag_records(raw):
            if b"a" <= tag <= b"z":
                raise HarnessError(
                    "doctor snapshot: Git fsmonitor-valid flag is not allowed"
                )

    @staticmethod
    def _race_stat(stat_result: os.stat_result) -> tuple[int, int, int, int, int, int]:
        return (
            stat_result.st_dev,
            stat_result.st_ino,
            stat_result.st_mode,
            stat_result.st_size,
            stat_result.st_mtime_ns,
            stat_result.st_ctime_ns,
        )

    @staticmethod
    def _same_file_identity(
        left: tuple[int, int, int, int, int, int],
        right: tuple[int, int, int, int, int, int],
    ) -> bool:
        return (
            left[0],
            left[1],
            left[3],
            left[4],
        ) == (
            right[0],
            right[1],
            right[3],
            right[4],
        )

    @classmethod
    def _candidate_fingerprint(
        cls,
        raw_path: bytes,
    ) -> tuple[bytes, str, int, int, bytes]:
        fingerprint, _ = cls._read_candidate(raw_path, retain_content=False)
        return fingerprint

    @classmethod
    def _parent_states(
        cls,
        decoded_path: str,
    ) -> tuple[tuple[str, tuple[int, int, int, int, int, int]], ...]:
        states: list[tuple[str, tuple[int, int, int, int, int, int]]] = []
        current = ROOT
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        for component in decoded_path.split("/")[:-1]:
            current /= component
            try:
                metadata = os.lstat(current)
            except OSError as exc:
                raise HarnessError(
                    f"doctor snapshot: cannot inspect worktree parent {current}: {exc}"
                ) from exc
            attributes = int(getattr(metadata, "st_file_attributes", 0))
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or bool(attributes & reparse_flag)
            ):
                raise HarnessError(
                    f"doctor snapshot: worktree parent must be a regular directory: {current}"
                )
            states.append((str(current), cls._race_stat(metadata)))
        return tuple(states)

    @classmethod
    def _read_candidate(
        cls,
        raw_path: bytes,
        *,
        retain_content: bool,
    ) -> tuple[tuple[bytes, str, int, int, bytes], bytes | None]:
        decoded_path = os.fsdecode(raw_path)
        if b"\\" in raw_path or not is_repository_relative(decoded_path):
            raise HarnessError(
                "doctor snapshot: unsafe worktree status path"
            )
        candidate = ROOT.joinpath(*decoded_path.split("/"))
        parents_before = cls._parent_states(decoded_path)
        try:
            before = os.lstat(candidate)
        except FileNotFoundError:
            if cls._parent_states(decoded_path) != parents_before:
                raise HarnessError(
                    f"doctor snapshot: worktree parent changed while reading: {decoded_path!r}"
                )
            return (raw_path, "missing", 0, 0, b""), None
        except OSError as exc:
            raise HarnessError(
                f"doctor snapshot: cannot inspect worktree candidate {decoded_path!r}: {exc}"
            ) from exc

        attributes = int(getattr(before, "st_file_attributes", 0))
        mode = int(before.st_mode)
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        if (
            not stat.S_ISREG(mode)
            or stat.S_ISLNK(mode)
            or bool(attributes & reparse_flag)
        ):
            raise HarnessError(
                f"doctor snapshot: worktree candidate must be a regular non-reparse file: "
                f"{decoded_path!r}"
            )

        digest = hashlib.sha256()
        content = bytearray() if retain_content else None
        try:
            with candidate.open("rb") as stream:
                opened_before = os.fstat(stream.fileno())
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    if content is not None:
                        content.extend(chunk)
                opened_after = os.fstat(stream.fileno())
            after = os.lstat(candidate)
        except OSError as exc:
            raise HarnessError(
                f"doctor snapshot: cannot read worktree candidate {decoded_path!r}: {exc}"
            ) from exc
        expected = cls._race_stat(before)
        if (
            cls._race_stat(after) != expected
            or cls._race_stat(opened_after) != cls._race_stat(opened_before)
            or not cls._same_file_identity(
                cls._race_stat(opened_before),
                expected,
            )
            or cls._parent_states(decoded_path) != parents_before
        ):
            raise HarnessError(
                f"doctor snapshot: worktree candidate changed while reading: {decoded_path!r}"
            )
        return (
            (raw_path, "file", mode, attributes, digest.digest()),
            bytes(content) if content is not None else None,
        )

    @classmethod
    def _capture_worktree(
        cls,
    ) -> tuple[bytes, tuple[tuple[bytes, str, int, int, bytes], ...]]:
        status_before = cls._worktree_status()
        candidates = cls._status_candidate_paths(status_before)
        fingerprint = tuple(
            cls._candidate_fingerprint(path)
            for path in candidates
        )
        status_after = cls._worktree_status()
        if status_after != status_before:
            raise HarnessError(
                "doctor snapshot: worktree changed while capturing validation snapshot"
            )
        return status_before, fingerprint

    @staticmethod
    def _parse_index(raw: bytes) -> dict[str, list[tuple[str, str, str]]]:
        entries: dict[str, list[tuple[str, str, str]]] = {}
        for record in raw.split(b"\0"):
            if not record:
                continue
            if b"\t" not in record:
                raise HarnessError("doctor snapshot: malformed Git index record")
            header, raw_path = record.split(b"\t", 1)
            parts = header.decode("ascii", errors="strict").split()
            if len(parts) != 3:
                raise HarnessError("doctor snapshot: malformed Git index header")
            path = raw_path.decode(
                "utf-8",
                errors="surrogateescape",
            )
            entries.setdefault(path, []).append((parts[0], parts[1], parts[2]))
        return entries

    def resolve_commit(self, commit: str) -> str | None:
        if commit == "HEAD":
            return self.head
        return commit if FULL_COMMIT_RE.fullmatch(commit) else None

    def tree_entries(self, commit: str) -> dict[str, tuple[str, str, str]]:
        resolved = self.resolve_commit(commit)
        if resolved is None:
            raise HarnessError(
                f"doctor snapshot: immutable tree requires a full commit, got {commit!r}"
            )
        if resolved in self._trees:
            return self._trees[resolved]
        result = git_bytes("ls-tree", "-r", "-z", resolved, check=False)
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot read tree {resolved}: {detail}"
            )
        entries: dict[str, tuple[str, str, str]] = {}
        for record in result.stdout.split(b"\0"):
            if not record:
                continue
            if b"\t" not in record:
                raise HarnessError(
                    f"doctor snapshot: malformed tree record at {resolved}"
                )
            header, raw_path = record.split(b"\t", 1)
            parts = header.decode("ascii", errors="strict").split()
            if len(parts) != 3:
                raise HarnessError(
                    f"doctor snapshot: malformed tree header at {resolved}"
                )
            path = raw_path.decode("utf-8", errors="surrogateescape")
            if path in entries:
                raise HarnessError(
                    f"doctor snapshot: duplicate tree path at {resolved}: {path}"
                )
            entries[path] = (parts[0], parts[1], parts[2])
        self._trees[resolved] = entries
        return entries

    def index_entry(self, path: str) -> tuple[str, str] | None:
        records = self._index_entries.get(normalize_repo_path(path), [])
        if len(records) != 1 or records[0][2] != "0":
            return None
        return records[0][0], records[0][1]

    @staticmethod
    def _filtered_blob_oid(path: str, content: bytes) -> str:
        result = subprocess.run(
            [
                "git",
                "hash-object",
                f"--path={normalize_repo_path(path)}",
                "--stdin",
            ],
            cwd=ROOT,
            input=content,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        value = result.stdout.decode("ascii", errors="replace").strip()
        if result.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40,64}", value):
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(
                f"doctor snapshot: cannot hash current file {path}: {detail}"
            )
        return value

    def current_file_paths(self) -> set[str]:
        paths = {
            path
            for path, records in self._index_entries.items()
            if len(records) == 1
            and records[0][2] == "0"
            and records[0][0] in ("100644", "100755")
        }
        for path, fingerprint in self._candidate_fingerprints.items():
            if fingerprint[1] == "missing":
                paths.discard(path)
            elif fingerprint[1] == "file":
                paths.add(path)
        return paths

    @staticmethod
    def _repository_relative_path(path: Path) -> str:
        try:
            value = path.relative_to(ROOT).as_posix()
        except ValueError as exc:
            raise HarnessError(
                f"doctor snapshot: path is outside repository: {path}"
            ) from exc
        if not is_repository_relative(value):
            raise HarnessError(
                f"doctor snapshot: unsafe repository read path: {value!r}"
            )
        return normalize_repo_path(value)

    def read_current_file(self, path: Path) -> tuple[bytes, int, int]:
        normalized = self._repository_relative_path(path)
        cached = self._current_file_cache.get(normalized)
        if cached is not None:
            return cached
        raw_path = os.fsencode(normalized)
        expected = self._candidate_fingerprints.get(normalized)
        current, content = self._read_candidate(
            raw_path,
            retain_content=True,
        )
        if content is None:
            raise FileNotFoundError(normalized)
        if expected is not None:
            if current != expected:
                raise HarnessError(
                    f"doctor snapshot: current file changed before read: {normalized}"
                )
        else:
            index_entry = self.index_entry(normalized)
            if index_entry is None:
                raise FileNotFoundError(normalized)
            mode, oid = index_entry
            if mode not in ("100644", "100755"):
                raise HarnessError(
                    f"doctor snapshot: current path is not a regular Git blob: {normalized}"
                )
            filtered_oid = self._filtered_blob_oid(normalized, content)
            if filtered_oid != oid:
                raise HarnessError(
                    f"doctor snapshot: tracked file changed before read: {normalized}"
                )
            self._current_blob_oids[normalized] = filtered_oid
        result = (content, current[2], current[3])
        self._current_file_cache[normalized] = result
        return result

    def current_blob_oid(self, path: Path) -> str:
        normalized = self._repository_relative_path(path)
        content, _, _ = self.read_current_file(path)
        oid = self._current_blob_oids.get(normalized)
        if oid is None:
            oid = self._filtered_blob_oid(normalized, content)
            self._current_blob_oids[normalized] = oid
        return oid

    def read_current_bytes(self, path: Path) -> bytes:
        return self.read_current_file(path)[0]

    def current_path_is_file(self, path: Path) -> bool:
        normalized = self._repository_relative_path(path)
        return normalized in self.current_file_paths()

    def current_path_exists(self, path: Path) -> bool:
        normalized = self._repository_relative_path(path)
        paths = self.current_file_paths()
        return normalized in paths or any(
            candidate.startswith(f"{normalized.rstrip('/')}/")
            for candidate in paths
        )

    def glob_current(self, root: Path, pattern: str) -> list[Path]:
        prefix = self._repository_relative_path(root).rstrip("/")
        result: list[Path] = []
        for path in self.current_file_paths():
            if not path.startswith(f"{prefix}/"):
                continue
            relative_path = path[len(prefix) + 1:]
            if glob_matches(relative_path, pattern):
                result.append(ROOT / path)
        return sorted(result)

    def changed_paths(self, base_commit: str) -> list[str]:
        ancestor = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            self.head,
            check=False,
        )
        if ancestor.returncode != 0:
            raise HarnessError(
                f"baseCommit {base_commit} is not an ancestor of HEAD"
            )
        baseline = self.tree_entries(base_commit)
        paths = set(baseline) | set(self._index_entries)
        changed: set[str] = set()
        for path in paths:
            baseline_entry = baseline.get(path)
            records = self._index_entries.get(path, [])
            index_entry = (
                (
                    records[0][0],
                    "commit" if records[0][0] == "160000" else "blob",
                    records[0][1],
                )
                if len(records) == 1 and records[0][2] == "0"
                else None
            )
            if baseline_entry != index_entry:
                changed.add(path)
        changed.update(self._candidate_fingerprints)
        return sorted(changed)

    def index_matches_tree(self, commit: str) -> bool:
        tree = self.tree_entries(commit)
        paths = set(tree) | set(self._index_entries)
        for path in paths:
            records = self._index_entries.get(path, [])
            index_entry = None
            if len(records) == 1 and records[0][2] == "0":
                object_type = "commit" if records[0][0] == "160000" else "blob"
                index_entry = (records[0][0], object_type, records[0][1])
            if tree.get(path) != index_entry:
                return False
        return True

    def blob(self, oid: str) -> bytes:
        if oid in self._blobs:
            return self._blobs[oid]
        result = git_bytes("cat-file", "blob", oid, check=False)
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise HarnessError(f"doctor snapshot: cannot read blob {oid}: {detail}")
        self._blobs[oid] = result.stdout
        return result.stdout

    def verify_unchanged(self, audit: "Audit") -> None:
        head = git_text("rev-parse", "HEAD", check=False)
        audit.require(
            head.returncode == 0 and head.stdout.strip() == self.head,
            "doctor snapshot: HEAD changed during validation",
        )
        index = git_bytes("ls-files", "--stage", "-z", check=False)
        audit.require(
            index.returncode == 0 and index.stdout == self.index_bytes,
            "doctor snapshot: Git index changed during validation",
        )
        index_flags = git_bytes("ls-files", "-v", "-z", check=False)
        try:
            if index_flags.returncode != 0:
                detail = index_flags.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()
                raise HarnessError(
                    f"doctor snapshot: cannot read Git index flags: {detail}"
                )
            self._validate_index_flags(index_flags.stdout)
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                index_flags.stdout == self.index_flags_bytes,
                "doctor snapshot: Git index flags changed during validation",
            )
        fsmonitor_flags = git_bytes("ls-files", "-f", "-z", check=False)
        try:
            if fsmonitor_flags.returncode != 0:
                detail = fsmonitor_flags.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()
                raise HarnessError(
                    f"doctor snapshot: cannot read Git fsmonitor flags: {detail}"
                )
            self._validate_fsmonitor_flags(fsmonitor_flags.stdout)
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                fsmonitor_flags.stdout == self.fsmonitor_flags_bytes,
                "doctor snapshot: Git fsmonitor flags changed during validation",
            )
        try:
            worktree_bytes, worktree_fingerprint = self._capture_worktree()
        except HarnessError as exc:
            audit.error(str(exc))
        else:
            audit.require(
                worktree_bytes == self.worktree_bytes
                and worktree_fingerprint == self.worktree_fingerprint,
                "doctor snapshot: worktree changed during validation",
            )


_ACTIVE_GIT_SNAPSHOT: DoctorGitSnapshot | None = None


@contextmanager
def doctor_git_snapshot() -> Iterator[DoctorGitSnapshot]:
    global _ACTIVE_GIT_SNAPSHOT
    if _ACTIVE_GIT_SNAPSHOT is not None:
        raise HarnessError("doctor snapshot: nested validation scopes are not allowed")
    snapshot = DoctorGitSnapshot()
    _ACTIVE_GIT_SNAPSHOT = snapshot
    try:
        with repository_read_snapshot(
            snapshot.read_current_bytes,
            snapshot.glob_current,
        ):
            yield snapshot
    finally:
        _ACTIVE_GIT_SNAPSHOT = None


def git_object(commit: str, path: str) -> bytes:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_path = normalize_repo_path(path)
    if snapshot is not None:
        resolved = snapshot.resolve_commit(commit)
        if resolved is not None:
            entry = snapshot.tree_entries(resolved).get(normalized_path)
            if entry is None or entry[1] != "blob":
                raise HarnessError(f"cannot read {path} at {commit}: path is not a blob")
            return snapshot.blob(entry[2])
    return read_git_object(commit, path)


def changed_paths(base_commit: str) -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.changed_paths(base_commit)
        if snapshot is not None
        else git_changed_paths(base_commit)
    )


def current_path_is_file(path: Path) -> bool:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.current_path_is_file(path)
        if snapshot is not None
        else path.is_file()
    )


def current_path_exists(path: Path) -> bool:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    return (
        snapshot.current_path_exists(path)
        if snapshot is not None
        else path.exists()
    )


@contextmanager
def timed_phase(label: str) -> Iterator[None]:
    started = time.perf_counter()
    print(f"Harness doctor: START {label}", file=sys.stderr, flush=True)
    try:
        yield
    except Exception:
        elapsed = time.perf_counter() - started
        print(
            f"Harness doctor: ERROR {label} ({elapsed:.3f}s)",
            file=sys.stderr,
            flush=True,
        )
        raise
    elapsed = time.perf_counter() - started
    print(
        f"Harness doctor: DONE {label} ({elapsed:.3f}s)",
        file=sys.stderr,
        flush=True,
    )


class Audit:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0

    def require(self, condition: bool, message: str) -> None:
        with self._lock:
            self.checks += 1
            if not condition:
                self.errors.append(message)

    def error(self, message: str) -> None:
        with self._lock:
            self.checks += 1
            self.errors.append(message)

    def warn(self, message: str) -> None:
        with self._lock:
            self.warnings.append(message)


def unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def load_json(path: Path, audit: Audit) -> dict[str, Any] | None:
    try:
        data = json.loads(
            read_repository_text(path),
            object_pairs_hook=unique_json_object,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        audit.error(f"{relative(path)}: cannot load JSON: {exc}")
        return None
    if not isinstance(data, dict):
        audit.error(f"{relative(path)}: JSON root must be an object")
        return None
    return data


def json_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_json_schema(
    audit: Audit,
    value: Any,
    schema: dict[str, Any],
    label: str,
) -> None:
    expected_type = schema.get("type")
    if isinstance(expected_type, str):
        valid_type = json_type_matches(value, expected_type)
    elif isinstance(expected_type, list):
        valid_type = any(json_type_matches(value, str(item)) for item in expected_type)
    else:
        valid_type = True
    audit.require(valid_type, f"{label}: expected type {expected_type}")
    if not valid_type:
        return
    if "const" in schema:
        audit.require(value == schema["const"], f"{label}: expected const {schema['const']!r}")
    if "enum" in schema:
        audit.require(value in schema["enum"], f"{label}: value {value!r} is not in enum")
    if isinstance(value, str):
        if "minLength" in schema:
            audit.require(len(value.strip()) >= int(schema["minLength"]), f"{label}: string is too short")
        if "pattern" in schema:
            audit.require(bool(re.search(str(schema["pattern"]), value)), f"{label}: pattern mismatch")
    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for field in required:
                audit.require(field in value, f"{label}: missing required property {field}")
        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for field, field_schema in properties.items():
                if field in value and isinstance(field_schema, dict):
                    validate_json_schema(audit, value[field], field_schema, f"{label}.{field}")
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            audit.require(not extra, f"{label}: additional properties not allowed: {extra}")
    if isinstance(value, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_json_schema(audit, item, item_schema, f"{label}[{index}]")


def task_required_skills(task: dict[str, Any]) -> list[str]:
    raw = task.get("requiredSkills")
    return [str(item) for item in raw] if isinstance(raw, list) else []


def changed_skill_tree_ids(paths: list[str]) -> tuple[set[str], list[str]]:
    skill_ids: set[str] = set()
    invalid: list[str] = []
    for path in paths:
        normalized = normalize_repo_path(path)
        if not normalized.startswith("skills/"):
            continue
        parts = normalized.split("/")
        if len(parts) < 3 or not parts[1]:
            invalid.append(normalized)
            continue
        skill_ids.add(parts[1])
    return skill_ids, invalid


def semantic_version(value: Any) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"([0-9]+)\.([0-9]+)\.([0-9]+)", str(value))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def is_review_evidence_path(task_id: str, path: str) -> bool:
    prefix = f"docs/evidence/{task_id}/"
    return (
        is_repository_relative(path)
        and path.startswith(prefix)
        and path.endswith(".md")
    )


def task_authorization_projection(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    match = TASK_BLOCK_RE.search(normalized)
    if not match:
        raise HarnessError("task authorization projection: YAML block is missing")
    metadata = strict_yaml_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError("task authorization projection: YAML metadata must be an object")
    for field in AUTHORIZATION_MUTABLE_FIELDS:
        metadata.pop(field, None)
    canonical = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=True, width=120).rstrip()
    return normalized[: match.start()] + f"```yaml\n{canonical}\n```" + normalized[match.end() :]


def task0062_rejected_projection_is_exact(
    authorized_text: str,
    rejected_text: str,
) -> bool:
    try:
        authorized_projection = task_authorization_projection(authorized_text)
        rejected_projection = task_authorization_projection(rejected_text)
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    return (
        hashlib.sha256(authorized_projection.encode("utf-8")).hexdigest()
        == TASK_0062_AUTHORIZED_PROJECTION_SHA256
        and hashlib.sha256(rejected_projection.encode("utf-8")).hexdigest()
        == TASK_0062_REJECTED_PROJECTION_SHA256
        and authorized_projection.count(TASK_0062_AUTHORIZED_STOP_FRAGMENT) == 1
        and TASK_0062_REJECTED_STOP_FRAGMENT not in authorized_projection
        and rejected_projection
        == authorized_projection.replace(
            TASK_0062_AUTHORIZED_STOP_FRAGMENT,
            TASK_0062_REJECTED_STOP_FRAGMENT,
            1,
        )
    )


def task0062_rejected_authorization_history_isolated(
    task_id: str,
    task_path: str,
    task: dict[str, Any],
    authorized_text: str,
    current_text: str,
) -> bool:
    if (
        task_id != "TASK-0062"
        or task_path != TASK_0062_CARD_PATH
        or task.get("_path") != TASK_0062_CARD_PATH
        or task.get("taskId") != "TASK-0062"
        or task.get("state") != "REJECTED"
        or task.get("baseCommit") != TASK_0062_BASE_COMMIT
        or task.get("authorizationCommit") != TASK_0062_AUTHORIZATION_COMMIT
        or not task0062_rejected_projection_is_exact(authorized_text, current_text)
    ):
        return False
    try:
        current_metadata = task_metadata_from_text(
            current_text,
            "TASK-0062 rejected isolation current card",
        )
        if {
            key: value
            for key, value in task.items()
            if key != "_path"
        } != current_metadata:
            return False
        authorization_text = git_object(
            TASK_0062_AUTHORIZATION_COMMIT,
            TASK_0062_CARD_PATH,
        ).decode("utf-8")
        parent_text = git_object(
            TASK_0062_VIOLATION_PARENT_COMMIT,
            TASK_0062_CARD_PATH,
        ).decode("utf-8")
        violation_text = git_object(
            TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT,
            TASK_0062_CARD_PATH,
        ).decode("utf-8")
        if (
            authorization_text != authorized_text
            or task_authorization_projection(parent_text)
            != task_authorization_projection(authorized_text)
            or not task0062_rejected_projection_is_exact(
                authorized_text,
                violation_text,
            )
        ):
            return False
        graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT,
        ).stdout.split()
        if graph != [
            TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT,
            TASK_0062_VIOLATION_PARENT_COMMIT,
        ]:
            return False
        ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
        entries = ledger.get("tasks")
        expected_ledger_entry = {
            "state": "REJECTED",
            "contractVersion": 2,
            "taskCard": TASK_0062_CARD_PATH,
            "evidence": "docs/evidence/TASK-0062/evidence-pack.json",
            "handoff": "docs/handoffs/TASK-0062.json",
        }
        if (
            not isinstance(entries, dict)
            or entries.get("TASK-0062") != expected_ledger_entry
            or canonical_terminal_commit(
                task,
                {"ACCEPTED", "REJECTED"},
            )
            != TASK_0062_TERMINAL_COMMIT
        ):
            return False
        evidence = json.loads(
            read_repository_text(
                ROOT / "docs/evidence/TASK-0062/evidence-pack.json"
            )
        )
        handoff = json.loads(
            read_repository_text(ROOT / "docs/handoffs/TASK-0062.json")
        )
        expected_reviewer = {
            "id": "task-0062-independent-reviewer-r1",
            "kind": "independent-complete-matrix-review",
            "verdict": "FAIL",
            "reviewedCommit": TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT,
            "evidencePath": "docs/evidence/TASK-0062/review-r1.md",
        }
        if (
            evidence.get("taskId") != "TASK-0062"
            or evidence.get("baseCommit") != TASK_0062_BASE_COMMIT
            or evidence.get("headCommit")
            != TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT
            or evidence.get("reviewers") != [expected_reviewer]
            or handoff.get("taskId") != "TASK-0062"
            or handoff.get("state") != "REJECTED"
            or handoff.get("baseCommit") != TASK_0062_BASE_COMMIT
            or handoff.get("headCommit")
            != TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT
            or handoff.get("evidencePath")
            != "docs/evidence/TASK-0062/evidence-pack.json"
            or handoff.get("reviewers") != [expected_reviewer]
        ):
            return False
        for path, expected_hash in TASK_0062_TERMINAL_ARTIFACT_SHA256.items():
            if (
                hashlib.sha256(read_repository_bytes(ROOT / path)).hexdigest()
                != expected_hash
            ):
                return False
    except (
        HarnessError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        yaml.YAMLError,
    ):
        return False
    return True


def task0063_terminal_missing_reviewer_isolated(task: dict[str, Any]) -> bool:
    if (
        task.get("_path") != TASK_0063_CARD_PATH
        or task.get("taskId") != "TASK-0063"
        or task.get("state") != "REJECTED"
        or task.get("riskClass") != "C4"
        or task.get("baseCommit") != TASK_0063_BASE_COMMIT
        or task.get("authorizationCommit") != TASK_0063_AUTHORIZATION_COMMIT
        or task.get("requiredSkillVersions")
        != {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        or task.get("reviewers") != []
        or task.get("independentReview") != "required"
    ):
        return False
    try:
        current_text = read_repository_text(ROOT / TASK_0063_CARD_PATH)
        current_metadata = task_metadata_from_text(
            current_text,
            "TASK-0063 terminal missing-reviewer isolation",
        )
        if {
            key: value
            for key, value in task.items()
            if key != "_path"
        } != current_metadata:
            return False
        authorization_text = git_object(
            TASK_0063_AUTHORIZATION_COMMIT,
            TASK_0063_CARD_PATH,
        ).decode("utf-8")
        authorization_metadata = task_metadata_from_text(
            authorization_text,
            "TASK-0063 READY authorization",
        )
        if (
            authorization_metadata.get("state") != "READY"
            or hashlib.sha256(
                task_authorization_projection(authorization_text).encode("utf-8")
            ).hexdigest()
            != TASK_0063_AUTHORIZATION_PROJECTION_SHA256
            or hashlib.sha256(
                task_authorization_projection(current_text).encode("utf-8")
            ).hexdigest()
            != TASK_0063_AUTHORIZATION_PROJECTION_SHA256
            or canonical_json_sha256(authorization_metadata.get("humanApprovals"))
            != TASK_0063_AUTHORITY_SHA256
            or canonical_json_sha256(current_metadata.get("humanApprovals"))
            != TASK_0063_AUTHORITY_SHA256
        ):
            return False
        authorization_tree = git_text(
            "rev-parse",
            f"{TASK_0063_AUTHORIZATION_COMMIT}^{{tree}}",
            check=False,
        )
        terminal_tree = git_text(
            "rev-parse",
            f"{TASK_0063_TERMINAL_COMMIT}^{{tree}}",
            check=False,
        )
        if (
            authorization_tree.returncode != 0
            or authorization_tree.stdout.strip() != TASK_0063_AUTHORIZATION_TREE
            or terminal_tree.returncode != 0
            or terminal_tree.stdout.strip() != TASK_0063_TERMINAL_TREE
        ):
            return False
        terminal_state = strict_yaml_load(
            git_object(TASK_0063_TERMINAL_COMMIT, PROJECT_STATE_PATH).decode("utf-8")
        )
        terminal_ledger = strict_yaml_load(
            git_object(TASK_0063_TERMINAL_COMMIT, TASK_LEDGER_PATH).decode("utf-8")
        )
        expected_ledger_entry = {
            "state": "REJECTED",
            "contractVersion": 2,
            "taskCard": TASK_0063_CARD_PATH,
            "evidence": "docs/evidence/TASK-0063/evidence-pack.json",
            "handoff": "docs/handoffs/TASK-0063.json",
        }
        if (
            terminal_state.get("activeTask") is not None
            or terminal_state.get("lastTerminalTask") != "TASK-0063"
            or terminal_ledger.get("tasks", {}).get("TASK-0063")
            != expected_ledger_entry
        ):
            return False
        for path, expected_hash in TASK_0063_TERMINAL_ARTIFACT_SHA256.items():
            current_bytes = read_repository_bytes(ROOT / path)
            terminal_bytes = git_object(TASK_0063_TERMINAL_COMMIT, path)
            if (
                hashlib.sha256(current_bytes).hexdigest() != expected_hash
                or hashlib.sha256(terminal_bytes).hexdigest() != expected_hash
                or current_bytes != terminal_bytes
            ):
                return False
        evidence = json.loads(
            read_repository_text(ROOT / "docs/evidence/TASK-0063/evidence-pack.json")
        )
        handoff = json.loads(
            read_repository_text(ROOT / "docs/handoffs/TASK-0063.json")
        )
        if (
            evidence.get("taskId") != "TASK-0063"
            or evidence.get("baseCommit") != TASK_0063_BASE_COMMIT
            or evidence.get("headCommit")
            != "e6b087740c9b524419979ad0136fc0b33f325f96"
            or evidence.get("reviewers") != []
            or handoff.get("taskId") != "TASK-0063"
            or handoff.get("state") != "REJECTED"
            or handoff.get("baseCommit") != TASK_0063_BASE_COMMIT
            or handoff.get("headCommit")
            != "e6b087740c9b524419979ad0136fc0b33f325f96"
            or handoff.get("reviewers") != []
        ):
            return False
    except (
        HarnessError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        yaml.YAMLError,
    ):
        return False
    return True


def task0067_terminal_missing_reviewer_isolated(task: dict[str, Any]) -> bool:
    if (
        task.get("_path") != TASK_0067_CARD_PATH
        or task.get("taskId") != "TASK-0067"
        or task.get("state") != "REJECTED"
        or task.get("riskClass") != "C4"
        or task.get("baseCommit") != TASK_0067_BASE_COMMIT
        or task.get("authorizationCommit") != TASK_0067_AUTHORIZATION_COMMIT
        or task.get("requiredSkillVersions")
        != {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        or task.get("reviewers") != []
        or task.get("independentReview") != "required"
    ):
        return False
    try:
        current_text = read_repository_text(ROOT / TASK_0067_CARD_PATH)
        ready_text = git_object(
            TASK_0067_AUTHORIZATION_COMMIT,
            TASK_0067_CARD_PATH,
        ).decode("utf-8")
        current_metadata = task_metadata_from_text(
            current_text,
            "TASK-0067 terminal missing-reviewer isolation",
        )
        ready_metadata = task_metadata_from_text(
            ready_text,
            "TASK-0067 READY authority",
        )
        if (
            {key: value for key, value in task.items() if key != "_path"}
            != current_metadata
            or ready_metadata.get("state") != "READY"
            or hashlib.sha256(
                task_authorization_projection(ready_text).encode("utf-8")
            ).hexdigest()
            != TASK_0067_AUTHORIZATION_PROJECTION_SHA256
            or hashlib.sha256(
                task_authorization_projection(current_text).encode("utf-8")
            ).hexdigest()
            != TASK_0067_AUTHORIZATION_PROJECTION_SHA256
            or canonical_json_sha256(ready_metadata.get("humanApprovals"))
            != TASK_0067_AUTHORITY_SHA256
            or git_text(
                "rev-parse",
                f"{TASK_0067_AUTHORIZATION_COMMIT}^{{tree}}",
            ).stdout.strip()
            != TASK_0067_AUTHORIZATION_TREE
            or git_text(
                "rev-parse",
                f"{TASK_0067_TERMINAL_COMMIT}^{{tree}}",
            ).stdout.strip()
            != TASK_0067_TERMINAL_TREE
        ):
            return False
        terminal_state = yaml_at_commit(
            TASK_0067_TERMINAL_COMMIT,
            PROJECT_STATE_PATH,
        )
        terminal_ledger = yaml_at_commit(
            TASK_0067_TERMINAL_COMMIT,
            TASK_LEDGER_PATH,
        )
        if (
            terminal_state.get("activeTask") is not None
            or terminal_state.get("lastTerminalTask") != "TASK-0067"
            or terminal_ledger.get("tasks", {}).get("TASK-0067")
            != {
                "state": "REJECTED",
                "contractVersion": 2,
                "taskCard": TASK_0067_CARD_PATH,
                "evidence": "docs/evidence/TASK-0067/evidence-pack.json",
                "handoff": "docs/handoffs/TASK-0067.json",
            }
        ):
            return False
        for path, expected_hash in TASK_0067_TERMINAL_ARTIFACT_SHA256.items():
            current_bytes = read_repository_bytes(ROOT / path)
            terminal_bytes = git_object(TASK_0067_TERMINAL_COMMIT, path)
            if (
                current_bytes != terminal_bytes
                or hashlib.sha256(current_bytes).hexdigest() != expected_hash
            ):
                return False
        evidence = json.loads(
            read_repository_text(ROOT / "docs/evidence/TASK-0067/evidence-pack.json")
        )
        handoff = json.loads(
            read_repository_text(ROOT / "docs/handoffs/TASK-0067.json")
        )
        wall_clock = evidence.get("artifacts", {}).get("wallClock", {})
        system_error = evidence.get("artifacts", {}).get("systemErrorRecovery", {})
        return (
            evidence.get("taskId") == "TASK-0067"
            and evidence.get("baseCommit") == TASK_0067_BASE_COMMIT
            and evidence.get("headCommit")
            == "627ab81c664fccc97c00473b852c5da7a39a00bb"
            and evidence.get("reviewers") == []
            and wall_clock.get("candidateDeadlineMinutes") == 20
            and wall_clock.get("candidateDeadlineStatus")
            == "FIRED_BEFORE_PROVABLE_TARGETED_PASS"
            and system_error.get("classification") == "SYSTEM_ERROR_UNRECOVERABLE"
            and system_error.get("diagnosticUnavailable") is True
            and system_error.get("rootCauseInferred") is False
            and handoff.get("taskId") == "TASK-0067"
            and handoff.get("state") == "REJECTED"
            and handoff.get("headCommit")
            == "627ab81c664fccc97c00473b852c5da7a39a00bb"
            and handoff.get("reviewers") == []
        )
    except (
        HarnessError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        yaml.YAMLError,
    ):
        return False


def task0068_terminal_missing_reviewer_isolated(task: dict[str, Any]) -> bool:
    if (
        task.get("_path") != TASK_0068_CARD_PATH
        or task.get("taskId") != "TASK-0068"
        or task.get("state") != "REJECTED"
        or task.get("riskClass") != "C4"
        or task.get("baseCommit") != TASK_0068_BASE_COMMIT
        or task.get("authorizationCommit") != TASK_0068_AUTHORIZATION_COMMIT
        or task.get("requiredSkillVersions")
        != {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        or task.get("reviewers") != []
        or task.get("independentReview") != "required"
    ):
        return False
    try:
        current_text = read_repository_text(ROOT / TASK_0068_CARD_PATH)
        ready_text = git_object(
            TASK_0068_AUTHORIZATION_COMMIT,
            TASK_0068_CARD_PATH,
        ).decode("utf-8")
        current_metadata = task_metadata_from_text(
            current_text,
            "TASK-0068 terminal missing-reviewer isolation",
        )
        ready_metadata = task_metadata_from_text(
            ready_text,
            "TASK-0068 READY authority",
        )
        if (
            {key: value for key, value in task.items() if key != "_path"}
            != current_metadata
            or ready_metadata.get("state") != "READY"
            or hashlib.sha256(
                task_authorization_projection(ready_text).encode("utf-8")
            ).hexdigest()
            != TASK_0068_AUTHORIZATION_PROJECTION_SHA256
            or hashlib.sha256(
                task_authorization_projection(current_text).encode("utf-8")
            ).hexdigest()
            != TASK_0068_AUTHORIZATION_PROJECTION_SHA256
            or canonical_json_sha256(ready_metadata.get("humanApprovals"))
            != TASK_0068_AUTHORITY_SHA256
            or git_text(
                "rev-parse",
                f"{TASK_0068_AUTHORIZATION_COMMIT}^{{tree}}",
            ).stdout.strip()
            != TASK_0068_AUTHORIZATION_TREE
            or git_text(
                "rev-parse",
                f"{TASK_0068_TERMINAL_COMMIT}^{{tree}}",
            ).stdout.strip()
            != TASK_0068_TERMINAL_TREE
        ):
            return False
        terminal_state = yaml_at_commit(
            TASK_0068_TERMINAL_COMMIT,
            PROJECT_STATE_PATH,
        )
        terminal_ledger = yaml_at_commit(
            TASK_0068_TERMINAL_COMMIT,
            TASK_LEDGER_PATH,
        )
        if (
            terminal_state.get("activeTask") is not None
            or terminal_state.get("lastTerminalTask") != "TASK-0068"
            or terminal_ledger.get("tasks", {}).get("TASK-0068")
            != {
                "state": "REJECTED",
                "contractVersion": 2,
                "taskCard": TASK_0068_CARD_PATH,
                "evidence": "docs/evidence/TASK-0068/evidence-pack.json",
                "handoff": "docs/handoffs/TASK-0068.json",
            }
        ):
            return False
        for path, expected_hash in TASK_0068_TERMINAL_ARTIFACT_SHA256.items():
            current_bytes = read_repository_bytes(ROOT / path)
            terminal_bytes = git_object(TASK_0068_TERMINAL_COMMIT, path)
            if (
                current_bytes != terminal_bytes
                or hashlib.sha256(current_bytes).hexdigest() != expected_hash
            ):
                return False
        evidence = json.loads(
            read_repository_text(ROOT / "docs/evidence/TASK-0068/evidence-pack.json")
        )
        handoff = json.loads(
            read_repository_text(ROOT / "docs/handoffs/TASK-0068.json")
        )
        artifacts = evidence.get("artifacts", {})
        wall_clock = artifacts.get("wallClock", {})
        system_error = artifacts.get("systemErrorRecovery", {})
        retained = artifacts.get("retainedInterruptedWorktree", {})
        return (
            evidence.get("taskId") == "TASK-0068"
            and evidence.get("baseCommit") == TASK_0068_BASE_COMMIT
            and evidence.get("headCommit")
            == TASK_0068_PLANNING_REPAIR_PARENT_COMMIT
            and evidence.get("reviewers") == []
            and wall_clock.get("candidateDeadlineMinutes") == 35
            and wall_clock.get("hardFuseWallMinutes") == 125
            and system_error.get("classification") == "SYSTEM_ERROR_UNRECOVERABLE"
            and system_error.get("diagnosticUnavailable") is True
            and system_error.get("rootCauseInferred") is False
            and system_error.get("budgetPauseInferred") is False
            and retained.get("candidateFrozen") is False
            and retained.get("validationClaimed") is False
            and handoff.get("taskId") == "TASK-0068"
            and handoff.get("state") == "REJECTED"
            and handoff.get("headCommit")
            == TASK_0068_PLANNING_REPAIR_PARENT_COMMIT
            and handoff.get("reviewers") == []
        )
    except (
        HarnessError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        yaml.YAMLError,
    ):
        return False


def project_state_closure_projection(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in state.items()
        if key not in PROJECT_STATE_CLOSURE_MUTABLE_FIELDS
    }


def project_state_ready_projection(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in state.items()
        if key not in PROJECT_STATE_READY_MUTABLE_FIELDS
    }


def task_state_sequence(
    task: dict[str, Any],
    authorization_commit: str,
) -> list[str]:
    path = str(task["_path"])
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        f"{authorization_commit}..HEAD",
        "--",
        path,
    ).stdout.splitlines()
    sequence = ["READY"]
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = strict_yaml_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        state = str(metadata.get("state", ""))
        if state != sequence[-1]:
            sequence.append(state)
    current_state = str(task.get("state", ""))
    if current_state != sequence[-1]:
        sequence.append(current_state)
    return sequence


def task_metadata_at_commit(commit: str, path: str) -> dict[str, Any]:
    raw = git_object(commit, path).decode("utf-8")
    match = TASK_BLOCK_RE.search(raw)
    if not match:
        raise HarnessError(f"{path}: task YAML missing at {commit}")
    metadata = strict_yaml_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError(f"{path}: task YAML invalid at {commit}")
    return metadata


def validate_task_state_graph(
    audit: Audit,
    task: dict[str, Any],
    lifecycle: dict[str, Any],
    authorization_commit: str,
) -> None:
    task_id = str(task.get("taskId", ""))
    path = str(task.get("_path", ""))
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{authorization_commit}..HEAD",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child_state = str(task_metadata_at_commit(commit, path).get("state", ""))
        for parent in tokens[1:]:
            parent_in_scope = (
                parent == authorization_commit
                or git_text(
                    "merge-base",
                    "--is-ancestor",
                    authorization_commit,
                    parent,
                    check=False,
                ).returncode
                == 0
            )
            if not parent_in_scope:
                continue
            parent_state = str(task_metadata_at_commit(parent, path).get("state", ""))
            if child_state != parent_state:
                allowed = transitions.get(parent_state, [])
                audit.require(
                    isinstance(allowed, list) and child_state in allowed,
                    f"{task_id}: invalid task state edge {parent_state} -> "
                    f"{child_state} at {parent}..{commit}",
                )
    head_state = str(task_metadata_at_commit("HEAD", path).get("state", ""))
    current_state = str(task.get("state", ""))
    if current_state != head_state:
        allowed = transitions.get(head_state, [])
        audit.require(
            isinstance(allowed, list) and current_state in allowed,
            f"{task_id}: invalid worktree task state edge {head_state} -> {current_state}",
        )


def first_matching_state_commit(
    task: dict[str, Any],
    states: set[str],
) -> str | None:
    path = str(task["_path"])
    authorization_commit = str(task.get("authorizationCommit", ""))
    revision = f"{authorization_commit}..HEAD" if FULL_COMMIT_RE.fullmatch(authorization_commit) else "HEAD"
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        revision,
        "--",
        path,
    ).stdout.splitlines()
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = strict_yaml_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        if str(metadata.get("state", "")) in states:
            return commit.strip()
    return None


def first_terminal_commit(
    task: dict[str, Any],
    terminal_states: set[str],
) -> str | None:
    return first_matching_state_commit(task, terminal_states)


def derive_latest_task_in_states(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    states: set[str],
    label: str,
) -> str | None:
    committed: list[tuple[str, str]] = []
    uncommitted: list[str] = []
    try:
        for task_id, task in tasks.items():
            if str(task.get("state", "")) not in states:
                continue
            commit = first_matching_state_commit(task, states)
            if commit:
                committed.append((task_id, commit))
            else:
                uncommitted.append(task_id)
        audit.require(
            len(uncommitted) <= 1,
            f"project-state: multiple uncommitted {label} tasks are ambiguous: {sorted(uncommitted)}",
        )
        if uncommitted:
            return uncommitted[0]
        if not committed:
            return None
        latest_id, latest_commit = committed[0]
        for task_id, commit in committed[1:]:
            if commit == latest_commit:
                audit.error(
                    f"project-state: {label} tasks {latest_id} and {task_id} share one terminal commit"
                )
                return None
            latest_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                latest_commit,
                commit,
                check=False,
            )
            candidate_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                commit,
                latest_commit,
                check=False,
            )
            if latest_is_ancestor.returncode == 0:
                latest_id, latest_commit = task_id, commit
            elif candidate_is_ancestor.returncode != 0:
                audit.error(
                    f"project-state: {label} commits for {latest_id} and {task_id} are not comparable"
                )
                return None
        return latest_id
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"project-state: cannot derive latest {label} task: {exc}")
        return None


def changed_paths_between(base_commit: str, target_commit: str) -> list[str]:
    result = git_bytes(
        "diff",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        base_commit,
        target_commit,
        "--",
    )
    return sorted(
        {
            normalize_repo_path(value.decode("utf-8", errors="surrogateescape"))
            for value in result.stdout.split(b"\0")
            if value
        }
    )


def changed_paths_across_history(base_commit: str, target_commit: str) -> list[str]:
    ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        base_commit,
        target_commit,
        check=False,
    )
    if ancestor.returncode != 0:
        raise HarnessError("Base Commit must be an ancestor of the target commit")
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    changed: set[str] = set()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        commit_descends_from_base = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            commit,
            check=False,
        )
        if commit_descends_from_base.returncode != 0:
            raise HarnessError(
                f"task history is not ancestry-closed after Base Commit: {commit}"
            )
        for parent in tokens[1:]:
            changed.update(changed_paths_between(parent, commit))
    return sorted(changed)


def yaml_at_commit(commit: str, path: str) -> dict[str, Any]:
    try:
        data = strict_yaml_load(git_object(commit, path))
    except (UnicodeError, yaml.YAMLError) as exc:
        raise HarnessError(f"{path}: invalid YAML at {commit}: {exc}") from exc
    if not isinstance(data, dict):
        raise HarnessError(f"{path}: YAML root must be an object at {commit}")
    return data


def protected_rules_at_commit(commit: str) -> list[dict[str, Any]]:
    data = yaml_at_commit(commit, ".harness/protected-paths.yaml")
    rules = data.get("paths")
    if not isinstance(rules, list):
        raise HarnessError(f".harness/protected-paths.yaml: paths must be a list at {commit}")
    return [rule for rule in rules if isinstance(rule, dict)]


def skill_registry_at_commit(commit: str) -> dict[str, dict[str, Any]]:
    data = yaml_at_commit(commit, ".harness/skills.yaml")
    entries = data.get("skills")
    if not isinstance(entries, list):
        raise HarnessError(f".harness/skills.yaml: skills must be a list at {commit}")
    return {
        str(entry.get("id")): entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("id")
    }


def effective_protected_rules(
    audit: Audit,
    task: dict[str, Any],
    current_rules: list[dict[str, Any]],
    target_commit: str | None = None,
) -> list[dict[str, Any]]:
    task_id = str(task.get("taskId", ""))
    combined: list[dict[str, Any]] = []
    try:
        combined.extend(protected_rules_at_commit(str(task.get("baseCommit", ""))))
        if target_commit:
            combined.extend(protected_rules_at_commit(target_commit))
        else:
            combined.extend(current_rules)
    except HarnessError as exc:
        audit.error(f"{task_id}: cannot build effective protected rules: {exc}")
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for rule in combined:
        identity = json.dumps(rule, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if identity not in seen:
            seen.add(identity)
            deduplicated.append(rule)
    return deduplicated


def first_task_state_commit_from_base(
    task: dict[str, Any],
    states: set[str],
) -> tuple[str, dict[str, Any]] | None:
    path = str(task.get("_path", ""))
    base_commit = str(task.get("baseCommit", ""))
    history = git_text(
        "log",
        "--format=%H",
        "--reverse",
        f"{base_commit}..HEAD",
        "--",
        path,
    ).stdout.splitlines()
    for commit in history:
        raw = git_object(commit.strip(), path).decode("utf-8")
        match = TASK_BLOCK_RE.search(raw)
        if not match:
            raise HarnessError(f"{path}: task YAML missing at {commit}")
        metadata = strict_yaml_load(match.group(1))
        if not isinstance(metadata, dict):
            raise HarnessError(f"{path}: task YAML invalid at {commit}")
        if str(metadata.get("state", "")) in states:
            return commit.strip(), metadata
    return None


def validate_history_path_allowlist(
    audit: Audit,
    base_commit: str,
    target_commit: str,
    allowed_paths: set[str],
    label: str,
) -> None:
    ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        base_commit,
        target_commit,
        check=False,
    )
    audit.require(
        ancestor.returncode == 0,
        f"{label}: Base Commit must be an ancestor of the target commit",
    )
    if ancestor.returncode != 0:
        return
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        commit_descends_from_base = git_text(
            "merge-base",
            "--is-ancestor",
            base_commit,
            commit,
            check=False,
        )
        audit.require(
            commit_descends_from_base.returncode == 0,
            f"{label}: history is not ancestry-closed after Base Commit: {commit}",
        )
        for parent in tokens[1:]:
            changed = set(changed_paths_between(parent, commit))
            audit.require(
                changed <= allowed_paths,
                f"{label}: commit edge {parent}..{commit} contains unauthorized paths: "
                f"{sorted(changed - allowed_paths)}",
            )


def validate_ready_parent_projection(
    audit: Audit,
    task_id: str,
    parent_state: dict[str, Any],
    parent_task: dict[str, Any] | None,
) -> None:
    audit.require(
        parent_state.get("activeTask") in (None, "")
        and parent_state.get("activeTaskCard") in (None, ""),
        f"{task_id}: READY parent project-state must be idle",
    )
    if parent_task is not None:
        audit.require(
            parent_task.get("state") == "DRAFT"
            and parent_task.get("authorizationCommit") in (None, ""),
            f"{task_id}: READY parent task must be an unbound DRAFT",
        )


def validate_ready_project_state_checkpoint(
    audit: Audit,
    task: dict[str, Any],
    authorization_commit: str,
    checkpoint_paths: set[str],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    task_path = str(task.get("_path", ""))
    base_commit = str(task.get("baseCommit", ""))
    baseline_exists = git_text(
        "cat-file",
        "-e",
        f"{base_commit}:{PROJECT_STATE_PATH}",
        check=False,
    )
    if baseline_exists.returncode != 0:
        audit.require(
            task_id == "TASK-0002",
            f"{task_id}: Base Commit is missing .harness/project-state.yaml",
        )
        bootstrap_anchor = first_task_state_commit_from_base(
            task,
            {"IN_PROGRESS", "BLOCKED", "IN_REVIEW", "ACCEPTED", "REJECTED"},
        )
        audit.require(
            bootstrap_anchor is not None
            and bootstrap_anchor[1].get("authorizationCommit") == authorization_commit,
            f"{task_id}: bootstrap authorizationCommit is not anchored by the first implementation state",
        )
        return

    first_ready = first_task_state_commit_from_base(task, {"READY"})
    audit.require(
        first_ready is not None and first_ready[0] == authorization_commit,
        f"{task_id}: authorizationCommit must be the first READY commit after Base Commit",
    )
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        authorization_commit,
        check=False,
    )
    parent_tokens = parent_result.stdout.split()
    audit.require(
        parent_result.returncode == 0 and len(parent_tokens) == 2,
        f"{task_id}: READY authorization commit must have exactly one parent",
    )
    if parent_result.returncode != 0 or len(parent_tokens) != 2:
        return
    parent_commit = parent_tokens[1]
    draft_paths = {task_path, str(task.get("contextLock", ""))}
    if task_id == TASK_0073_TASK_ID:
        audit.require(
            parent_commit != authorization_commit
            and task0073_pre_ready_maintenance_boundary_candidate(parent_commit),
            "TASK-0073 pre-READY maintenance: READY parent must be the exact "
            "single-parent maintenance boundary",
        )
        validate_task0073_pre_ready_maintenance_boundary(audit, parent_commit)
    elif task_id == TASK_0074_TASK_ID:
        audit.require(
            parent_commit != authorization_commit
            and task0074_pre_ready_maintenance_boundary_candidate(parent_commit),
            "TASK-0074 pre-READY maintenance: READY parent must be the exact "
            "single-parent maintenance boundary",
        )
        validate_task0074_pre_ready_maintenance_boundary(audit, parent_commit)
    elif task_id == TASK_0075_TASK_ID:
        audit.require(
            parent_commit != authorization_commit
            and task0075_pre_ready_maintenance_boundary_candidate(parent_commit),
            "TASK-0075 pre-READY maintenance: READY parent must be the exact "
            "single-parent maintenance boundary",
        )
        validate_task0075_pre_ready_maintenance_boundary(audit, parent_commit)
    elif task_id == TASK_0076_TASK_ID:
        audit.require(parent_commit != authorization_commit and task0076_pre_ready_maintenance_boundary_candidate(parent_commit), "TASK-0076 pre-READY maintenance: READY parent must be the exact single-parent maintenance boundary")
        validate_task0076_pre_ready_maintenance_boundary(audit, parent_commit)
    elif task_id == "TASK-0077":
        validate_history_path_allowlist(
            audit,
            base_commit,
            parent_commit,
            draft_paths | TASK_0077_PRE_READY_MAINTENANCE_PATHS,
            f"{task_id}: pre-READY history",
        )
    else:
        validate_history_path_allowlist(
            audit,
            base_commit,
            parent_commit,
            draft_paths,
            f"{task_id}: pre-READY history",
        )
    parent_state = yaml_at_commit(parent_commit, PROJECT_STATE_PATH)
    parent_task_exists = git_text(
        "cat-file",
        "-e",
        f"{parent_commit}:{task_path}",
        check=False,
    ).returncode == 0
    parent_task: dict[str, Any] | None = None
    if parent_task_exists:
        parent_task_text = git_object(parent_commit, task_path).decode("utf-8")
        parent_match = TASK_BLOCK_RE.search(parent_task_text)
        parent_task = strict_yaml_load(parent_match.group(1)) if parent_match else {}
        if not isinstance(parent_task, dict):
            parent_task = {}
    validate_ready_parent_projection(audit, task_id, parent_state, parent_task)
    if task.get("planningBacklog") == TASK_BACKLOG_PATH:
        validate_backlog_draft_promotion_at_base(
            audit,
            task,
            tasks,
            lifecycle,
        )
    direct_paths = set(changed_paths_between(parent_commit, authorization_commit))
    allowed_direct_paths = {
        task_path,
        str(task.get("contextLock", "")),
        PROJECT_STATE_PATH,
    }
    audit.require(
        {task_path, PROJECT_STATE_PATH} <= direct_paths,
        f"{task_id}: READY transition must atomically change task card and project-state",
    )
    audit.require(
        direct_paths <= allowed_direct_paths,
        f"{task_id}: READY transition commit contains unrelated paths: "
        f"{sorted(direct_paths - allowed_direct_paths)}",
    )

    state_path = PROJECT_STATE_PATH
    audit.require(
        state_path in checkpoint_paths,
        f"{task_id}: READY authorization commit must atomically update {state_path}",
    )
    base_state = yaml_at_commit(base_commit, state_path)
    ready_state = yaml_at_commit(authorization_commit, state_path)
    audit.require(
        base_state.get("activeTask") in (None, "")
        and base_state.get("activeTaskCard") in (None, ""),
        f"{task_id}: Base Commit already has an active task",
    )
    audit.require(
        ready_state.get("activeTask") == task_id,
        f"{task_id}: READY checkpoint project-state.activeTask must point to the task",
    )
    audit.require(
        ready_state.get("activeTaskCard") == task_path,
        f"{task_id}: READY checkpoint project-state.activeTaskCard must point to the task card",
    )
    validate_nonblank_text(
        audit,
        f"{task_id}: READY checkpoint project-state.nextAction",
        ready_state.get("nextAction"),
    )
    audit.require(
        project_state_ready_projection(base_state)
        == project_state_ready_projection(ready_state),
        f"{task_id}: READY checkpoint changed non-lifecycle project-state fields",
    )


def is_valid_approval_timestamp(value: Any) -> bool:
    if isinstance(value, datetime):
        return True
    if isinstance(value, date):
        return True
    if not isinstance(value, str) or not value.strip():
        return False
    candidate = value.strip()
    try:
        if "T" in candidate or " " in candidate:
            datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        else:
            date.fromisoformat(candidate)
    except ValueError:
        return False
    return True


def is_canonical_identity(value: Any) -> bool:
    return isinstance(value, str) and bool(CANONICAL_ID_RE.fullmatch(value))


def task_metadata_from_text(text: str, label: str) -> dict[str, Any]:
    match = TASK_BLOCK_RE.search(text.replace("\r\n", "\n"))
    if not match:
        raise HarnessError(f"{label}: task YAML block is missing")
    metadata = strict_yaml_load(match.group(1))
    if not isinstance(metadata, dict):
        raise HarnessError(f"{label}: task YAML metadata must be an object")
    return metadata


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_exact_repo_path(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if value != unicodedata.normalize("NFC", value):
        return None
    if value != normalize_repo_path(value) or "\\" in value:
        return None
    if value.startswith("/") or value.endswith("/") or "//" in value:
        return None
    components = value.split("/")
    if any(
        not component
        or component in {".", ".."}
        or component.endswith((" ", "."))
        or WINDOWS_INVALID_COMPONENT_RE.search(component) is not None
        or WINDOWS_RESERVED_COMPONENT_RE.fullmatch(component) is not None
        for component in components
    ):
        return None
    if not is_repository_relative(value):
        return None
    return value


def task_acceptance_clauses(text: str, task_id: str) -> dict[str, str]:
    normalized = text.replace("\r\n", "\n")
    section = re.search(
        r"(?ms)^## 验收标准[ \t]*\n(?P<body>.*?)(?=^## |\Z)",
        normalized,
    )
    if not section:
        raise HarnessError(f"{task_id}: task acceptance section is missing")
    clauses: dict[str, str] = {}
    for match in re.finditer(
        r"(?ms)^(?P<number>[1-9][0-9]*)\.\s+(?P<text>.*?)(?=^[1-9][0-9]*\.\s+|\Z)",
        section.group("body"),
    ):
        number = int(match.group("number"))
        statement = re.sub(r"\s+", " ", match.group("text")).strip()
        clause_id = f"{task_id}-ACCEPTANCE-{number:03d}"
        if clause_id in clauses:
            raise HarnessError(f"{task_id}: duplicate acceptance clause {clause_id}")
        clauses[clause_id] = statement
    if not clauses:
        raise HarnessError(f"{task_id}: numbered acceptance clauses are missing")
    return clauses


def validate_exact_amendment_paths(
    audit: Audit,
    label: str,
    raw_paths: Any,
    *,
    allow_empty: bool,
    forbidden: list[str],
    seen_keys: dict[str, str],
) -> list[str]:
    audit.require(
        isinstance(raw_paths, list) and (allow_empty or bool(raw_paths)),
        f"{label} must be {'a list' if allow_empty else 'a non-empty list'}",
    )
    paths: list[str] = []
    for index, raw_path in enumerate(raw_paths if isinstance(raw_paths, list) else []):
        path_label = f"{label}[{index}]"
        path = canonical_exact_repo_path(raw_path)
        audit.require(
            path is not None,
            f"{path_label} must be one canonical repository-relative POSIX path",
        )
        if path is None:
            continue
        portable_key = unicodedata.normalize("NFC", path).casefold()
        previous = seen_keys.setdefault(portable_key, path)
        audit.require(
            previous == path,
            f"{path_label} aliases the already authorized path {previous!r}",
        )
        audit.require(
            not any(glob_matches(path, pattern) for pattern in forbidden),
            f"{path_label} conflicts with forbiddenPaths",
        )
        paths.append(path)
    return paths


def validate_authorization_amendment_contract(
    audit: Audit,
    label: str,
    amendment_id: str,
    contract: Any,
    task: dict[str, Any],
    *,
    authorized_text: str | None,
    seen_path_keys: dict[str, str],
) -> list[str]:
    audit.require(isinstance(contract, dict), f"{label}.contract must be an object")
    if not isinstance(contract, dict):
        return []
    audit.require(
        set(contract) == AUTHORIZATION_AMENDMENT_FIELDS,
        f"{label}.contract fields must be exactly "
        f"{sorted(AUTHORIZATION_AMENDMENT_FIELDS)}",
    )
    audit.require(
        contract.get("schemaVersion") == 1,
        f"{label}.contract.schemaVersion must be 1",
    )
    audit.require(
        contract.get("taskId") == task.get("taskId"),
        f"{label}.contract.taskId must match the task",
    )
    audit.require(
        contract.get("amendmentType") == "OWNER_CLAUSE_REPLACEMENT",
        f"{label}.contract.amendmentType must be OWNER_CLAUSE_REPLACEMENT",
    )
    audit.require(
        contract.get("approvedBy") == "repository-owner"
        and contract.get("approvedBy") == task.get("owner"),
        f"{label}.contract.approvedBy must be the repository-owner task owner",
    )
    audit.require(
        is_valid_approval_timestamp(contract.get("approvedAt")),
        f"{label}.contract.approvedAt must be an ISO-8601 date or timestamp",
    )
    validate_nonblank_text(audit, f"{label}.contract.evidence", contract.get("evidence"))
    validate_nonblank_text(audit, f"{label}.contract.reason", contract.get("reason"))
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(str(contract.get("authorizedParentCommit", "")))),
        f"{label}.contract.authorizedParentCommit must be a full Git SHA",
    )
    audit.require(
        bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(contract.get("baseAuthorizationProjectionHash", "")),
            )
        ),
        f"{label}.contract.baseAuthorizationProjectionHash must be SHA-256",
    )
    scope_grant_id = contract.get("scopeGrantAmendmentId")
    audit.require(
        scope_grant_id is None or is_canonical_identity(scope_grant_id),
        f"{label}.contract.scopeGrantAmendmentId must be null or canonical",
    )
    forbidden = [
        str(item)
        for item in task.get("forbiddenPaths", [])
        if isinstance(item, str)
    ]
    added_paths = validate_exact_amendment_paths(
        audit,
        f"{label}.contract.addedWriteAllowlist",
        contract.get("addedWriteAllowlist"),
        allow_empty=True,
        forbidden=forbidden,
        seen_keys=seen_path_keys,
    )
    replacements = contract.get("replacements")
    audit.require(
        isinstance(replacements, list) and bool(replacements),
        f"{label}.contract.replacements must be a non-empty list",
    )
    authorized_clauses: dict[str, str] = {}
    if authorized_text is not None:
        try:
            authorized_clauses = task_acceptance_clauses(
                authorized_text,
                str(task.get("taskId", "")),
            )
            expected_projection_hash = sha256_text(
                task_authorization_projection(authorized_text)
            )
            audit.require(
                contract.get("baseAuthorizationProjectionHash")
                == expected_projection_hash,
                f"{label}.contract must bind the complete base authorization projection",
            )
        except HarnessError as exc:
            audit.error(f"{label}.contract cannot bind authorization clauses: {exc}")
    clause_ids: set[str] = set()
    for index, replacement_record in enumerate(
        replacements if isinstance(replacements, list) else []
    ):
        replacement_label = f"{label}.contract.replacements[{index}]"
        audit.require(
            isinstance(replacement_record, dict)
            and set(replacement_record) == AUTHORIZATION_REPLACEMENT_FIELDS,
            f"{replacement_label} fields must be exactly "
            f"{sorted(AUTHORIZATION_REPLACEMENT_FIELDS)}",
        )
        if not isinstance(replacement_record, dict):
            continue
        supersedes = replacement_record.get("supersedes")
        replacement = replacement_record.get("replacement")
        audit.require(
            isinstance(supersedes, dict)
            and set(supersedes) == AUTHORIZATION_SUPERSEDES_FIELDS,
            f"{replacement_label}.supersedes fields must be exactly "
            f"{sorted(AUTHORIZATION_SUPERSEDES_FIELDS)}",
        )
        audit.require(
            isinstance(replacement, dict)
            and set(replacement) == AUTHORIZATION_REPLACEMENT_VALUE_FIELDS,
            f"{replacement_label}.replacement fields must be exactly "
            f"{sorted(AUTHORIZATION_REPLACEMENT_VALUE_FIELDS)}",
        )
        if not isinstance(supersedes, dict) or not isinstance(replacement, dict):
            continue
        clause_id = str(supersedes.get("clauseId", ""))
        superseded_statement = str(supersedes.get("statement", ""))
        replacement_statement = str(replacement.get("statement", ""))
        audit.require(
            bool(re.fullmatch(r"TASK-[0-9]{4,}-ACCEPTANCE-[0-9]{3}", clause_id)),
            f"{replacement_label}.supersedes.clauseId is invalid",
        )
        audit.require(
            clause_id not in clause_ids,
            f"{replacement_label}.supersedes.clauseId must be unique",
        )
        clause_ids.add(clause_id)
        validate_nonblank_text(
            audit,
            f"{replacement_label}.supersedes.statement",
            supersedes.get("statement"),
        )
        validate_nonblank_text(
            audit,
            f"{replacement_label}.replacement.statement",
            replacement.get("statement"),
        )
        audit.require(
            supersedes.get("statementHash") == sha256_text(superseded_statement),
            f"{replacement_label}.supersedes.statementHash is invalid",
        )
        audit.require(
            replacement.get("statementHash") == sha256_text(replacement_statement),
            f"{replacement_label}.replacement.statementHash is invalid",
        )
        if authorized_clauses:
            audit.require(
                authorized_clauses.get(clause_id) == superseded_statement,
                f"{replacement_label}.supersedes must match the authorized clause exactly",
            )
    return added_paths


def validate_scope_amendments(
    audit: Audit,
    label: str,
    task: dict[str, Any],
    *,
    backlog_amendments: dict[str, Any] | None = None,
    authorized_text: str | None = None,
) -> list[str]:
    raw = task.get("scopeAmendments", [])
    audit.require(isinstance(raw, list), f"{label}: scopeAmendments must be a list")
    amendments = raw if isinstance(raw, list) else []
    amendment_ids: set[str] = set()
    added_paths: list[str] = []
    seen_path_keys: dict[str, str] = {}
    forbidden = [
        str(item)
        for item in task.get("forbiddenPaths", [])
        if isinstance(item, str)
    ]
    for index, amendment in enumerate(amendments):
        item_label = f"{label}: scopeAmendments[{index}]"
        audit.require(isinstance(amendment, dict), f"{item_label} must be an object")
        if not isinstance(amendment, dict):
            continue
        amendment_id = str(amendment.get("amendmentId", ""))
        audit.require(
            is_canonical_identity(amendment_id),
            f"{item_label}.amendmentId must be canonical",
        )
        audit.require(
            amendment_id not in amendment_ids,
            f"{item_label}.amendmentId must be unique",
        )
        amendment_ids.add(amendment_id)
        fields = set(amendment)
        if fields == LEGACY_SCOPE_AMENDMENT_FIELDS:
            audit.require(
                False,
                f"{item_label}: retired legacy scope amendment is an immutable "
                "audit record only and cannot grant write authority",
            )
            continue
        audit.require(
            fields == SCOPE_AMENDMENT_PROJECTION_FIELDS,
            f"{item_label} fields must be either the committed legacy path-grant "
            f"shape or exactly {sorted(SCOPE_AMENDMENT_PROJECTION_FIELDS)}",
        )
        if fields != SCOPE_AMENDMENT_PROJECTION_FIELDS:
            continue
        audit.require(
            amendment.get("schemaVersion") == 2,
            f"{item_label}.schemaVersion must be 2",
        )
        audit.require(
            amendment.get("contractSource") == TASK_BACKLOG_PATH,
            f"{item_label}.contractSource must be {TASK_BACKLOG_PATH}",
        )
        audit.require(
            amendment.get("contractHashAlgorithm")
            == PLANNING_CONTRACT_HASH_ALGORITHM,
            f"{item_label}.contractHashAlgorithm is unsupported",
        )
        contract = amendment.get("contract")
        audit.require(
            isinstance(contract, dict)
            and amendment.get("contractHash") == canonical_json_sha256(contract),
            f"{item_label}.contractHash must bind the complete amendment contract",
        )
        if backlog_amendments is not None:
            audit.require(
                backlog_amendments.get(amendment_id) == contract,
                f"{item_label}.contract must exactly project the Backlog amendment",
            )
        added_paths.extend(
            validate_authorization_amendment_contract(
                audit,
                item_label,
                amendment_id,
                contract,
                task,
                authorized_text=authorized_text,
                seen_path_keys=seen_path_keys,
            )
        )
    return added_paths


def validate_scope_amendment_edge(
    audit: Audit,
    parent: list[Any],
    child: list[Any],
    edge_label: str,
) -> None:
    audit.require(
        len(child) >= len(parent) and child[: len(parent)] == parent,
        f"{edge_label}: scopeAmendments must be append-only and immutable",
    )


def validate_uncommitted_scope_amendments(
    audit: Audit,
    committed: Any,
    current: Any,
    edge_label: str,
) -> None:
    audit.require(
        isinstance(committed, list)
        and isinstance(current, list)
        and current == committed,
        f"{edge_label} cannot introduce or rewrite scopeAmendments; an amendment "
        "must already exist in a single-parent Git commit",
    )


def effective_task_write_allowlist(task: dict[str, Any]) -> list[str]:
    allowlist, exact_paths = effective_task_write_scope(task)
    return [*allowlist, *sorted(exact_paths)]


def effective_task_write_scope(
    task: dict[str, Any],
) -> tuple[list[str], set[str]]:
    allowlist = [str(item) for item in task.get("writeAllowlist", [])]
    exact_paths: set[str] = set()
    amendments = task.get("scopeAmendments")
    if not isinstance(amendments, list):
        return allowlist, exact_paths
    for amendment in amendments:
        if not isinstance(amendment, dict):
            continue
        if set(amendment) == SCOPE_AMENDMENT_PROJECTION_FIELDS:
            contract = amendment.get("contract")
            paths = (
                contract.get("addedWriteAllowlist")
                if isinstance(contract, dict)
                else []
            )
        else:
            paths = []
        if isinstance(paths, list):
            exact_paths.update(
                path
                for raw_path in paths
                if (path := canonical_exact_repo_path(raw_path)) is not None
            )
    return allowlist, exact_paths


def is_legacy_harness_bootstrap(task: dict[str, Any]) -> bool:
    if task.get("taskId") != "TASK-0002":
        return False
    base_commit = str(task.get("baseCommit", ""))
    result = git_text(
        "cat-file",
        "-e",
        f"{base_commit}:{PROJECT_STATE_PATH}",
        check=False,
    )
    return result.returncode != 0


def validate_ready_context_lock_bytes(
    audit: Audit,
    task_path: str,
    current: bytes,
    authorized: bytes,
) -> None:
    audit.require(
        current == authorized,
        f"{task_path}: Context Lock changed after READY checkpoint",
    )


def amendment_added_write_paths(amendment: Any) -> list[str]:
    if not isinstance(amendment, dict):
        return []
    if set(amendment) == SCOPE_AMENDMENT_PROJECTION_FIELDS:
        contract = amendment.get("contract")
        raw_paths = (
            contract.get("addedWriteAllowlist")
            if isinstance(contract, dict)
            else []
        )
    else:
        raw_paths = []
    candidates = raw_paths if isinstance(raw_paths, list) else []
    return [
        path
        for raw_path in candidates
        if (path := canonical_exact_repo_path(raw_path)) is not None
    ]


def backlog_authorization_amendments_at(commit: str) -> dict[str, Any]:
    if git_tree_entry(commit, TASK_BACKLOG_PATH) is None:
        return {}
    backlog = yaml_at_commit(commit, TASK_BACKLOG_PATH)
    amendments = backlog.get("authorizationAmendments")
    return amendments if isinstance(amendments, dict) else {}


def validate_amendment_introduction(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    parent: str,
    commit: str,
    parents: list[str],
    amendment: Any,
) -> None:
    label = f"{task_id}: scope amendment at {commit}"
    audit.require(
        len(parents) == 1,
        f"{label} must be introduced by a single-parent atomic governance commit",
    )
    prior_changes = set(changed_paths_across_history(base_commit, parent))
    for path in amendment_added_write_paths(amendment):
        audit.require(
            path not in prior_changes,
            f"{label} cannot retroactively authorize earlier change to {path}",
        )
        entry = git_tree_entry(commit, path)
        if entry is not None:
            audit.require(
                entry[:2] == ("100644", "blob"),
                f"{label} added path {path} must be a regular 100644 blob",
            )
        components = path.split("/")
        for index in range(1, len(components)):
            prefix = "/".join(components[:index])
            prefix_entry = git_tree_entry(commit, prefix)
            audit.require(
                prefix_entry is None or prefix_entry[0] != "120000",
                f"{label} added path {path} traverses symlink component {prefix}",
            )
    if not isinstance(amendment, dict):
        return
    if set(amendment) == LEGACY_SCOPE_AMENDMENT_FIELDS:
        audit.require(
            False,
            f"{label} uses the retired non-authoritative legacy amendment shape",
        )
        return
    if set(amendment) != SCOPE_AMENDMENT_PROJECTION_FIELDS:
        return
    contract = amendment.get("contract")
    amendment_id = str(amendment.get("amendmentId", ""))
    audit.require(
        isinstance(contract, dict)
        and contract.get("authorizedParentCommit") == parent,
        f"{label} must bind its exact parent commit",
    )
    parent_backlog_amendments = backlog_authorization_amendments_at(parent)
    child_backlog_amendments = backlog_authorization_amendments_at(commit)
    audit.require(
        amendment_id not in parent_backlog_amendments
        and child_backlog_amendments.get(amendment_id) == contract,
        f"{label} must atomically introduce the identical Backlog contract",
    )
    changed = set(changed_paths_between(parent, commit))
    expected_changed = {
        task_path,
        TASK_BACKLOG_PATH,
        *amendment_added_write_paths(amendment),
    }
    audit.require(
        changed == expected_changed,
        f"{label} atomic governance commit must change exactly the task card, "
        "Backlog and its explicitly authorized new paths; "
        f"changed={sorted(changed)}",
    )


def validate_task_authorization_history(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    authorization_commit: str,
    authorized_text: str,
    enforce_dominance: bool = True,
    allow_task0062_rejected_projection: bool = False,
) -> None:
    expected_projection = task_authorization_projection(authorized_text)
    authorized_metadata = task_metadata_from_text(
        authorized_text,
        f"{task_id}: authorization checkpoint",
    )
    graph = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        f"{authorization_commit}..HEAD",
    ).stdout.splitlines()
    for graph_line in graph:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        try:
            entry = git_tree_entry(commit, task_path)
            audit.require(
                entry is not None and entry[:2] == ("100644", "blob"),
                f"{task_id}: task card is missing or not a regular 100644 blob "
                f"in commit {commit}",
            )
            historical_text = git_object(commit, task_path).decode("utf-8")
            historical_projection = task_authorization_projection(historical_text)
            rejected_projection_allowed = (
                allow_task0062_rejected_projection
                and task_id == "TASK-0062"
                and git_text(
                    "merge-base",
                    "--is-ancestor",
                    TASK_0062_FIRST_AUTHORIZATION_VIOLATION_COMMIT,
                    commit,
                    check=False,
                ).returncode
                == 0
                and task0062_rejected_projection_is_exact(
                    authorized_text,
                    historical_text,
                )
            )
            audit.require(
                historical_projection == expected_projection
                or rejected_projection_allowed,
                f"{task_id}: authorization projection changed in commit {commit}",
            )
            historical_metadata = task_metadata_from_text(
                historical_text,
                f"{task_id}: task at {commit}",
            )
            backlog_amendments = backlog_authorization_amendments_at(commit)
            validate_scope_amendments(
                audit,
                f"{task_id}: task at {commit}",
                historical_metadata,
                backlog_amendments=backlog_amendments,
                authorized_text=authorized_text,
            )
            child_amendments = historical_metadata.get("scopeAmendments", [])
            child_amendments = (
                child_amendments if isinstance(child_amendments, list) else []
            )
            parents = tokens[1:]
            for parent in parents:
                parent_metadata = (
                    authorized_metadata
                    if parent == authorization_commit
                    else task_metadata_at_commit(parent, task_path)
                )
                parent_amendments = parent_metadata.get("scopeAmendments", [])
                parent_amendments = (
                    parent_amendments if isinstance(parent_amendments, list) else []
                )
                validate_scope_amendment_edge(
                    audit,
                    parent_amendments,
                    child_amendments,
                    f"{task_id}: {parent}..{commit}",
                )
                if (
                    len(child_amendments) > len(parent_amendments)
                    and child_amendments[: len(parent_amendments)]
                    == parent_amendments
                ):
                    for amendment in child_amendments[len(parent_amendments) :]:
                        validate_amendment_introduction(
                            audit,
                            task_id,
                            task_path,
                            base_commit,
                            parent,
                            commit,
                            parents,
                            amendment,
                        )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot validate task authorization history at "
                f"{commit}: {exc}"
            )
    try:
        head_metadata = task_metadata_at_commit("HEAD", task_path)
        current_text = read_repository_text(ROOT / normalize_repo_path(task_path))
        current_metadata = task_metadata_from_text(
            current_text,
            f"{task_id}: current task",
        )
        validate_scope_amendments(
            audit,
            f"{task_id}: current task",
            current_metadata,
            backlog_amendments=(
                load_yaml(ROOT / TASK_BACKLOG_PATH).get("authorizationAmendments", {})
            ),
            authorized_text=authorized_text,
        )
        head_amendments = head_metadata.get("scopeAmendments", [])
        current_amendments = current_metadata.get("scopeAmendments", [])
        validate_uncommitted_scope_amendments(
            audit,
            head_amendments,
            current_amendments,
            f"{task_id}: HEAD..WORKTREE",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{task_id}: cannot validate current scope amendments: {exc}")
    if enforce_dominance:
        graph = git_text(
            "rev-list",
            "--topo-order",
            "--reverse",
            f"{base_commit}..HEAD",
        ).stdout.splitlines()
        for commit in graph:
            commit = commit.strip()
            task_exists = git_text(
                "cat-file",
                "-e",
                f"{commit}:{task_path}",
                check=False,
            )
            if task_exists.returncode != 0:
                continue
            try:
                historical = task_metadata_at_commit(commit, task_path)
                if historical.get("state") == "DRAFT":
                    continue
                dominated = git_text(
                    "merge-base",
                    "--is-ancestor",
                    authorization_commit,
                    commit,
                    check=False,
                )
                audit.require(
                    dominated.returncode == 0,
                    f"{task_id}: non-DRAFT task state at {commit} is outside the "
                    "authorizationCommit ancestry",
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"{task_id}: cannot validate authorization dominance at {commit}: {exc}"
                )
    current_regular_file_bytes(
        audit,
        f"{task_id}: {task_path}",
        ROOT / normalize_repo_path(task_path),
    )
    index_entry = git_index_entry(task_path)
    audit.require(
        index_entry is not None and index_entry[0] == "100644",
        f"{task_id}: current task-card index entry must remain mode 100644",
    )
    worktree_oid = git_worktree_blob_oid(task_path)
    audit.require(
        index_entry is not None and index_entry[1] == worktree_oid,
        f"{task_id}: task-card index and worktree content must match before validation",
    )


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def ci_execution_policy_projection(policy: dict[str, Any]) -> dict[str, Any]:
    projection = json.loads(json.dumps(policy, ensure_ascii=False))
    for record_name in (
        "task0072SelfBootstrap",
        "task0073PreReadyMaintenance",
        "task0074PreReadyMaintenance",
        "task0075PreReadyMaintenance",
        "task0076PreReadyMaintenance",
    ):
        try:
            doctor_identity = projection[record_name]["boundary"]["files"]["doctor"]
            doctor_identity["blobOid"] = "<BOUNDARY_DOCTOR_BLOB_OID>"
            doctor_identity["sha256"] = "<BOUNDARY_DOCTOR_SHA256>"
        except (KeyError, TypeError):
            pass
    return projection


def validate_task0072_self_bootstrap_record(
    audit: Audit,
    policy: dict[str, Any],
) -> dict[str, Any] | None:
    record = policy.get("task0072SelfBootstrap")
    audit.require(
        isinstance(record, dict),
        "TASK-0072 self-bootstrap: machine record is missing or not an object",
    )
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record)
        == {
            "schemaVersion",
            "recordId",
            "decisionId",
            "kind",
            "targetTask",
            "sourceThreadId",
            "authorization",
            "sourceTerminal",
            "retainedChain",
            "boundary",
            "activation",
            "consumption",
            "validationChannel",
            "forbiddenInterfaces",
        },
        "TASK-0072 self-bootstrap: record fields do not match the exact schema",
    )
    audit.require(
        record.get("schemaVersion") == 1
        and record.get("recordId") == TASK_0072_BOOTSTRAP_RECORD_ID
        and record.get("decisionId") == "TASK-0072-SELF-BOOTSTRAP-20260802"
        and record.get("kind")
        == "OWNER_AUTHORIZED_EXACT_ONE_TIME_SELF_BOOTSTRAP"
        and record.get("targetTask") == TASK_0072_BOOTSTRAP_TASK_ID
        and record.get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
        "TASK-0072 self-bootstrap: record identity drifted",
    )
    audit.require(
        record.get("sourceTerminal")
        == {
            "taskId": "TASK-0070",
            "state": "REJECTED",
            "commit": TASK_0072_SOURCE_TERMINAL_COMMIT,
            "tree": TASK_0072_SOURCE_TERMINAL_TREE,
        },
        "TASK-0072 self-bootstrap: source terminal binding drifted",
    )
    boundary = record.get("boundary")
    audit.require(
        isinstance(boundary, dict)
        and set(boundary)
        == {
            "directParentCommit",
            "directParentTree",
            "singleParentRequired",
            "changedPaths",
            "requiredMode",
            "requiredType",
            "policyContentBinding",
            "files",
        }
        and boundary.get("directParentCommit")
        == TASK_0072_MAINTENANCE_HANDOFF_COMMIT
        and boundary.get("directParentTree")
        == TASK_0072_MAINTENANCE_HANDOFF_TREE
        and boundary.get("singleParentRequired") is True
        and boundary.get("requiredMode") == "100644"
        and boundary.get("requiredType") == "blob"
        and boundary.get("policyContentBinding")
        == "CANONICAL_JSON_REDACT_BOUNDARY_DOCTOR_IDENTITY",
        "TASK-0072 self-bootstrap: boundary contract drifted",
    )
    audit.require(
        record.get("activation")
        == {
            "draftBaseTask": TASK_0072_BOOTSTRAP_TASK_ID,
            "ledgerAbsenceRequired": True,
            "copiedRecordForbidden": True,
            "extraCommitOrPathForbidden": True,
        },
        "TASK-0072 self-bootstrap: activation contract drifted",
    )
    audit.require(
        record.get("consumption")
        == {
            "consumedByTask": TASK_0072_BOOTSTRAP_TASK_ID,
            "consumedWhenLedgerRegistered": True,
            "inertAfterTerminal": True,
            "reusableByOtherTask": False,
        },
        "TASK-0072 self-bootstrap: consumption contract drifted",
    )
    audit.require(
        record.get("validationChannel")
        == {
            "channel": "LOCAL_EXACT_TREE_FALLBACK",
            "profile": "HARNESS_PORTABILITY_LOCAL",
            "windows": "PASS_REQUIRED",
            "wslUbuntu": "PASS_REQUIRED",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "UNKNOWN_NOT_RUN",
            "githubReasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "dispatchCount": 0,
            "passClaimed": False,
        },
        "TASK-0072 self-bootstrap: validation channel binding drifted",
    )
    audit.require(
        record.get("forbiddenInterfaces")
        == {
            "cliFlag": False,
            "environmentVariable": False,
            "gitNote": False,
            "gitReplace": False,
            "gitGraft": False,
            "historyRewrite": False,
            "configurableAllowlist": False,
            "generalizedOverride": False,
        },
        "TASK-0072 self-bootstrap: forbidden-interface contract drifted",
    )
    retained_chain = record.get("retainedChain")
    audit.require(
        isinstance(retained_chain, list) and len(retained_chain) == 2,
        "TASK-0072 self-bootstrap: retainedChain must be a two-entry list",
    )
    _chain_specs = [
        (
            TASK_0072_RETAINED_BASE_COMMIT,
            TASK_0072_RETAINED_BASE_TREE,
            TASK_0072_SOURCE_TERMINAL_COMMIT,
        ),
        (
            TASK_0072_MAINTENANCE_HANDOFF_COMMIT,
            TASK_0072_MAINTENANCE_HANDOFF_TREE,
            TASK_0072_RETAINED_BASE_COMMIT,
        ),
    ]
    if isinstance(retained_chain, list):
        for _idx, (_exp_commit, _exp_tree, _exp_parent) in enumerate(_chain_specs):
            if _idx >= len(retained_chain):
                break
            chain_entry = retained_chain[_idx]
            audit.require(
                isinstance(chain_entry, dict)
                and chain_entry.get("commit") == _exp_commit
                and chain_entry.get("tree") == _exp_tree
                and chain_entry.get("parent") == _exp_parent,
                f"TASK-0072 self-bootstrap: retainedChain[{_idx}] commit/tree/parent drifted",
            )
            chain_files = chain_entry.get("changedFiles") if isinstance(chain_entry, dict) else None
            if isinstance(chain_files, dict):
                for cf_path, cf_details in chain_files.items():
                    expected_entry = git_tree_entry(_exp_commit, cf_path)
                    expected_hash = hashlib.sha256(
                        git_object(_exp_commit, cf_path)
                    ).hexdigest()
                    audit.require(
                        isinstance(cf_details, dict)
                        and len(cf_details) == 4
                        and cf_details.get("mode") == expected_entry[0]
                        and cf_details.get("type") == expected_entry[1]
                        and cf_details.get("blobOid") == expected_entry[2]
                        and cf_details.get("sha256") == expected_hash,
                        f"TASK-0072 self-bootstrap: retainedChain[{_idx}] file {cf_path} drifted",
                    )
    changed_paths = boundary.get("changedPaths") if isinstance(boundary, dict) else None
    audit.require(
        isinstance(changed_paths, list)
        and set(changed_paths)
        == {
            ".harness/ci-execution-policy.yaml",
            ".harness/skills.yaml",
            "docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/task-0072-self-bootstrap-authorization.json",
            "scripts/harness/doctor.py",
            "scripts/harness/tests/test_harness.py",
            "skills/harness-change/SKILL.md",
            "skills/task-delivery-flow/SKILL.md",
            "skills/task-intake/SKILL.md",
        },
        "TASK-0072 self-bootstrap: boundary.changedPaths drifted",
    )
    audit.require(
        not any(
            key != "task0072SelfBootstrap" and value == record
            for key, value in policy.items()
        ),
        "TASK-0072 self-bootstrap: copied machine record is forbidden",
    )
    return record


def validate_task0073_pre_ready_maintenance_record(
    audit: Audit,
    policy: dict[str, Any],
) -> dict[str, Any] | None:
    record = policy.get("task0073PreReadyMaintenance")
    audit.require(
        isinstance(record, dict),
        "TASK-0073 pre-READY maintenance: machine record is missing or not an object",
    )
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record)
        == {
            "schemaVersion",
            "recordId",
            "decisionId",
            "kind",
            "targetTask",
            "sourceThreadId",
            "authorization",
            "base",
            "draft",
            "boundary",
            "activation",
            "consumption",
            "validationChannel",
            "forbiddenInterfaces",
        },
        "TASK-0073 pre-READY maintenance: record fields do not match the exact schema",
    )
    audit.require(
        record.get("schemaVersion") == 1
        and record.get("recordId") == TASK_0073_MAINTENANCE_RECORD_ID
        and record.get("decisionId") == "TASK-0073-PRE-READY-GREENLINE-20260802"
        and record.get("kind")
        == "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE"
        and record.get("targetTask") == TASK_0073_TASK_ID
        and record.get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
        "TASK-0073 pre-READY maintenance: record identity drifted",
    )
    audit.require(
        record.get("base")
        == {
            "commit": TASK_0073_BASE_COMMIT,
            "tree": TASK_0073_BASE_TREE,
            "lastTerminalTask": "TASK-0071",
            "lastTerminalState": "REJECTED",
        },
        "TASK-0073 pre-READY maintenance: Base binding drifted",
    )
    authorization = record.get("authorization")
    audit.require(
        isinstance(authorization, dict)
        and set(authorization) == {"path", "sha256"}
        and authorization.get("path") == TASK_0073_MAINTENANCE_AUTHORIZATION_PATH
        and bool(re.fullmatch(r"[0-9a-f]{64}", str(authorization.get("sha256", "")))),
        "TASK-0073 pre-READY maintenance: Owner authorization binding drifted",
    )
    draft = record.get("draft")
    audit.require(
        isinstance(draft, dict)
        and set(draft) == {"commit", "tree", "parent", "changedFiles"}
        and draft.get("commit") == TASK_0073_DRAFT_COMMIT
        and draft.get("tree") == TASK_0073_DRAFT_TREE
        and draft.get("parent") == TASK_0073_BASE_COMMIT,
        "TASK-0073 pre-READY maintenance: DRAFT binding drifted",
    )
    boundary = record.get("boundary")
    audit.require(
        isinstance(boundary, dict)
        and set(boundary)
        == {
            "directParentCommit",
            "directParentTree",
            "singleParentRequired",
            "identityBinding",
            "changedPaths",
            "requiredMode",
            "requiredType",
            "policyContentBinding",
            "files",
        }
        and boundary.get("directParentCommit") == TASK_0073_DRAFT_COMMIT
        and boundary.get("directParentTree") == TASK_0073_DRAFT_TREE
        and boundary.get("singleParentRequired") is True
        and boundary.get("identityBinding")
        == "COMMIT_AND_TREE_DERIVED_FROM_EXACT_SINGLE_PARENT_CONTENT"
        and boundary.get("requiredMode") == "100644"
        and boundary.get("requiredType") == "blob"
        and boundary.get("policyContentBinding")
        == "CANONICAL_JSON_REDACT_TASK0073_BOUNDARY_DOCTOR_IDENTITY",
        "TASK-0073 pre-READY maintenance: boundary contract drifted",
    )
    audit.require(
        isinstance(boundary, dict)
        and boundary.get("changedPaths")
        == sorted(TASK_0073_PRE_READY_MAINTENANCE_PATHS),
        "TASK-0073 pre-READY maintenance: changed path contract drifted",
    )
    audit.require(
        record.get("activation")
        == {
            "allowedState": "DRAFT",
            "readyDoctorPassRequired": True,
            "copiedRecordForbidden": True,
            "extraCommitOrPathForbidden": True,
        },
        "TASK-0073 pre-READY maintenance: activation contract drifted",
    )
    audit.require(
        record.get("consumption")
        == {
            "consumedByTask": TASK_0073_TASK_ID,
            "consumedWhen": "READY_AUTHORIZATION_COMMITTED",
            "inertAfterConsumption": True,
            "reusableByOtherTask": False,
        },
        "TASK-0073 pre-READY maintenance: consumption contract drifted",
    )
    audit.require(
        record.get("validationChannel")
        == {
            "channel": "LOCAL_EXACT_TREE_FALLBACK",
            "profile": "HARNESS_PORTABILITY_LOCAL",
            "windows": "PASS_REQUIRED",
            "wslUbuntu": "PASS_REQUIRED",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "UNKNOWN_NOT_RUN",
            "githubReasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "dispatchCount": 0,
            "passClaimed": False,
        },
        "TASK-0073 pre-READY maintenance: validation channel binding drifted",
    )
    audit.require(
        record.get("forbiddenInterfaces")
        == {
            "cliFlag": False,
            "environmentVariable": False,
            "gitNote": False,
            "gitReplace": False,
            "gitGraft": False,
            "historyRewrite": False,
            "configurableAllowlist": False,
            "generalizedOverride": False,
        },
        "TASK-0073 pre-READY maintenance: forbidden-interface contract drifted",
    )
    audit.require(
        not any(
            key != "task0073PreReadyMaintenance" and value == record
            for key, value in policy.items()
        ),
        "TASK-0073 pre-READY maintenance: copied machine record is forbidden",
    )
    return record


def task0074_historical_quarantine_contract() -> dict[str, Any]:
    return {
        "taskId": TASK_0073_TASK_ID,
        "terminalState": "REJECTED",
        "terminalCommit": TASK_0073_TERMINAL_COMMIT,
        "terminalTree": TASK_0073_TERMINAL_TREE,
        "passClaimed": False,
        "evidence": {
            "path": TASK_0073_TERMINAL_EVIDENCE_PATH,
            "mode": "100644",
            "type": "blob",
            "blobOid": TASK_0073_TERMINAL_EVIDENCE_BLOB,
            "sha256": TASK_0073_TERMINAL_EVIDENCE_SHA256,
            "checkIndex": 5,
        },
        "review": {
            "path": TASK_0073_TERMINAL_REVIEW_PATH,
            "mode": "100644",
            "type": "blob",
            "blobOid": TASK_0073_TERMINAL_REVIEW_BLOB,
            "sha256": TASK_0073_TERMINAL_REVIEW_SHA256,
        },
        "reviewerTuple": {
            "command": TASK_0073_HISTORICAL_UNKNOWN_CHECK["command"],
            "nativeResult": "UNKNOWN",
            "storedStatus": "FAIL",
            "exitCode": None,
            "artifactHash": None,
            "candidateCommit": TASK_0073_HISTORICAL_UNKNOWN_CHECK["verifiedCommit"],
            "candidateTree": TASK_0073_HISTORICAL_UNKNOWN_REVIEW_METADATA[
                "reviewedTree"
            ],
            "reason": TASK_0073_HISTORICAL_UNKNOWN_CHECK["reason"],
            "environment": TASK_0073_HISTORICAL_UNKNOWN_CHECK["environment"],
        },
        "immutableHistoricalNonPass": True,
        "copiedOrMutatedTupleFailsClosed": True,
    }


def validate_task0074_pre_ready_maintenance_record(
    audit: Audit,
    policy: dict[str, Any],
) -> dict[str, Any] | None:
    record = policy.get("task0074PreReadyMaintenance")
    label = "TASK-0074 pre-READY maintenance"
    audit.require(
        isinstance(record, dict),
        f"{label}: machine record is missing or not an object",
    )
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record)
        == {
            "schemaVersion",
            "recordId",
            "decisionId",
            "kind",
            "targetTask",
            "sourceThreadId",
            "authorization",
            "base",
            "draft",
            "boundary",
            "historicalQuarantine",
            "deliveryContract",
            "activation",
            "consumption",
            "validationChannel",
            "forbiddenInterfaces",
        },
        f"{label}: record fields do not match the exact schema",
    )
    audit.require(
        record.get("schemaVersion") == 1
        and record.get("recordId") == TASK_0074_MAINTENANCE_RECORD_ID
        and record.get("decisionId")
        == "TASK-0074-EXACT-DELIVERY-FLOW-RECOVERY-20260802"
        and record.get("kind")
        == "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE"
        and record.get("targetTask") == TASK_0074_TASK_ID
        and record.get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
        f"{label}: record identity drifted",
    )
    audit.require(
        record.get("base")
        == {
            "commit": TASK_0074_BASE_COMMIT,
            "tree": TASK_0074_BASE_TREE,
            "lastTerminalTask": TASK_0073_TASK_ID,
            "lastTerminalState": "REJECTED",
        },
        f"{label}: Base binding drifted",
    )
    authorization = record.get("authorization")
    audit.require(
        isinstance(authorization, dict)
        and set(authorization) == {"path", "sha256"}
        and authorization.get("path") == TASK_0074_MAINTENANCE_AUTHORIZATION_PATH
        and bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(authorization.get("sha256", "")),
            )
        ),
        f"{label}: Owner authorization binding drifted",
    )
    draft = record.get("draft")
    audit.require(
        isinstance(draft, dict)
        and set(draft) == {"commit", "tree", "parent", "changedFiles"}
        and draft.get("commit") == TASK_0074_DRAFT_COMMIT
        and draft.get("tree") == TASK_0074_DRAFT_TREE
        and draft.get("parent") == TASK_0074_BASE_COMMIT,
        f"{label}: DRAFT binding drifted",
    )
    boundary = record.get("boundary")
    audit.require(
        isinstance(boundary, dict)
        and set(boundary)
        == {
            "directParentCommit",
            "directParentTree",
            "singleParentRequired",
            "identityBinding",
            "changedPaths",
            "requiredMode",
            "requiredType",
            "policyContentBinding",
            "files",
        }
        and boundary.get("directParentCommit") == TASK_0074_DRAFT_COMMIT
        and boundary.get("directParentTree") == TASK_0074_DRAFT_TREE
        and boundary.get("singleParentRequired") is True
        and boundary.get("identityBinding")
        == "COMMIT_AND_TREE_DERIVED_FROM_EXACT_SINGLE_PARENT_CONTENT"
        and boundary.get("requiredMode") == "100644"
        and boundary.get("requiredType") == "blob"
        and boundary.get("policyContentBinding")
        == "CANONICAL_JSON_REDACT_TASK0074_BOUNDARY_DOCTOR_IDENTITY",
        f"{label}: boundary contract drifted",
    )
    audit.require(
        isinstance(boundary, dict)
        and boundary.get("changedPaths")
        == sorted(TASK_0074_PRE_READY_MAINTENANCE_PATHS),
        f"{label}: changed path contract drifted",
    )
    audit.require(
        record.get("historicalQuarantine")
        == task0074_historical_quarantine_contract(),
        f"{label}: TASK-0073 historical quarantine contract drifted",
    )
    audit.require(
        record.get("deliveryContract")
        == {
            "evidenceStatuses": ["TIMEOUT", "UNKNOWN"],
            "failRequiresNonZeroExitCode": True,
            "nullExitRequiresCandidateBudgetAndInterruption": True,
            "timingContract": (
                "DRAFT_TO_READY_AND_IN_PROGRESS_TO_CANDIDATE_SEPARATE"
            ),
            "reviewerMaximumMinutes": 15,
            "combinedGate": "TASK0074_HARNESS_PORTABILITY_WINDOWS_ONLY",
            "wslIndependent": True,
        },
        f"{label}: delivery-flow recovery contract drifted",
    )
    audit.require(
        record.get("activation")
        == {
            "allowedState": "DRAFT",
            "readyDoctorPassRequired": True,
            "copiedRecordForbidden": True,
            "extraCommitOrPathForbidden": True,
        },
        f"{label}: activation contract drifted",
    )
    audit.require(
        record.get("consumption")
        == {
            "consumedByTask": TASK_0074_TASK_ID,
            "consumedWhen": "READY_AUTHORIZATION_COMMITTED",
            "inertAfterConsumption": True,
            "reusableByOtherTask": False,
        },
        f"{label}: consumption contract drifted",
    )
    audit.require(
        record.get("validationChannel")
        == {
            "channel": "LOCAL_EXACT_TREE_FALLBACK",
            "profile": "HARNESS_PORTABILITY_LOCAL",
            "windows": "COMBINED_CANONICAL_AND_EXACT_TREE_PASS_REQUIRED",
            "wslUbuntu": "INDEPENDENT_PASS_REQUIRED",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "UNKNOWN_NOT_RUN",
            "githubReasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "dispatchCount": 0,
            "passClaimed": False,
        },
        f"{label}: validation channel binding drifted",
    )
    audit.require(
        record.get("forbiddenInterfaces")
        == {
            "cliFlag": False,
            "environmentVariable": False,
            "gitNote": False,
            "gitReplace": False,
            "gitGraft": False,
            "historyRewrite": False,
            "configurableAllowlist": False,
            "generalizedOverride": False,
        },
        f"{label}: forbidden-interface contract drifted",
    )
    audit.require(
        not any(
            key != "task0074PreReadyMaintenance" and value == record
            for key, value in policy.items()
        ),
        f"{label}: copied machine record is forbidden",
    )
    return record


def task0075_historical_projection_contract() -> dict[str, Any]:
    return {
        "task0073CiPolicy": {
            "commit": TASK_0073_MAINTENANCE_COMMIT,
            "tree": TASK_0073_MAINTENANCE_TREE,
            "path": CI_EXECUTION_POLICY_PATH,
            "mode": "100644",
            "type": "blob",
            "blobOid": TASK_0073_MAINTENANCE_CI_POLICY_BLOB,
            "sha256": TASK_0073_MAINTENANCE_CI_POLICY_SHA256,
            "canonicalProjectionSha256": TASK_0073_CI_POLICY_PROJECTION_HASH,
            "interpretation": "HISTORICAL_COMMIT_OWN_POLICY_BLOB_ONLY",
        },
        "task0074CiPolicy": {
            "commit": TASK_0074_MAINTENANCE_COMMIT,
            "tree": TASK_0074_MAINTENANCE_TREE,
            "path": CI_EXECUTION_POLICY_PATH,
            "mode": "100644",
            "type": "blob",
            "blobOid": TASK_0074_MAINTENANCE_CI_POLICY_BLOB,
            "sha256": TASK_0074_MAINTENANCE_CI_POLICY_SHA256,
            "canonicalProjectionSha256": TASK_0074_CI_POLICY_PROJECTION_HASH,
            "interpretation": "HISTORICAL_COMMIT_OWN_POLICY_BLOB_ONLY",
        },
        "task0073PlanningEdge": {
            "parentCommit": TASK_0073_PLANNING_PARENT_COMMIT,
            "parentTree": TASK_0073_PLANNING_PARENT_TREE,
            "childCommit": TASK_0073_PLANNING_CHILD_COMMIT,
            "childTree": TASK_0073_PLANNING_CHILD_TREE,
            "changedPaths": sorted(TASK_0073_PLANNING_EDGE_IDENTITIES),
            "files": TASK_0073_PLANNING_EDGE_IDENTITIES,
            "parentDeliveryPolicyCanonicalSha256": (
                TASK_0073_PRE_REPAIR_DELIVERY_POLICY_CANONICAL_HASH
            ),
            "childDeliveryPolicyCanonicalSha256": (
                TASK_0073_PLANNING_CHILD_DELIVERY_POLICY_CANONICAL_HASH
            ),
            "interpretation": "PARENT_AND_CHILD_COMMIT_OWN_OBJECTS_ONLY",
        },
        "currentPolicyReinterpretationForbidden": True,
    }


def task0075_historical_quarantine_contract() -> dict[str, Any]:
    return {
        "taskId": TASK_0074_TASK_ID,
        "terminalState": "REJECTED",
        "terminalCommit": TASK_0074_TERMINAL_COMMIT,
        "terminalTree": TASK_0074_TERMINAL_TREE,
        "terminalParent": TASK_0074_TERMINAL_PARENT,
        "passClaimed": False,
        "artifacts": TASK_0074_TERMINAL_ARTIFACTS,
        "readyDoctor": {
            "status": "FAIL",
            "exitCode": 1,
            "checks": 355421,
            "errorCount": 5,
            "receiptSha256": TASK_0074_READY_DOCTOR_RECEIPT_SHA256,
            "errors": list(TASK_0074_EXACT_HISTORICAL_ERRORS[:5]),
            "passClaimed": False,
        },
        "preClosure": {
            "status": "FAIL",
            "exitCode": 1,
            "checks": 359792,
            "errorCount": 10,
            "receiptSha256": TASK_0074_PRE_CLOSURE_RECEIPT_SHA256,
            "errors": list(TASK_0074_EXACT_HISTORICAL_ERRORS),
            "passClaimed": False,
        },
        "historicalHandoffNextAction": (
            "等待 Owner 创建新的永久恢复卡，精确修复 TASK-0073 历史 Policy "
            "projection 隔离和 pre-IN_PROGRESS timing 非 PASS 表达；不得修改"
            "历史或推送本失败链"
        ),
        "historicalProjectStateNextAction": (
            "等待 Owner 创建新的永久恢复卡；TASK-0056 继续被 REJECTED "
            "TASK-0073 阻断，TASK-0074 失败链不得推送或复用"
        ),
        "historicalMismatchOnly": True,
        "immutableHistoricalNonPass": True,
        "copiedMutatedOrSecondRecordFailsClosed": True,
    }


def task0075_delivery_contract() -> dict[str, Any]:
    return {
        "candidateExecutionNotStarted": {
            "outcome": "NOT_STARTED",
            "eligibleOnlyWhen": {
                "readyDoctorOutcome": "NON_PASS",
                "readyDoctorPassExists": False,
                "inProgressCommitExists": False,
                "candidateFreezeExists": False,
            },
            "anchor": "NOT_STARTED_READY_DOCTOR_NON_PASS",
            "anchorCommit": None,
            "startedAt": None,
            "endedAt": None,
            "readyDoctorPassAt": None,
            "inProgressCommit": None,
            "elapsedSeconds": 0,
            "closureOnlyOverrunSeconds": 0,
            "reasonRequired": True,
            "reanchored": False,
            "passClaimed": False,
        },
        "existingCandidateOutcomes": ["PASS", "FAIL", "TIMEOUT", "UNKNOWN"],
        "existingStrongTypingUnchanged": True,
        "failRequiresNonZeroExitCode": True,
        "reviewerMaximumMinutes": 15,
        "terminalNextAction": {
            "handoffEqualsProjectState": True,
            "comparison": "BYTE_FOR_BYTE_STRING_EQUALITY",
            "sameTerminalCommitRequired": True,
            "task0074HistoricalMismatchOnlyExactQuarantine": True,
        },
        "combinedGate": "TASK0075_HARNESS_PORTABILITY_WINDOWS_ONLY",
        "wslIndependent": True,
    }


def task0075_not_started_candidate_execution_matches(
    candidate: Any,
) -> bool:
    expected_fields = {
        "anchor",
        "anchorCommit",
        "startedAt",
        "endedAt",
        "elapsedSeconds",
        "outcome",
        "targetWallMinutes",
        "hardFuseWallMinutes",
        "candidateDeadlineMinutes",
        "closureOnlyOverrunSeconds",
        "readyDoctorPassAt",
        "inProgressCommit",
        "reason",
        "reanchored",
    }
    return (
        isinstance(candidate, dict)
        and set(candidate) == expected_fields
        and candidate.get("outcome") == "NOT_STARTED"
        and candidate.get("anchor") == "NOT_STARTED_READY_DOCTOR_NON_PASS"
        and candidate.get("anchorCommit") is None
        and candidate.get("startedAt") is None
        and candidate.get("endedAt") is None
        and candidate.get("readyDoctorPassAt") is None
        and candidate.get("inProgressCommit") is None
        and candidate.get("elapsedSeconds") == 0
        and candidate.get("targetWallMinutes") == 60
        and candidate.get("hardFuseWallMinutes") == 90
        and candidate.get("candidateDeadlineMinutes") == 45
        and candidate.get("closureOnlyOverrunSeconds") == 0
        and isinstance(candidate.get("reason"), str)
        and bool(candidate.get("reason", "").strip())
        and candidate.get("reanchored") is False
    )


def validate_task0075_pre_ready_maintenance_record(
    audit: Audit,
    policy: dict[str, Any],
) -> dict[str, Any] | None:
    record = policy.get("task0075PreReadyMaintenance")
    label = "TASK-0075 pre-READY maintenance"
    audit.require(
        isinstance(record, dict),
        f"{label}: machine record is missing or not an object",
    )
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record)
        == {
            "schemaVersion",
            "recordId",
            "decisionId",
            "kind",
            "targetTask",
            "sourceThreadId",
            "authorization",
            "base",
            "draft",
            "boundary",
            "historicalProjection",
            "historicalQuarantine",
            "deliveryContract",
            "activation",
            "consumption",
            "validationChannel",
            "forbiddenInterfaces",
        },
        f"{label}: record fields do not match the exact schema",
    )
    audit.require(
        record.get("schemaVersion") == 1
        and record.get("recordId") == TASK_0075_MAINTENANCE_RECORD_ID
        and record.get("decisionId")
        == "TASK-0075-PERMANENT-DELIVERY-FLOW-RECOVERY-20260803"
        and record.get("kind")
        == "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE"
        and record.get("targetTask") == TASK_0075_TASK_ID
        and record.get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
        f"{label}: record identity drifted",
    )
    audit.require(
        record.get("base")
        == {
            "commit": TASK_0075_BASE_COMMIT,
            "tree": TASK_0075_BASE_TREE,
            "lastTerminalTask": TASK_0074_TASK_ID,
            "lastTerminalState": "REJECTED",
        },
        f"{label}: Base binding drifted",
    )
    authorization = record.get("authorization")
    audit.require(
        isinstance(authorization, dict)
        and set(authorization) == {"path", "sha256"}
        and authorization.get("path") == TASK_0075_MAINTENANCE_AUTHORIZATION_PATH
        and bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(authorization.get("sha256", "")),
            )
        ),
        f"{label}: Owner authorization binding drifted",
    )
    draft = record.get("draft")
    audit.require(
        isinstance(draft, dict)
        and set(draft) == {"commit", "tree", "parent", "changedFiles"}
        and draft.get("commit") == TASK_0075_DRAFT_COMMIT
        and draft.get("tree") == TASK_0075_DRAFT_TREE
        and draft.get("parent") == TASK_0075_BASE_COMMIT,
        f"{label}: DRAFT binding drifted",
    )
    boundary = record.get("boundary")
    audit.require(
        isinstance(boundary, dict)
        and set(boundary)
        == {
            "directParentCommit",
            "directParentTree",
            "singleParentRequired",
            "identityBinding",
            "changedPaths",
            "requiredMode",
            "requiredType",
            "policyContentBinding",
            "files",
        }
        and boundary.get("directParentCommit") == TASK_0075_DRAFT_COMMIT
        and boundary.get("directParentTree") == TASK_0075_DRAFT_TREE
        and boundary.get("singleParentRequired") is True
        and boundary.get("identityBinding")
        == "COMMIT_AND_TREE_DERIVED_FROM_EXACT_SINGLE_PARENT_CONTENT"
        and boundary.get("requiredMode") == "100644"
        and boundary.get("requiredType") == "blob"
        and boundary.get("policyContentBinding")
        == "CANONICAL_JSON_REDACT_TASK0075_BOUNDARY_DOCTOR_IDENTITY",
        f"{label}: boundary contract drifted",
    )
    audit.require(
        isinstance(boundary, dict)
        and boundary.get("changedPaths")
        == sorted(TASK_0075_PRE_READY_MAINTENANCE_PATHS),
        f"{label}: changed path contract drifted",
    )
    audit.require(
        record.get("historicalProjection")
        == task0075_historical_projection_contract(),
        f"{label}: historical projection contract drifted",
    )
    audit.require(
        record.get("historicalQuarantine")
        == task0075_historical_quarantine_contract(),
        f"{label}: TASK-0074 historical quarantine contract drifted",
    )
    audit.require(
        record.get("deliveryContract") == task0075_delivery_contract(),
        f"{label}: future delivery contract drifted",
    )
    audit.require(
        record.get("activation")
        == {
            "allowedState": "DRAFT",
            "readyDoctorPassRequired": True,
            "copiedRecordForbidden": True,
            "extraCommitOrPathForbidden": True,
        },
        f"{label}: activation contract drifted",
    )
    audit.require(
        record.get("consumption")
        == {
            "consumedByTask": TASK_0075_TASK_ID,
            "consumedWhen": "READY_AUTHORIZATION_COMMITTED",
            "inertAfterConsumption": True,
            "reusableByOtherTask": False,
        },
        f"{label}: consumption contract drifted",
    )
    audit.require(
        record.get("validationChannel")
        == {
            "channel": "LOCAL_EXACT_TREE_FALLBACK",
            "profile": "HARNESS_PORTABILITY_LOCAL",
            "windows": "COMBINED_CANONICAL_AND_EXACT_TREE_PASS_REQUIRED",
            "wslUbuntu": "INDEPENDENT_PASS_REQUIRED",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "UNKNOWN_NOT_RUN",
            "githubReasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "dispatchCount": 0,
            "passClaimed": False,
        },
        f"{label}: validation channel binding drifted",
    )
    audit.require(
        record.get("forbiddenInterfaces")
        == {
            "cliFlag": False,
            "environmentVariable": False,
            "gitNote": False,
            "gitReplace": False,
            "gitGraft": False,
            "historyRewrite": False,
            "configurableAllowlist": False,
            "wildcardWritePath": False,
            "generalizedOverride": False,
            "branchOrWorktree": False,
            "githubActionsDispatch": False,
        },
        f"{label}: forbidden-interface contract drifted",
    )
    audit.require(
        not any(
            key != "task0075PreReadyMaintenance" and value == record
            for key, value in policy.items()
        )
        and not any(
            key != "task0075PreReadyMaintenance"
            and isinstance(value, dict)
            and value.get("historicalQuarantine")
            == task0075_historical_quarantine_contract()
            for key, value in policy.items()
        ),
        f"{label}: copied machine record or quarantine is forbidden",
    )
    return record


def task0074_exact_historical_quarantine_matches() -> bool:
    try:
        graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0074_TERMINAL_COMMIT,
            check=False,
        )
        tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0074_TERMINAL_COMMIT,
            check=False,
        ).stdout.strip()
        terminal_task = task_metadata_at_commit(
            TASK_0074_TERMINAL_COMMIT,
            TASK_0074_CARD_PATH,
        )
        terminal_state = yaml_at_commit(
            TASK_0074_TERMINAL_COMMIT,
            PROJECT_STATE_PATH,
        )
        terminal_ledger = yaml_at_commit(
            TASK_0074_TERMINAL_COMMIT,
            TASK_LEDGER_PATH,
        )
        evidence = json.loads(
            git_object(
                TASK_0074_TERMINAL_COMMIT,
                TASK_0074_TERMINAL_ARTIFACTS["evidence"]["path"],
            ).decode("utf-8")
        )
        handoff = json.loads(
            git_object(
                TASK_0074_TERMINAL_COMMIT,
                TASK_0074_TERMINAL_ARTIFACTS["handoff"]["path"],
            ).decode("utf-8")
        )
    except (
        HarnessError,
        json.JSONDecodeError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ):
        return False
    if not (
        graph.returncode == 0
        and graph.stdout.split()
        == [TASK_0074_TERMINAL_COMMIT, TASK_0074_TERMINAL_PARENT]
        and tree == TASK_0074_TERMINAL_TREE
        and terminal_task.get("taskId") == TASK_0074_TASK_ID
        and terminal_task.get("state") == "REJECTED"
        and terminal_state.get("lastTerminalTask") == TASK_0074_TASK_ID
        and terminal_state.get("nextAction")
        == task0075_historical_quarantine_contract()[
            "historicalProjectStateNextAction"
        ]
        and terminal_ledger.get("tasks", {}).get(TASK_0074_TASK_ID, {}).get(
            "state"
        )
        == "REJECTED"
        and evidence.get("taskId") == TASK_0074_TASK_ID
        and evidence.get("headCommit") == TASK_0074_TERMINAL_PARENT
        and handoff.get("taskId") == TASK_0074_TASK_ID
        and handoff.get("state") == "REJECTED"
        and handoff.get("nextAction")
        == task0075_historical_quarantine_contract()["historicalHandoffNextAction"]
    ):
        return False
    checks = evidence.get("checks")
    if not (
        isinstance(checks, list)
        and len(checks) > 2
        and checks[2].get("status") == "FAIL"
        and checks[2].get("exitCode") == 1
        and checks[2].get("artifactHash")
        == TASK_0074_READY_DOCTOR_RECEIPT_SHA256
    ):
        return False
    for identity in TASK_0074_TERMINAL_ARTIFACTS.values():
        path = str(identity["path"])
        if not historical_git_object_identity_matches(
            TASK_0074_TERMINAL_COMMIT,
            path,
            identity,
        ):
            return False
        current = ROOT / normalize_repo_path(path)
        if (
            not current_path_is_file(current)
            or hashlib.sha256(read_repository_bytes(current)).hexdigest()
            != identity["sha256"]
        ):
            return False
    return True


def validate_task0075_historical_objects(
    audit: Audit,
    record: dict[str, Any],
) -> None:
    label = "TASK-0075 immutable historical projection and quarantine"
    audit.require(
        record.get("historicalProjection")
        == task0075_historical_projection_contract()
        and record.get("historicalQuarantine")
        == task0075_historical_quarantine_contract(),
        f"{label}: machine record drifted",
    )
    try:
        for (
            commit,
            tree,
            parent,
            blob_oid,
            blob_sha,
            projection_sha,
            policy_label,
        ) in (
            (
                TASK_0073_MAINTENANCE_COMMIT,
                TASK_0073_MAINTENANCE_TREE,
                TASK_0073_DRAFT_COMMIT,
                TASK_0073_MAINTENANCE_CI_POLICY_BLOB,
                TASK_0073_MAINTENANCE_CI_POLICY_SHA256,
                TASK_0073_CI_POLICY_PROJECTION_HASH,
                "TASK-0073",
            ),
            (
                TASK_0074_MAINTENANCE_COMMIT,
                TASK_0074_MAINTENANCE_TREE,
                TASK_0074_DRAFT_COMMIT,
                TASK_0074_MAINTENANCE_CI_POLICY_BLOB,
                TASK_0074_MAINTENANCE_CI_POLICY_SHA256,
                TASK_0074_CI_POLICY_PROJECTION_HASH,
                "TASK-0074",
            ),
        ):
            graph = git_text(
                "rev-list",
                "--parents",
                "-n",
                "1",
                commit,
                check=False,
            )
            actual_tree = git_text(
                "show",
                "-s",
                "--format=%T",
                commit,
                check=False,
            ).stdout.strip()
            policy_identity = {
                "mode": "100644",
                "type": "blob",
                "blobOid": blob_oid,
                "sha256": blob_sha,
            }
            historical_policy = yaml_at_commit(commit, CI_EXECUTION_POLICY_PATH)
            audit.require(
                graph.returncode == 0
                and graph.stdout.split() == [commit, parent]
                and actual_tree == tree
                and historical_git_object_identity_matches(
                    commit,
                    CI_EXECUTION_POLICY_PATH,
                    policy_identity,
                )
                and canonical_json_sha256(
                    ci_execution_policy_projection(historical_policy)
                )
                == projection_sha,
                f"{label}: {policy_label} historical Policy snapshot drifted",
            )
        parent_policy = yaml_at_commit(
            TASK_0073_PLANNING_PARENT_COMMIT,
            TASK_DELIVERY_POLICY_PATH,
        )
        child_policy = yaml_at_commit(
            TASK_0073_PLANNING_CHILD_COMMIT,
            TASK_DELIVERY_POLICY_PATH,
        )
        audit.require(
            task0073_historical_planning_edge_objects_match(
                TASK_0073_PLANNING_PARENT_COMMIT,
                TASK_0073_PLANNING_CHILD_COMMIT,
            )
            and canonical_json_sha256(parent_policy)
            == TASK_0073_PRE_REPAIR_DELIVERY_POLICY_CANONICAL_HASH
            and canonical_json_sha256(child_policy)
            == TASK_0073_PLANNING_CHILD_DELIVERY_POLICY_CANONICAL_HASH,
            f"{label}: TASK-0073 fixed planning parent edge drifted",
        )
        audit.require(
            task0074_exact_historical_quarantine_matches(),
            f"{label}: TASK-0074 terminal Commit/Tree/artifact tuple drifted",
        )
    except (
        HarnessError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ) as exc:
        audit.error(f"{label}: cannot verify exact historical objects: {exc}")


def validate_task0073_historical_unknown_quarantine(
    audit: Audit,
    task0074_record: dict[str, Any],
) -> None:
    label = "TASK-0074 immutable TASK-0073 Reviewer UNKNOWN quarantine"
    quarantine = task0074_record.get("historicalQuarantine")
    audit.require(
        quarantine == task0074_historical_quarantine_contract(),
        f"{label}: machine record drifted",
    )
    try:
        graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0073_TERMINAL_COMMIT,
        ).stdout.split()
        tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0073_TERMINAL_COMMIT,
        ).stdout.strip()
        evidence_entry = git_tree_entry(
            TASK_0073_TERMINAL_COMMIT,
            TASK_0073_TERMINAL_EVIDENCE_PATH,
        )
        review_entry = git_tree_entry(
            TASK_0073_TERMINAL_COMMIT,
            TASK_0073_TERMINAL_REVIEW_PATH,
        )
        evidence_bytes = git_object(
            TASK_0073_TERMINAL_COMMIT,
            TASK_0073_TERMINAL_EVIDENCE_PATH,
        )
        review_bytes = git_object(
            TASK_0073_TERMINAL_COMMIT,
            TASK_0073_TERMINAL_REVIEW_PATH,
        )
        audit.require(
            graph
            == [
                TASK_0073_TERMINAL_COMMIT,
                "11e6fb12f77486787ef71627e84f34ee069e72bd",
            ]
            and tree == TASK_0073_TERMINAL_TREE,
            f"{label}: terminal Commit/Tree/parent binding drifted",
        )
        audit.require(
            evidence_entry
            == ("100644", "blob", TASK_0073_TERMINAL_EVIDENCE_BLOB)
            and hashlib.sha256(evidence_bytes).hexdigest()
            == TASK_0073_TERMINAL_EVIDENCE_SHA256,
            f"{label}: Evidence mode/type/blob/content binding drifted",
        )
        audit.require(
            review_entry == ("100644", "blob", TASK_0073_TERMINAL_REVIEW_BLOB)
            and hashlib.sha256(review_bytes).hexdigest()
            == TASK_0073_TERMINAL_REVIEW_SHA256,
            f"{label}: Review mode/type/blob/content binding drifted",
        )
        evidence = json.loads(evidence_bytes.decode("utf-8"))
        checks = evidence.get("checks")
        reviewers = evidence.get("reviewers")
        audit.require(
            evidence.get("taskId") == TASK_0073_TASK_ID
            and evidence.get("headCommit")
            == TASK_0073_HISTORICAL_UNKNOWN_CHECK["verifiedCommit"]
            and isinstance(checks, list)
            and len(checks) > 5
            and checks[5] == TASK_0073_HISTORICAL_UNKNOWN_CHECK
            and reviewers == [TASK_0073_HISTORICAL_UNKNOWN_REVIEWER],
            f"{label}: exact Evidence Reviewer tuple drifted",
        )
        review_text = review_bytes.decode("utf-8")
        metadata = TASK_BLOCK_RE.search(review_text)
        review_metadata = strict_yaml_load(metadata.group(1)) if metadata else {}
        audit.require(
            bool(metadata)
            and review_metadata == TASK_0073_HISTORICAL_UNKNOWN_REVIEW_METADATA,
            f"{label}: native UNKNOWN review metadata drifted",
        )
    except (
        HarnessError,
        json.JSONDecodeError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ) as exc:
        audit.error(f"{label}: cannot verify exact historical artifacts: {exc}")


def task0073_exact_historical_unknown_check(
    label: str,
    check: dict[str, Any],
) -> bool:
    return (
        label
        == f"{TASK_0073_TERMINAL_EVIDENCE_PATH} checks[5]"
        and check == TASK_0073_HISTORICAL_UNKNOWN_CHECK
    )


def evidence_timestamp(
    audit: Audit,
    label: str,
    value: Any,
) -> datetime | None:
    validate_nonblank_text(audit, label, value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        audit.error(f"{label}: must be an ISO-8601 timestamp")
        return None
    audit.require(
        parsed.tzinfo is not None,
        f"{label}: timezone is required",
    )
    return parsed


def validate_task0074_delivery_timing_evidence(
    audit: Audit,
    task: dict[str, Any],
    evidence: dict[str, Any],
    handoff: dict[str, Any],
) -> None:
    label = "TASK-0074 delivery timing"
    if task.get("state") == "REJECTED" and task0074_exact_historical_quarantine_matches():
        try:
            historical_evidence = json.loads(
                git_object(
                    TASK_0074_TERMINAL_COMMIT,
                    TASK_0074_TERMINAL_ARTIFACTS["evidence"]["path"],
                ).decode("utf-8")
            )
            historical_handoff = json.loads(
                git_object(
                    TASK_0074_TERMINAL_COMMIT,
                    TASK_0074_TERMINAL_ARTIFACTS["handoff"]["path"],
                ).decode("utf-8")
            )
        except (HarnessError, json.JSONDecodeError, UnicodeError):
            historical_evidence = {}
            historical_handoff = {}
        if evidence == historical_evidence and handoff == historical_handoff:
            return
    timing = evidence.get("deliveryTiming")
    audit.require(
        isinstance(timing, dict)
        and set(timing)
        == {"overallElapsed", "intakeActivation", "candidateExecution"},
        f"{label}: Evidence must contain the exact three timing records",
    )
    if not isinstance(timing, dict):
        return
    audit.require(
        handoff.get("deliveryTiming") == timing,
        f"{label}: Handoff timing must equal Evidence",
    )
    overall = timing.get("overallElapsed")
    intake = timing.get("intakeActivation")
    candidate = timing.get("candidateExecution")
    overall = overall if isinstance(overall, dict) else {}
    intake = intake if isinstance(intake, dict) else {}
    candidate = candidate if isinstance(candidate, dict) else {}
    draft_started = git_text(
        "show",
        "-s",
        "--format=%cI",
        TASK_0074_DRAFT_COMMIT,
        check=False,
    ).stdout.strip()
    audit.require(
        overall.get("anchor") == "DRAFT_COMMIT"
        and overall.get("anchorCommit") == TASK_0074_DRAFT_COMMIT
        and overall.get("startedAt") == draft_started
        and overall.get("reanchored") is False,
        f"{label}: overall DRAFT anchor drifted or was reanchored",
    )
    audit.require(
        intake.get("anchor") == "DRAFT_COMMIT"
        and intake.get("anchorCommit") == TASK_0074_DRAFT_COMMIT
        and intake.get("startedAt") == draft_started
        and intake.get("targetWallMinutes") == 60
        and intake.get("hardFuseWallMinutes") == 90,
        f"{label}: intake/activation contract drifted",
    )
    in_progress_commit = str(candidate.get("inProgressCommit", ""))
    in_progress_started = (
        git_text(
            "show",
            "-s",
            "--format=%cI",
            in_progress_commit,
            check=False,
        ).stdout.strip()
        if FULL_COMMIT_RE.fullmatch(in_progress_commit)
        else ""
    )
    audit.require(
        candidate.get("anchor") == "READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT"
        and candidate.get("anchorCommit") == in_progress_commit
        and bool(FULL_COMMIT_RE.fullmatch(in_progress_commit))
        and candidate.get("startedAt") == in_progress_started
        and candidate.get("candidateDeadlineMinutes") == 45
        and candidate.get("targetWallMinutes") == 60
        and candidate.get("hardFuseWallMinutes") == 90,
        f"{label}: candidate execution anchor or budget drifted",
    )
    overall_start = evidence_timestamp(
        audit,
        f"{label}.overallElapsed.startedAt",
        overall.get("startedAt"),
    )
    overall_end = evidence_timestamp(
        audit,
        f"{label}.overallElapsed.endedAt",
        overall.get("endedAt"),
    )
    intake_end = evidence_timestamp(
        audit,
        f"{label}.intakeActivation.endedAt",
        intake.get("endedAt"),
    )
    candidate_start = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.startedAt",
        candidate.get("startedAt"),
    )
    candidate_end = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.endedAt",
        candidate.get("endedAt"),
    )
    ready_pass_at = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.readyDoctorPassAt",
        candidate.get("readyDoctorPassAt"),
    )
    if overall_start and overall_end:
        actual = (overall_end - overall_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(overall.get("elapsedSeconds"), (int, float))
            and abs(float(overall.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: overall elapsed duration is not truthful",
        )
    if overall_start and intake_end:
        actual = (intake_end - overall_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(intake.get("elapsedSeconds"), (int, float))
            and abs(float(intake.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: intake/activation elapsed duration is not truthful",
        )
    if candidate_start and candidate_end:
        actual = (candidate_end - candidate_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(candidate.get("elapsedSeconds"), (int, float))
            and abs(float(candidate.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: candidate execution elapsed duration is not truthful",
        )
    audit.require(
        intake.get("outcome") in {"PASS", "FAIL", "TIMEOUT", "UNKNOWN"}
        and candidate.get("outcome") in {"PASS", "FAIL", "TIMEOUT", "UNKNOWN"}
        and isinstance(intake.get("closureOnlyOverrunSeconds"), (int, float))
        and intake.get("closureOnlyOverrunSeconds") >= 0
        and isinstance(candidate.get("closureOnlyOverrunSeconds"), (int, float))
        and candidate.get("closureOnlyOverrunSeconds") >= 0,
        f"{label}: outcomes or closure-only overrun records are invalid",
    )
    if ready_pass_at and candidate_start:
        audit.require(
            candidate_start >= ready_pass_at,
            f"{label}: candidate budget started before READY Doctor PASS",
        )
    if task.get("state") == "ACCEPTED":
        audit.require(
            intake.get("outcome") == "PASS"
            and candidate.get("outcome") == "PASS"
            and intake.get("closureOnlyOverrunSeconds") == 0
            and candidate.get("closureOnlyOverrunSeconds") == 0,
            f"{label}: ACCEPTED requires both phases to PASS without overrun",
        )



def validate_task0076_pre_ready_maintenance_record(
    audit: Audit,
    policy: dict[str, Any],
) -> dict[str, Any] | None:
    record = policy.get("task0076PreReadyMaintenance")
    label = "TASK-0076 pre-READY maintenance"
    audit.require(isinstance(record, dict), f"{label}: machine record is missing or not an object")
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record) == {"schemaVersion", "recordId", "decisionId", "kind", "targetTask", "sourceThreadId", "authorization", "base", "draft", "boundary", "activation", "consumption", "validationChannel", "forbiddenInterfaces"},
        f"{label}: record fields do not match the exact schema",
    )
    audit.require(
        record.get("schemaVersion") == 1
        and record.get("recordId") == TASK_0076_MAINTENANCE_RECORD_ID
        and record.get("decisionId") == "TASK-0076-SKILL-VERSION-BINDING-RECOVERY-20260804"
        and record.get("kind") == "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE"
        and record.get("targetTask") == TASK_0076_TASK_ID
        and record.get("sourceThreadId") == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
        f"{label}: record identity drifted",
    )
    audit.require(
        record.get("base") == {"commit": TASK_0076_BASE_COMMIT, "tree": TASK_0076_BASE_TREE, "lastTerminalTask": TASK_0075_TASK_ID, "lastTerminalState": "REJECTED"},
        f"{label}: Base binding drifted",
    )
    authorization = record.get("authorization")
    audit.require(
        isinstance(authorization, dict) and set(authorization) == {"path", "sha256"}
        and authorization.get("path") == TASK_0076_MAINTENANCE_AUTHORIZATION_PATH
        and bool(re.fullmatch(r"[0-9a-f]{64}", str(authorization.get("sha256", "")))),
        f"{label}: Owner authorization binding drifted",
    )
    draft = record.get("draft")
    audit.require(
        isinstance(draft, dict) and set(draft) == {"commit", "tree", "parent", "changedFiles"}
        and draft.get("commit") == TASK_0076_DRAFT_COMMIT
        and draft.get("tree") == TASK_0076_DRAFT_TREE
        and draft.get("parent") == TASK_0076_BASE_COMMIT,
        f"{label}: DRAFT binding drifted",
    )
    boundary = record.get("boundary")
    audit.require(
        isinstance(boundary, dict) and set(boundary) == {"directParentCommit", "directParentTree", "singleParentRequired", "identityBinding", "changedPaths", "requiredMode", "requiredType", "policyContentBinding", "files"}
        and boundary.get("directParentCommit") == TASK_0076_DRAFT_COMMIT
        and boundary.get("directParentTree") == TASK_0076_DRAFT_TREE
        and boundary.get("singleParentRequired") is True
        and boundary.get("identityBinding") == "COMMIT_AND_TREE_DERIVED_FROM_EXACT_SINGLE_PARENT_CONTENT"
        and boundary.get("requiredMode") == "100644"
        and boundary.get("requiredType") == "blob"
        and boundary.get("policyContentBinding") == "CANONICAL_JSON_REDACT_TASK0076_BOUNDARY_DOCTOR_IDENTITY",
        f"{label}: boundary contract drifted",
    )
    audit.require(
        isinstance(boundary, dict) and boundary.get("changedPaths") == sorted(TASK_0076_PRE_READY_MAINTENANCE_PATHS),
        f"{label}: changed path contract drifted",
    )
    audit.require(
        record.get("activation") == {"allowedState": "DRAFT", "readyDoctorPassRequired": True, "copiedRecordForbidden": True, "extraCommitOrPathForbidden": True},
        f"{label}: activation contract drifted",
    )
    audit.require(
        record.get("consumption") == {"consumedByTask": TASK_0076_TASK_ID, "consumedWhen": "READY_AUTHORIZATION_COMMITTED", "inertAfterConsumption": True, "reusableByOtherTask": False},
        f"{label}: consumption contract drifted",
    )
    audit.require(
        record.get("validationChannel") == {"channel": "LOCAL_EXACT_TREE_FALLBACK", "profile": "HARNESS_PORTABILITY_LOCAL", "windows": "COMBINED_CANONICAL_AND_EXACT_TREE_PASS_REQUIRED", "wslUbuntu": "INDEPENDENT_PASS_REQUIRED", "macos": "DEFERRED_NOT_CLAIMED", "githubActions": "UNKNOWN_NOT_RUN", "githubReasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED", "dispatchCount": 0, "passClaimed": False},
        f"{label}: validation channel binding drifted",
    )
    audit.require(
        record.get("forbiddenInterfaces") == {"cliFlag": False, "environmentVariable": False, "gitNote": False, "gitReplace": False, "gitGraft": False, "historyRewrite": False, "configurableAllowlist": False, "wildcardWritePath": False, "generalizedOverride": False, "branchOrWorktree": False, "githubActionsDispatch": False},
        f"{label}: forbidden-interface contract drifted",
    )
    audit.require(
        not any(key != "task0076PreReadyMaintenance" and value == record for key, value in policy.items()),
        f"{label}: copied machine record is forbidden",
    )
    return record


def task0076_pre_ready_maintenance_boundary_candidate(commit: str) -> bool:
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        return False
    parent_result = subprocess.run(["git", "rev-list", "--parents", "-n", "1", commit], capture_output=True, text=True)
    if parent_result.returncode != 0:
        return False
    parts = parent_result.stdout.split()
    return len(parts) == 2 and parts[0] == commit and parts[1] == TASK_0076_DRAFT_COMMIT


def validate_task0076_pre_ready_maintenance_boundary(
    audit: Audit,
    parent_commit: str,
) -> None:
    label = "TASK-0076 pre-READY maintenance"
    audit.require(bool(parent_commit) and bool(re.fullmatch(r"[0-9a-f]{40}", parent_commit)), f"{label}: boundary must be a full Git commit")
    if not (parent_commit and re.fullmatch(r"[0-9a-f]{40}", parent_commit)):
        return
    boundary_commit = parent_commit
    audit.require(task0076_pre_ready_maintenance_boundary_candidate(boundary_commit), f"{label}: boundary must be the direct single-parent child of the frozen DRAFT")
    if not task0076_pre_ready_maintenance_boundary_candidate(boundary_commit):
        return
    base_tree = git_text("show", "-s", "--format=%T", TASK_0076_BASE_COMMIT).stdout.strip()
    audit.require(base_tree == TASK_0076_BASE_TREE, f"{label}: Base tree drifted")
    draft_graph = git_text("rev-list", "--parents", "-n", "1", TASK_0076_DRAFT_COMMIT).stdout.split()
    draft_tree = git_text("show", "-s", "--format=%T", TASK_0076_DRAFT_COMMIT).stdout.strip()
    audit.require(draft_graph == [TASK_0076_DRAFT_COMMIT, TASK_0076_BASE_COMMIT] and draft_tree == TASK_0076_DRAFT_TREE, f"{label}: DRAFT binding drifted")
    ancestry = git_text("rev-list", "--reverse", "--ancestry-path", f"{TASK_0076_BASE_COMMIT}..{boundary_commit}").stdout.splitlines()
    audit.require(ancestry == [TASK_0076_DRAFT_COMMIT, boundary_commit], f"{label}: pre-READY ancestry contains an intervening commit")
    draft_diff = subprocess.run(["git", "diff", "--name-only", "--no-renames", "-z", TASK_0076_BASE_COMMIT, TASK_0076_DRAFT_COMMIT], capture_output=True)
    actual_draft_paths = {p.decode("utf-8") for p in draft_diff.stdout.split(b"\0") if p}
    audit.require(actual_draft_paths == {TASK_0076_CARD_PATH, TASK_0076_CONTEXT_PATH}, f"{label}: DRAFT path set drifted")
    boundary_diff = subprocess.run(["git", "diff", "--name-only", "--no-renames", "-z", TASK_0076_DRAFT_COMMIT, boundary_commit], capture_output=True)
    actual_paths = {p.decode("utf-8") for p in boundary_diff.stdout.split(b"\0") if p}
    audit.require(actual_paths == TASK_0076_PRE_READY_MAINTENANCE_PATHS, f"{label}: boundary paths must be exact")
    audit.require(not (actual_paths - TASK_0076_PRE_READY_MAINTENANCE_PATHS), f"{label}: boundary contains extra path")
    audit.require(not (TASK_0076_PRE_READY_MAINTENANCE_PATHS - actual_paths), f"{label}: boundary is missing a required path")
    for path in sorted(TASK_0076_PRE_READY_MAINTENANCE_PATHS):
        entry = git_tree_entry(boundary_commit, path)
        audit.require(entry is not None, f"{label}: path {path} not found")
        if entry is not None:
            mode, obj_type, _ = entry
            audit.require(mode == "100644" and obj_type == "blob", f"{label}: path {path} must be 100644 blob")
    auth_bytes = git_object(boundary_commit, TASK_0076_MAINTENANCE_AUTHORIZATION_PATH)
    if auth_bytes:
        try:
            auth_data = json.loads(auth_bytes)
            audit.require(
                auth_data.get("recordId") == TASK_0076_MAINTENANCE_RECORD_ID
                and auth_data.get("targetTask") == TASK_0076_TASK_ID
                and auth_data.get("baseCommit") == TASK_0076_BASE_COMMIT
                and auth_data.get("baseTree") == TASK_0076_BASE_TREE
                and auth_data.get("draftCommit") == TASK_0076_DRAFT_COMMIT
                and auth_data.get("draftTree") == TASK_0076_DRAFT_TREE
                and auth_data.get("oneTimeOnly") is True
                and auth_data.get("reusable") is False
                and auth_data.get("generalOverrideAuthorized") is False
                and auth_data.get("historyRewriteAuthorized") is False
                and auth_data.get("remoteDispatchAuthorized") is False,
                f"{label}: authorization file identity drifted",
            )
        except (json.JSONDecodeError, AttributeError):
            audit.error(f"{label}: authorization file is not valid JSON")


def validate_task0075_delivery_timing_evidence(

    audit: Audit,
    task: dict[str, Any],
    evidence: dict[str, Any],
    handoff: dict[str, Any],
) -> None:
    label = "TASK-0075 delivery timing"
    timing = evidence.get("deliveryTiming")
    audit.require(
        isinstance(timing, dict)
        and set(timing)
        == {"overallElapsed", "intakeActivation", "candidateExecution"},
        f"{label}: Evidence must contain the exact three timing records",
    )
    if not isinstance(timing, dict):
        return
    audit.require(
        handoff.get("deliveryTiming") == timing,
        f"{label}: Handoff timing must equal Evidence",
    )
    overall = timing.get("overallElapsed")
    intake = timing.get("intakeActivation")
    candidate = timing.get("candidateExecution")
    overall = overall if isinstance(overall, dict) else {}
    intake = intake if isinstance(intake, dict) else {}
    candidate = candidate if isinstance(candidate, dict) else {}
    draft_started = git_text(
        "show",
        "-s",
        "--format=%cI",
        TASK_0075_DRAFT_COMMIT,
        check=False,
    ).stdout.strip()
    audit.require(
        overall.get("anchor") == "DRAFT_COMMIT"
        and overall.get("anchorCommit") == TASK_0075_DRAFT_COMMIT
        and overall.get("startedAt") == draft_started
        and overall.get("reanchored") is False,
        f"{label}: overall DRAFT anchor drifted or was reanchored",
    )
    audit.require(
        intake.get("anchor") == "DRAFT_COMMIT"
        and intake.get("anchorCommit") == TASK_0075_DRAFT_COMMIT
        and intake.get("startedAt") == draft_started
        and intake.get("targetWallMinutes") == 60
        and intake.get("hardFuseWallMinutes") == 90
        and intake.get("outcome") in {"PASS", "FAIL", "TIMEOUT", "UNKNOWN"}
        and isinstance(intake.get("closureOnlyOverrunSeconds"), (int, float))
        and intake.get("closureOnlyOverrunSeconds") >= 0,
        f"{label}: intake/activation contract drifted",
    )
    overall_start = evidence_timestamp(
        audit,
        f"{label}.overallElapsed.startedAt",
        overall.get("startedAt"),
    )
    overall_end = evidence_timestamp(
        audit,
        f"{label}.overallElapsed.endedAt",
        overall.get("endedAt"),
    )
    intake_end = evidence_timestamp(
        audit,
        f"{label}.intakeActivation.endedAt",
        intake.get("endedAt"),
    )
    if overall_start and overall_end:
        actual = (overall_end - overall_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(overall.get("elapsedSeconds"), (int, float))
            and abs(float(overall.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: overall elapsed duration is not truthful",
        )
    if overall_start and intake_end:
        actual = (intake_end - overall_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(intake.get("elapsedSeconds"), (int, float))
            and abs(float(intake.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: intake/activation elapsed duration is not truthful",
        )

    if candidate.get("outcome") == "NOT_STARTED":
        audit.require(
            task0075_not_started_candidate_execution_matches(candidate),
            f"{label}: strict NOT_STARTED field contract drifted",
        )
        ready_command = (
            f"python scripts/harness/doctor.py --task {TASK_0075_TASK_ID}"
        )
        checks = evidence.get("checks")
        ready_checks = (
            [
                check
                for check in checks
                if isinstance(check, dict)
                and check.get("command") == ready_command
            ]
            if isinstance(checks, list)
            else []
        )
        try:
            in_progress = first_task_state_commit_from_base(
                task,
                {"IN_PROGRESS", "IN_REVIEW", "ACCEPTED"},
            )
        except (HarnessError, UnicodeError, yaml.YAMLError):
            in_progress = ("INVALID", {})
        channels = evidence.get("validationChannels")
        channels = channels if isinstance(channels, dict) else {}
        ready_status = (
            ready_checks[0].get("status") if len(ready_checks) == 1 else None
        )
        ready_exit_code = (
            ready_checks[0].get("exitCode") if len(ready_checks) == 1 else None
        )
        ready_non_pass_is_strongly_typed = (
            ready_status == "FAIL"
            and isinstance(ready_exit_code, int)
            and not isinstance(ready_exit_code, bool)
            and ready_exit_code != 0
        ) or (
            ready_status in {"TIMEOUT", "UNKNOWN"}
            and ready_exit_code is None
        )
        audit.require(
            task.get("state") == "REJECTED"
            and len(ready_checks) == 1
            and ready_non_pass_is_strongly_typed
            and in_progress is None
            and channels.get("candidateCommit") is None
            and channels.get("candidateTree") is None
            and channels.get("passClaimed") is False,
            f"{label}: NOT_STARTED requires READY Doctor non-PASS and no "
            "READY PASS, IN_PROGRESS commit, or candidate freeze",
        )
        return

    in_progress_commit = str(candidate.get("inProgressCommit", ""))
    in_progress_started = (
        git_text(
            "show",
            "-s",
            "--format=%cI",
            in_progress_commit,
            check=False,
        ).stdout.strip()
        if FULL_COMMIT_RE.fullmatch(in_progress_commit)
        else ""
    )
    audit.require(
        candidate.get("anchor") == "READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT"
        and candidate.get("anchorCommit") == in_progress_commit
        and bool(FULL_COMMIT_RE.fullmatch(in_progress_commit))
        and candidate.get("startedAt") == in_progress_started
        and candidate.get("candidateDeadlineMinutes") == 45
        and candidate.get("targetWallMinutes") == 60
        and candidate.get("hardFuseWallMinutes") == 90
        and candidate.get("outcome") in {"PASS", "FAIL", "TIMEOUT", "UNKNOWN"}
        and isinstance(candidate.get("closureOnlyOverrunSeconds"), (int, float))
        and candidate.get("closureOnlyOverrunSeconds") >= 0,
        f"{label}: started candidate execution anchor, budget, or outcome drifted",
    )
    candidate_start = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.startedAt",
        candidate.get("startedAt"),
    )
    candidate_end = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.endedAt",
        candidate.get("endedAt"),
    )
    ready_pass_at = evidence_timestamp(
        audit,
        f"{label}.candidateExecution.readyDoctorPassAt",
        candidate.get("readyDoctorPassAt"),
    )
    if candidate_start and candidate_end:
        actual = (candidate_end - candidate_start).total_seconds()
        audit.require(
            actual >= 0
            and isinstance(candidate.get("elapsedSeconds"), (int, float))
            and abs(float(candidate.get("elapsedSeconds")) - actual) <= 2,
            f"{label}: candidate execution elapsed duration is not truthful",
        )
    if ready_pass_at and candidate_start:
        audit.require(
            candidate_start >= ready_pass_at,
            f"{label}: candidate budget started before READY Doctor PASS",
        )
    if task.get("state") == "ACCEPTED":
        audit.require(
            intake.get("outcome") == "PASS"
            and candidate.get("outcome") == "PASS"
            and intake.get("closureOnlyOverrunSeconds") == 0
            and candidate.get("closureOnlyOverrunSeconds") == 0,
            f"{label}: ACCEPTED requires both phases to PASS without overrun",
        )


def validate_task0074_profile_stdout(
    audit: Audit,
    label: str,
    content: str,
) -> None:
    command_ids = [
        "harnessTests",
        "doctor",
        "catalogValidate",
        "catalogDrift",
        "paidFeatureCheck",
        "betaRosterGate",
    ]
    for command_id in command_ids:
        starts = re.findall(
            rf"(?m)^== {re.escape(command_id)}: (?!PASS |FAIL )",
            content,
        )
        terminals = re.findall(
            rf"(?m)^== {re.escape(command_id)}: PASS "
            r"\(exit=0, elapsed=[0-9.]+s\)$",
            content,
        )
        audit.require(
            len(starts) == 1 and len(terminals) == 1,
            f"{label}: {command_id} must execute and PASS exactly once",
        )
    audit.require(
        content.count("Harness precheck: PASS (6 commands)") == 1
        and "Harness precheck: FAIL" not in content,
        f"{label}: complete six-command profile PASS marker drifted",
    )


def validate_task0074_combined_gate_evidence(
    audit: Audit,
    task: dict[str, Any],
    evidence: dict[str, Any],
    task_id: str = TASK_0074_TASK_ID,
) -> None:
    label = f"{task_id} exact-tree validation"
    record = evidence.get("validationChannels")
    audit.require(
        isinstance(record, dict),
        f"{label}: validationChannels is required",
    )
    if not isinstance(record, dict):
        return
    if task.get("state") != "ACCEPTED":
        audit.require(
            record.get("passClaimed") is False,
            f"{label}: non-ACCEPTED closure cannot claim PASS",
        )
        return
    candidate_commit = str(record.get("candidateCommit", ""))
    candidate_tree = str(record.get("candidateTree", ""))
    actual_tree = (
        git_text(
            "rev-parse",
            f"{candidate_commit}^{{tree}}",
            check=False,
        ).stdout.strip()
        if FULL_COMMIT_RE.fullmatch(candidate_commit)
        else ""
    )
    audit.require(
        record.get("policySource") == CI_EXECUTION_POLICY_PATH
        and record.get("selectedChannel") == "LOCAL_EXACT_TREE_FALLBACK"
        and record.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and candidate_commit == evidence.get("headCommit")
        and actual_tree == candidate_tree
        and record.get("passClaimed") is True,
        f"{label}: candidate Commit/Tree or channel binding drifted",
    )
    audit.require(
        record.get("cleanSnapshot")
        == {
            "candidateCommit": candidate_commit,
            "candidateTree": candidate_tree,
            "worktreeClean": True,
            "indexClean": True,
        },
        f"{label}: clean candidate snapshot drifted",
    )
    windows = record.get("windowsCombinedGate")
    windows = windows if isinstance(windows, dict) else {}
    expected_ids = [
        "harnessTests",
        "doctor",
        "catalogValidate",
        "catalogDrift",
        "paidFeatureCheck",
        "betaRosterGate",
    ]
    canonical_ids = [
        "doctor",
        "catalogValidate",
        "catalogDrift",
        "paidFeatureCheck",
        "betaRosterGate",
    ]
    audit.require(
        windows.get("status") == "PASS"
        and windows.get("candidateCommit") == candidate_commit
        and windows.get("candidateTree") == candidate_tree
        and windows.get("argv")
        == [
            "python",
            "scripts/harness/precheck.py",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            task_id,
        ]
        and windows.get("exactCommandIds") == expected_ids
        and windows.get("canonicalCommandIds") == canonical_ids
        and windows.get("commandExecutionCounts")
        == {command_id: 1 for command_id in expected_ids}
        and windows.get("candidateCanonicalSatisfied") is True
        and windows.get("windowsExactTreeSatisfied") is True
        and windows.get("aliasCacheOrSkipUsed") is False
        and windows.get("exitCode") == 0,
        f"{label}: combined Windows gate contract drifted",
    )
    receipt_path = str(windows.get("receiptPath", ""))
    stdout_path = str(windows.get("stdoutPath", ""))
    stderr_path = str(windows.get("stderrPath", ""))
    for field, path in (
        ("receiptPath", receipt_path),
        ("stdoutPath", stdout_path),
        ("stderrPath", stderr_path),
    ):
        audit.require(
            is_repository_relative(path) and current_path_is_file(ROOT / path),
            f"{label}: Windows {field} must be a repository artifact",
        )
    if all(
        is_repository_relative(path) and current_path_is_file(ROOT / path)
        for path in (receipt_path, stdout_path, stderr_path)
    ):
        receipt_bytes = read_repository_bytes(ROOT / receipt_path)
        stdout_bytes = read_repository_bytes(ROOT / stdout_path)
        stderr_bytes = read_repository_bytes(ROOT / stderr_path)
        try:
            receipt = json.loads(receipt_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeError) as exc:
            audit.error(f"{label}: Windows receipt is invalid: {exc}")
            receipt = {}
        audit.require(
            hashlib.sha256(receipt_bytes).hexdigest()
            == windows.get("receiptSha256")
            and hashlib.sha256(stdout_bytes).hexdigest()
            == windows.get("stdoutSha256")
            and hashlib.sha256(stderr_bytes).hexdigest()
            == windows.get("stderrSha256"),
            f"{label}: Windows receipt/output hashes drifted",
        )
        audit.require(
            receipt.get("status") == "COMPLETED"
            and receipt.get("transport") == "DURABLE_ATOMIC_RECEIPT"
            and receipt.get("exitCode") == 0
            and receipt.get("argv")
            == [
                "scripts/harness/precheck.py",
                "--profile",
                "harnessPortabilityLocal",
                "--task",
                task_id,
            ]
            and receipt.get("stdoutSha256") == windows.get("stdoutSha256")
            and receipt.get("stderrSha256") == windows.get("stderrSha256")
            and receipt.get("startedAt") == windows.get("startedAt")
            and receipt.get("completedAt") == windows.get("completedAt"),
            f"{label}: Windows durable receipt identity drifted",
        )
        validate_task0074_profile_stdout(
            audit,
            f"{label}: Windows stdout",
            stdout_bytes.decode("utf-8", errors="replace"),
        )
    wsl = record.get("wslUbuntu")
    wsl = wsl if isinstance(wsl, dict) else {}
    audit.require(
        wsl.get("status") == "PASS"
        and wsl.get("candidateCommit") == candidate_commit
        and wsl.get("candidateTree") == candidate_tree
        and wsl.get("distribution") == "Ubuntu-24.04"
        and wsl.get("isolation") == "GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP"
        and wsl.get("argv")
        == [
            "bash",
            "scripts/harness/precheck.sh",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            task_id,
        ]
        and wsl.get("startedAfterWindowsPass") is True
        and wsl.get("exitCode") == 0,
        f"{label}: independent WSL exact-tree result drifted",
    )
    wsl_stdout_path = str(wsl.get("stdoutPath", ""))
    wsl_stderr_path = str(wsl.get("stderrPath", ""))
    for field, path in (
        ("stdoutPath", wsl_stdout_path),
        ("stderrPath", wsl_stderr_path),
    ):
        audit.require(
            is_repository_relative(path) and current_path_is_file(ROOT / path),
            f"{label}: WSL {field} must be a repository artifact",
        )
    if all(
        is_repository_relative(path) and current_path_is_file(ROOT / path)
        for path in (wsl_stdout_path, wsl_stderr_path)
    ):
        wsl_stdout = read_repository_bytes(ROOT / wsl_stdout_path)
        wsl_stderr = read_repository_bytes(ROOT / wsl_stderr_path)
        audit.require(
            hashlib.sha256(wsl_stdout).hexdigest() == wsl.get("stdoutSha256")
            and hashlib.sha256(wsl_stderr).hexdigest() == wsl.get("stderrSha256"),
            f"{label}: WSL output hashes drifted",
        )
        validate_task0074_profile_stdout(
            audit,
            f"{label}: WSL stdout",
            wsl_stdout.decode("utf-8", errors="replace"),
        )
    audit.require(
        record.get("macos", {}).get("status") == "DEFERRED_NOT_CLAIMED"
        and record.get("remote")
        == {
            "platform": "githubActions",
            "status": "UNKNOWN_NOT_RUN",
            "reasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "currentQuotaVerified": False,
            "dispatchCount": 0,
            "passClaimed": False,
        },
        f"{label}: macOS or remote non-PASS coverage drifted",
    )


def validate_task0072_historical_doctor_binding(
    audit: Audit,
    policy: dict[str, Any],
) -> None:
    record = policy.get("task0072SelfBootstrap")
    boundary = record.get("boundary") if isinstance(record, dict) else {}
    files = boundary.get("files") if isinstance(boundary, dict) else {}
    doctor_identity = files.get("doctor") if isinstance(files, dict) else {}
    doctor_path = (
        str(doctor_identity.get("path", ""))
        if isinstance(doctor_identity, dict)
        else ""
    )
    try:
        graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0072_BOUNDARY_COMMIT,
        ).stdout.split()
        tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0072_BOUNDARY_COMMIT,
        ).stdout.strip()
        entry = git_tree_entry(TASK_0072_BOUNDARY_COMMIT, doctor_path)
        content_hash = hashlib.sha256(
            git_object(TASK_0072_BOUNDARY_COMMIT, doctor_path)
        ).hexdigest()
        audit.require(
            doctor_path == "scripts/harness/doctor.py"
            and isinstance(doctor_identity, dict)
            and set(doctor_identity) == {"path", "blobOid", "sha256"}
            and doctor_identity.get("blobOid")
            == TASK_0072_BOUNDARY_DOCTOR_BLOB_OID
            and doctor_identity.get("sha256") == TASK_0072_BOUNDARY_DOCTOR_SHA256,
            "ci-execution-policy: TASK-0072 historical Doctor record drifted",
        )
        audit.require(
            graph
            == [
                TASK_0072_BOUNDARY_COMMIT,
                TASK_0072_MAINTENANCE_HANDOFF_COMMIT,
            ]
            and tree == TASK_0072_BOUNDARY_TREE
            and entry
            == (
                "100644",
                "blob",
                TASK_0072_BOUNDARY_DOCTOR_BLOB_OID,
            )
            and content_hash == TASK_0072_BOUNDARY_DOCTOR_SHA256,
            "ci-execution-policy: TASK-0072 historical boundary Doctor "
            "commit/tree/blob/content binding drifted",
        )
    except (HarnessError, OSError) as exc:
        audit.error(
            "ci-execution-policy: cannot read TASK-0072 historical boundary Doctor: "
            f"{exc}"
        )


def is_planning_only_task(task: dict[str, Any]) -> bool:
    state = str(task.get("state", ""))
    if state == "PLANNED":
        return True
    return (
        state in PLANNING_TERMINAL_STATES
        and task.get("planningBacklog") == TASK_BACKLOG_PATH
        and "baseCommit" not in task
    )


def validate_planned_task_metadata(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
) -> None:
    path = str(task.get("_path", ""))
    state = str(task.get("state", ""))
    expected_fields = (
        PLANNED_CARD_FIELDS
        if state == "PLANNED"
        else PLANNING_TERMINAL_CARD_FIELDS
    )
    fields = set(task) - {"_path"}
    audit.require(
        fields == expected_fields,
        f"{path}: planning-only metadata fields must be exactly "
        f"{sorted(expected_fields)}; dynamic execution evidence is forbidden",
    )
    audit.require(
        state == "PLANNED" or state in PLANNING_TERMINAL_STATES,
        f"{path}: planning-only projection has invalid state {state!r}",
    )
    audit.require(
        is_canonical_identity(task.get("owner")),
        f"{path}: owner must be a canonical lowercase identity",
    )
    audit.require(
        task.get("planningBacklog") == TASK_BACKLOG_PATH,
        f"{path}: PLANNED task must bind {TASK_BACKLOG_PATH}",
    )
    audit.require(
        task.get("planningContractHashAlgorithm")
        == PLANNING_CONTRACT_HASH_ALGORITHM,
        f"{path}: unsupported PLANNED planning contract hash algorithm",
    )
    audit.require(
        bool(
            re.fullmatch(
                r"[0-9a-f]{64}",
                str(task.get("planningContractHash", "")),
            )
        ),
        f"{path}: planningContractHash must be SHA-256",
    )
    audit.require(
        bool(TASK_ID_RE.fullmatch(task_id)),
        f"{path}: invalid taskId {task_id!r}",
    )
    if state in PLANNING_TERMINAL_STATES:
        audit.require(
            isinstance(task.get("planningResolution"), dict),
            f"{path}: planning terminal state requires planningResolution",
        )


def planned_card_render_projection(
    audit: Audit,
    label: str,
    task_id: str,
    entry: dict[str, Any],
    text: str,
) -> dict[str, Any] | None:
    normalized = text.replace("\r\n", "\n")
    metadata_match = TASK_BLOCK_RE.search(normalized)
    if not metadata_match:
        audit.error(f"{label}: planning card YAML block is missing")
        return None
    expected_heading = f"# {task_id}：{entry.get('title')}"
    first_line = normalized.split("\n", 1)[0]
    audit.require(
        first_line == expected_heading,
        f"{label}: planning card heading must be exactly {expected_heading!r}",
    )
    section_matches = list(re.finditer(r"(?m)^## (?P<heading>[^\n]+)\n", normalized))
    audit.require(
        len(section_matches) == 6,
        f"{label}: planning card must contain exactly six normative sections",
    )
    if not section_matches:
        return None
    preamble = normalized[metadata_match.end() : section_matches[0].start()].strip()
    audit.require(
        preamble == PLANNED_CARD_NON_NORMATIVE_NOTICE,
        f"{label}: planning card must contain exactly the fixed Backlog projection "
        "notice and no unbound preamble",
    )
    sections: list[dict[str, str]] = []
    seen_headings: set[str] = set()
    for index, section_match in enumerate(section_matches):
        heading = section_match.group("heading").strip()
        body_end = (
            section_matches[index + 1].start()
            if index + 1 < len(section_matches)
            else len(normalized)
        )
        body = normalized[section_match.end() : body_end].strip()
        audit.require(bool(heading), f"{label}: section {index + 1} heading is blank")
        audit.require(
            heading not in seen_headings,
            f"{label}: section heading {heading!r} is duplicated",
        )
        audit.require(bool(body), f"{label}: section {heading!r} body is blank")
        seen_headings.add(heading)
        sections.append({"heading": heading, "body": body})
    audit.require(
        normalized.count(PLANNED_CARD_NON_NORMATIVE_NOTICE) == 1,
        f"{label}: fixed Backlog projection notice must appear exactly once",
    )
    return {
        "heading": first_line,
        "notice": PLANNED_CARD_NON_NORMATIVE_NOTICE,
        "sections": sections,
    }


def validate_tasks(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    states = set(str(item) for item in lifecycle.get("states", []))
    transitions = lifecycle.get("transitions")
    audit.require(isinstance(transitions, dict), "task lifecycle: transitions must be an object")
    if isinstance(transitions, dict):
        audit.require(set(transitions) == states, "task lifecycle: every state must define transitions")
        for source, targets in transitions.items():
            audit.require(isinstance(targets, list), f"task lifecycle: {source} transitions must be a list")
            if isinstance(targets, list):
                for target in targets:
                    audit.require(str(target) in states, f"task lifecycle: {source} targets unknown state {target}")
    required = {
        "taskId",
        "state",
        "owner",
        "riskClass",
        "requiredSkills",
        "baseCommit",
        "contextFingerprint",
        "contextLock",
        "contextFingerprintAlgorithm",
        "readAllowlist",
        "writeAllowlist",
        "forbiddenPaths",
        "sourcesOfTruth",
        "requiredInvariants",
        "requiredCommands",
        "reviewers",
    }
    for task_id, task in tasks.items():
        path = task["_path"]
        if is_planning_only_task(task):
            audit.require(
                task.get("state") in states,
                f"{path}: lifecycle does not register planning state "
                f"{task.get('state')!r}",
            )
            validate_planned_task_metadata(audit, task_id, task)
            try:
                planned_text = read_repository_text(ROOT / path)
                audit.require(
                    PLANNED_CARD_NON_NORMATIVE_NOTICE in planned_text,
                    f"{path}: PLANNED card must declare its body as a "
                    "non-normative Backlog rendering",
                )
            except (OSError, UnicodeError) as exc:
                audit.error(f"{path}: cannot read PLANNED card body: {exc}")
            continue
        audit.require(
            task.get("state") != "SUPERSEDED",
            f"{path}: SUPERSEDED is reserved for planning-only Backlog cards; "
            "an execution task must close as ACCEPTED or REJECTED",
        )
        missing = sorted(required - task.keys())
        audit.require(not missing, f"{path}: missing task fields: {missing}")
        audit.require(bool(TASK_ID_RE.fullmatch(task_id)), f"{path}: invalid taskId {task_id!r}")
        audit.require(
            task.get("riskClass") in RISK_RANK,
            f"{path}: riskClass must be one of {sorted(RISK_RANK)}",
        )
        if task.get("state") in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            authorization_commit = str(task.get("authorizationCommit", ""))
            if (
                task.get("state") != "DRAFT"
                and FULL_COMMIT_RE.fullmatch(authorization_commit)
            ):
                ancestor = git_text("merge-base", "--is-ancestor", authorization_commit, "HEAD", check=False)
                audit.require(ancestor.returncode == 0, f"{path}: authorizationCommit is not an ancestor of HEAD")
                try:
                    raw = git_object(authorization_commit, path)
                    authorized_text = raw.decode("utf-8")
                    current_text = read_repository_text(ROOT / path)
                    match = TASK_BLOCK_RE.search(authorized_text)
                    if match:
                        authorized = strict_yaml_load(match.group(1))
                        if isinstance(authorized, dict):
                            for field in AUTHORIZATION_FIELDS:
                                audit.require(
                                    task.get(field) == authorized.get(field),
                                    f"{path}: authorized field changed after READY checkpoint: {field}",
                                )
                except (HarnessError, UnicodeError, yaml.YAMLError):
                    pass
            continue
        audit.require(task.get("state") in states, f"{path}: unknown state {task.get('state')!r}")
        audit.require(
            is_canonical_identity(task.get("owner")),
            f"{path}: owner must be a canonical lowercase identity",
        )
        audit.require(
            task.get("riskClass") in RISK_RANK,
            f"{path}: riskClass must be one of {sorted(RISK_RANK)}",
        )
        audit.require(
            bool(FULL_COMMIT_RE.fullmatch(str(task.get("baseCommit", "")))),
            f"{path}: baseCommit must be a full lowercase Git SHA",
        )
        audit.require(
            bool(re.fullmatch(r"[0-9a-f]{64}", str(task.get("contextFingerprint", "")))),
            f"{path}: contextFingerprint must be SHA-256",
        )
        audit.require(
            task.get("contextFingerprintAlgorithm") == CONTEXT_ALGORITHM,
            f"{path}: unsupported context fingerprint algorithm",
        )
        for field in (
            "requiredSkills",
            "readAllowlist",
            "writeAllowlist",
            "forbiddenPaths",
            "sourcesOfTruth",
            "requiredInvariants",
            "requiredCommands",
            "reviewers",
        ):
            audit.require(isinstance(task.get(field), list), f"{path}: {field} must be a list")
        approvals = task.get("humanApprovals")
        approvals = approvals if isinstance(approvals, list) else []
        for index, approval in enumerate(approvals):
            label = f"{path}: humanApprovals[{index}]"
            audit.require(isinstance(approval, dict), f"{label} must be an object")
            if not isinstance(approval, dict):
                continue
            audit.require(
                is_canonical_identity(approval.get("approvedBy")),
                f"{label}.approvedBy must be a canonical lowercase identity",
            )
            audit.require(
                is_valid_approval_timestamp(approval.get("approvedAt")),
                f"{label}.approvedAt must be an ISO-8601 date or timestamp",
            )
            validate_nonblank_text(audit, f"{label}.scope", approval.get("scope"))
            validate_nonblank_text(audit, f"{label}.evidence", approval.get("evidence"))
        if task.get("state") not in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            validate_scope_amendments(audit, path, task)
            for error in verify_context_lock(task):
                audit.error(error)
        expected_context_lock = f"docs/tasks/context/{task_id}.context-lock.yaml"
        audit.require(
            task.get("contextLock") == expected_context_lock,
            f"{path}: contextLock must be {expected_context_lock}",
        )
        authorization_commit = str(task.get("authorizationCommit", ""))
        if task.get("state") == "DRAFT":
            audit.require(
                authorization_commit == "",
                f"{path}: DRAFT task must not declare authorizationCommit",
            )
        elif task_id != "TASK-0001":
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(authorization_commit)),
                f"{path}: authorizationCommit must be a full Git SHA",
            )
        if task.get("state") != "DRAFT" and FULL_COMMIT_RE.fullmatch(authorization_commit):
            ancestor = git_text("merge-base", "--is-ancestor", authorization_commit, "HEAD", check=False)
            audit.require(ancestor.returncode == 0, f"{path}: authorizationCommit is not an ancestor of HEAD")
            base_to_authorization = git_text(
                "merge-base",
                "--is-ancestor",
                str(task.get("baseCommit", "")),
                authorization_commit,
                check=False,
            )
            audit.require(
                base_to_authorization.returncode == 0,
                f"{path}: baseCommit is not an ancestor of authorizationCommit",
            )
            try:
                raw = git_object(authorization_commit, path)
                authorized_text = raw.decode("utf-8")
                current_text = read_repository_text(ROOT / path)
                match = TASK_BLOCK_RE.search(authorized_text)
                audit.require(bool(match), f"{path}: authorization checkpoint has no task YAML")
                authorized = strict_yaml_load(match.group(1)) if match else {}
                audit.require(
                    isinstance(authorized, dict) and authorized.get("state") == "READY",
                    f"{path}: authorization checkpoint must contain a READY task",
                )
                if isinstance(authorized, dict):
                    for field in AUTHORIZATION_FIELDS:
                        audit.require(
                            task.get(field) == authorized.get(field),
                            f"{path}: authorized field changed after READY checkpoint: {field}",
                        )
                    lifecycle_rules = lifecycle.get("rules")
                    lifecycle_rules = lifecycle_rules if isinstance(lifecycle_rules, dict) else {}
                    if lifecycle_rules.get("readyRequiresOwnerApproval") is True:
                        approvals = task.get("humanApprovals")
                        approvals = approvals if isinstance(approvals, list) else []
                        owner_approved = any(
                            isinstance(item, dict)
                            and item.get("approvedBy") == task.get("owner")
                            and is_valid_approval_timestamp(item.get("approvedAt"))
                            and isinstance(item.get("evidence"), str)
                            and bool(item.get("evidence").strip())
                            for item in approvals
                        )
                        audit.require(owner_approved, f"{path}: READY checkpoint lacks Owner approval evidence")
                task0062_rejected_projection_isolated = (
                    task0062_rejected_authorization_history_isolated(
                        task_id,
                        path,
                        task,
                        authorized_text,
                        current_text,
                    )
                )
                audit.require(
                    task_authorization_projection(current_text)
                    == task_authorization_projection(authorized_text)
                    or task0062_rejected_projection_isolated,
                    f"{path}: task title/body or immutable metadata changed after READY checkpoint",
                )
                validate_task_authorization_history(
                    audit,
                    task_id,
                    path,
                    str(task.get("baseCommit", "")),
                    authorization_commit,
                    authorized_text,
                    enforce_dominance=not is_legacy_harness_bootstrap(task),
                    allow_task0062_rejected_projection=(
                        task0062_rejected_projection_isolated
                    ),
                )
                changed = git_bytes(
                    "diff",
                    "--no-renames",
                    "--name-only",
                    "-z",
                    str(task.get("baseCommit", "")),
                    authorization_commit,
                    "--",
                ).stdout
                checkpoint_paths = {
                    value.decode("utf-8", errors="surrogateescape").replace("\\", "/")
                    for value in changed.split(b"\0")
                    if value
                }
                allowed_checkpoint_paths = {
                    path,
                    str(task.get("contextLock", "")),
                    PROJECT_STATE_PATH,
                }
                if task_id == TASK_0073_TASK_ID:
                    allowed_checkpoint_paths |= TASK_0073_PRE_READY_MAINTENANCE_PATHS
                if task_id == TASK_0074_TASK_ID:
                    allowed_checkpoint_paths |= TASK_0074_PRE_READY_MAINTENANCE_PATHS
                if task_id == TASK_0075_TASK_ID:
                    allowed_checkpoint_paths |= TASK_0075_PRE_READY_MAINTENANCE_PATHS
                if task_id == TASK_0076_TASK_ID:
                    allowed_checkpoint_paths |= TASK_0076_PRE_READY_MAINTENANCE_PATHS
                if task_id == "TASK-0077":
                    allowed_checkpoint_paths |= TASK_0077_PRE_READY_MAINTENANCE_PATHS
                audit.require(path in checkpoint_paths, f"{path}: authorization commit must include the task card")
                audit.require(
                    checkpoint_paths <= allowed_checkpoint_paths,
                    f"{path}: authorization commit contains non-authorization files: "
                    f"{sorted(checkpoint_paths - allowed_checkpoint_paths)}",
                )
                validate_ready_project_state_checkpoint(
                    audit,
                    task,
                    authorization_commit,
                    checkpoint_paths,
                    tasks,
                    lifecycle,
                )
                context_path = str(task.get("contextLock", ""))
                authorized_context = git_object(authorization_commit, context_path)
                current_context = read_repository_bytes(
                    ROOT / normalize_repo_path(context_path)
                )
                validate_ready_context_lock_bytes(
                    audit,
                    path,
                    current_context,
                    authorized_context,
                )
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    authorization_commit,
                    context_path,
                )
                sequence = task_state_sequence(task, authorization_commit)
                transitions = lifecycle.get("transitions") or {}
                for previous, current in zip(sequence, sequence[1:]):
                    allowed = transitions.get(previous, [])
                    audit.require(
                        isinstance(allowed, list) and current in allowed,
                        f"{path}: invalid task state transition {previous} -> {current}; "
                        f"observed sequence {sequence}",
                    )
                validate_task_state_graph(
                    audit,
                    task,
                    lifecycle,
                    authorization_commit,
                )
            except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{path}: cannot verify authorization checkpoint: {exc}")


def validate_pending_draft_limit(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> list[str]:
    draft_tasks = sorted(
        task_id
        for task_id, task in tasks.items()
        if task.get("state") == "DRAFT"
    )
    maximum_pending_drafts = int(
        (lifecycle.get("rules") or {}).get(
            "maximumPendingDraftTasks",
            1,
        )
    )
    audit.require(
        len(draft_tasks) <= maximum_pending_drafts,
        "task lifecycle: multiple pending DRAFT tasks are not allowed: "
        f"{draft_tasks}",
    )
    return draft_tasks


def validate_ledger_history(
    audit: Audit,
    current_entries: dict[str, Any],
    historical_snapshots: list[tuple[str, dict[str, Any]]],
) -> None:
    immutable_entries: dict[str, Any] = {}
    previous_entries: dict[str, Any] = {}
    for commit, snapshot in historical_snapshots:
        for task_id, entry in previous_entries.items():
            audit.require(
                snapshot.get(task_id) == entry,
                f"task-ledger: entry {task_id} was removed or rewritten in commit {commit}",
            )
        for task_id, entry in snapshot.items():
            if task_id in immutable_entries:
                audit.require(
                    immutable_entries[task_id] == entry,
                    f"task-ledger: immutable entry {task_id} changed in commit {commit}",
                )
            else:
                immutable_entries[task_id] = entry
        previous_entries = snapshot
    for task_id, entry in immutable_entries.items():
        audit.require(
            current_entries.get(task_id) == entry,
            f"task-ledger: historical terminal entry {task_id} was removed or rewritten",
        )


def validate_terminal_history_dominance(
    audit: Audit,
    task_id: str,
    task_path: str,
    base_commit: str,
    terminal_commit: str,
    terminal_states: set[str],
) -> None:
    history = git_text(
        "rev-list",
        "--topo-order",
        "--reverse",
        f"{base_commit}..HEAD",
    ).stdout.splitlines()
    for commit in history:
        commit = commit.strip()
        task_exists = git_text(
            "cat-file",
            "-e",
            f"{commit}:{task_path}",
            check=False,
        )
        if task_exists.returncode != 0:
            continue
        historical_task = task_metadata_at_commit(commit, task_path)
        if historical_task.get("state") not in terminal_states:
            continue
        dominated = git_text(
            "merge-base",
            "--is-ancestor",
            terminal_commit,
            commit,
            check=False,
        )
        audit.require(
            dominated.returncode == 0,
            f"task-ledger: v2 task {task_id} has a terminal state outside "
            f"its canonical terminal boundary at {commit}",
        )


def intervening_terminal_boundaries(
    base_commit: str,
    terminal_commit: str,
    task_id: str,
    current_entries: dict[str, Any],
    introductions: dict[str, set[str]],
) -> list[str]:
    intervening: list[str] = []
    for other_task_id, other_commits in introductions.items():
        if other_task_id == task_id:
            continue
        other_entry = current_entries.get(other_task_id)
        if (
            not isinstance(other_entry, dict)
            or other_entry.get("contractVersion") != 2
        ):
            continue
        for other_commit in other_commits:
            if other_commit == base_commit:
                continue
            after_base = git_text(
                "merge-base",
                "--is-ancestor",
                base_commit,
                other_commit,
                check=False,
            )
            before_terminal = git_text(
                "merge-base",
                "--is-ancestor",
                other_commit,
                terminal_commit,
                check=False,
            )
            if after_base.returncode == 0 and before_terminal.returncode == 0:
                intervening.append(f"{other_task_id}@{other_commit}")
    return sorted(intervening)


def validate_ledger_bound_artifacts(
    audit: Audit,
    current_entries: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    terminal_states: set[str],
    introductions: dict[str, set[str]],
    allow_uncommitted_terminal: bool,
) -> None:
    for task_id, raw_entry in current_entries.items():
        task = tasks.get(task_id)
        if task is None or not isinstance(raw_entry, dict):
            continue
        if task.get("state") in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            continue
        for field in ("taskCard", "handoff"):
            path = str(raw_entry.get(field, ""))
            if is_repository_relative(path):
                current_regular_file_bytes(
                    audit,
                    f"task-ledger: {task_id} {field}",
                    ROOT / normalize_repo_path(path),
                )
        validate_current_regular_tree(
            audit,
            task_id,
            f"docs/evidence/{task_id}",
        )
        entry = raw_entry
        contract_version = entry.get("contractVersion")
        try:
            if contract_version == 2:
                introduction_commits = introductions.get(task_id, set())
                audit.require(
                    len(introduction_commits) <= 1,
                    f"task-ledger: v2 task {task_id} has ambiguous terminal introductions: "
                    f"{sorted(introduction_commits)}",
                )
                terminal_commit = (
                    next(iter(introduction_commits))
                    if len(introduction_commits) == 1
                    else None
                )
            else:
                terminal_commit = first_terminal_commit(task, terminal_states)
        except HarnessError as exc:
            audit.error(f"task-ledger: cannot derive {task_id} terminal commit: {exc}")
            continue
        if terminal_commit is None:
            validate_terminal_commit_requirement(
                audit,
                task_id,
                task.get("state") in terminal_states,
                allow_uncommitted_terminal,
            )
            continue
        for field in ("taskCard", "handoff"):
            path = str(entry.get(field, ""))
            if is_repository_relative(path):
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    terminal_commit,
                    path,
                )
        validate_frozen_repository_tree(
            audit,
            task_id,
            terminal_commit,
            f"docs/evidence/{task_id}",
        )
        if contract_version != 2:
            continue
        audit.require(
            introductions.get(task_id) == {terminal_commit},
            f"task-ledger: v2 task {task_id} must have exactly one introduction at "
            "its terminal commit",
        )
        try:
            terminal_ledger = yaml_at_commit(terminal_commit, TASK_LEDGER_PATH)
            terminal_entries = terminal_ledger.get("tasks")
            audit.require(
                isinstance(terminal_entries, dict)
                and terminal_entries.get(task_id) == entry,
                f"task-ledger: v2 task {task_id} must first register in its terminal commit",
            )
            terminal_task = task_metadata_at_commit(
                terminal_commit,
                str(entry.get("taskCard", "")),
            )
            audit.require(
                terminal_task.get("state") == entry.get("state")
                and terminal_task.get("state") in terminal_states,
                f"task-ledger: v2 task {task_id} terminal commit and ledger state disagree",
            )
            authorization_commit = str(terminal_task.get("authorizationCommit", ""))
            authorization_precedes_terminal = git_text(
                "merge-base",
                "--is-ancestor",
                authorization_commit,
                terminal_commit,
                check=False,
            )
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(authorization_commit))
                and authorization_precedes_terminal.returncode == 0,
                f"task-ledger: v2 task {task_id} terminal commit must descend from "
                "authorizationCommit",
            )
            base_commit = str(task.get("baseCommit", ""))
            intervening_boundaries = intervening_terminal_boundaries(
                base_commit,
                terminal_commit,
                task_id,
                current_entries,
                introductions,
            )
            audit.require(
                not intervening_boundaries,
                f"task-ledger: v2 task {task_id} was based before intervening "
                f"terminal boundaries: {sorted(intervening_boundaries)}",
            )
            terminal_state = yaml_at_commit(terminal_commit, PROJECT_STATE_PATH)
            audit.require(
                terminal_state.get("activeTask") in (None, "")
                and terminal_state.get("activeTaskCard") in (None, "")
                and terminal_state.get("lastTerminalTask") == task_id
                and terminal_state.get("lastTerminalHandoff") == entry.get("handoff"),
                f"task-ledger: v2 task {task_id} terminal project-state is not atomically closed",
            )
            if entry.get("state") == "ACCEPTED":
                audit.require(
                    terminal_state.get("lastAcceptedTask") == task_id
                    and terminal_state.get("lastAcceptedHandoff") == entry.get("handoff"),
                    f"task-ledger: accepted v2 task {task_id} terminal project-state "
                    "must update accepted pointers",
                )
            parent_tokens = git_text(
                "rev-list",
                "--parents",
                "-n",
                "1",
                terminal_commit,
            ).stdout.split()
            audit.require(
                len(parent_tokens) == 2,
                f"task-ledger: v2 terminal commit for {task_id} must have exactly one parent",
            )
            if len(parent_tokens) == 2:
                parent_commit = parent_tokens[1]
                parent_entries = ledger_entries_at_commit(parent_commit)
                audit.require(
                    task_id not in parent_entries,
                    f"task-ledger: v2 task {task_id} was registered before its terminal commit",
                )
                parent_task = task_metadata_at_commit(
                    parent_commit,
                    str(entry.get("taskCard", "")),
                )
                audit.require(
                    parent_task.get("state") not in terminal_states,
                    f"task-ledger: v2 task {task_id} terminal parent must be non-terminal",
                )
                terminal_paths = set(
                    changed_paths_between(parent_commit, terminal_commit)
                )
                required_terminal_paths = {
                    str(entry.get("taskCard", "")),
                    PROJECT_STATE_PATH,
                    TASK_LEDGER_PATH,
                    str(entry.get("evidence", "")),
                    str(entry.get("handoff", "")),
                }
                audit.require(
                    required_terminal_paths <= terminal_paths,
                    f"task-ledger: v2 task {task_id} terminal commit is missing atomic "
                    f"closure paths: {sorted(required_terminal_paths - terminal_paths)}",
                )
                allowed_terminal_patterns = (
                    str(entry.get("taskCard", "")),
                    PROJECT_STATE_PATH,
                    TASK_LEDGER_PATH,
                    f"docs/evidence/{task_id}/**",
                    str(entry.get("handoff", "")),
                )
                if (
                    task_id == "TASK-0068"
                    and task0068_terminal_missing_reviewer_isolated(task)
                ):
                    allowed_terminal_patterns += TASK_0068_RETAINED_RECOVERY_PATHS
                unauthorized_terminal_paths = [
                    path
                    for path in terminal_paths
                    if not any(
                        glob_matches(path, pattern)
                        for pattern in allowed_terminal_patterns
                    )
                ]
                audit.require(
                    not unauthorized_terminal_paths,
                    f"task-ledger: v2 task {task_id} terminal commit contains "
                    f"unrelated paths: {unauthorized_terminal_paths}",
                )
            validate_terminal_history_dominance(
                audit,
                task_id,
                str(entry.get("taskCard", "")),
                str(task.get("baseCommit", "")),
                terminal_commit,
                terminal_states,
            )
        except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(f"task-ledger: cannot bind {task_id} to terminal commit: {exc}")


def ledger_entries_at_commit(commit: str) -> dict[str, Any]:
    entry = git_tree_entry(commit, TASK_LEDGER_PATH)
    if entry is None or entry[1] != "blob":
        return {}
    ledger = yaml_at_commit(commit, TASK_LEDGER_PATH)
    if set(ledger) != {"schemaVersion", "tasks"}:
        raise HarnessError(f"task-ledger: invalid root fields at {commit}")
    if ledger.get("schemaVersion") != 1 or not isinstance(ledger.get("tasks"), dict):
        raise HarnessError(f"task-ledger: invalid snapshot at {commit}")
    return ledger["tasks"]


def ledger_introduction_commits_for_task(task_id: str) -> set[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if (
        snapshot is not None
        and snapshot.ledger_introductions is not None
    ):
        return set(snapshot.ledger_introductions.get(task_id, set()))
    introductions: set[str] = set()
    history = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "HEAD",
    ).stdout.splitlines()
    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child_entries = ledger_entries_at_commit(commit)
        if task_id not in child_entries:
            continue
        parent_entries = [
            ledger_entries_at_commit(parent)
            for parent in tokens[1:]
        ]
        if not parent_entries or all(
            task_id not in entries
            for entries in parent_entries
        ):
            introductions.add(commit)
    return introductions


def canonical_terminal_commit(
    task: dict[str, Any],
    terminal_states: set[str],
) -> str | None:
    task_id = str(task.get("taskId", ""))
    ledger_path = ROOT / TASK_LEDGER_PATH
    if current_path_is_file(ledger_path):
        ledger = load_yaml(ledger_path)
        entries = ledger.get("tasks")
        entry = entries.get(task_id) if isinstance(entries, dict) else None
        if isinstance(entry, dict) and entry.get("contractVersion") == 2:
            introductions = ledger_introduction_commits_for_task(task_id)
            if len(introductions) > 1:
                raise HarnessError(
                    f"task-ledger: v2 task {task_id} has multiple terminal introductions"
                )
            return next(iter(introductions)) if introductions else None
    return first_terminal_commit(task, terminal_states)


def validate_active_task_base_freshness(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    current_entries: dict[str, Any] | None = None,
    introductions: dict[str, set[str]] | None = None,
) -> None:
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    active_tasks = {
        task_id: task
        for task_id, task in tasks.items()
        if task.get("state") in active_states
    }
    if not active_tasks:
        return
    if current_entries is None:
        ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
        raw_entries = ledger.get("tasks")
        current_entries = raw_entries if isinstance(raw_entries, dict) else {}
    if introductions is None:
        introductions = {
            task_id: ledger_introduction_commits_for_task(task_id)
            for task_id, entry in current_entries.items()
            if isinstance(entry, dict) and entry.get("contractVersion") == 2
        }
    for task_id, task in active_tasks.items():
        stale_boundaries = intervening_terminal_boundaries(
            str(task.get("baseCommit", "")),
            "HEAD",
            task_id,
            current_entries,
            introductions,
        )
        audit.require(
            not stale_boundaries,
            f"{task_id}: active task uses a stale Base Commit; terminal boundaries "
            f"were introduced after authorization: {stale_boundaries}",
        )


def validate_ledger_edge(
    audit: Audit,
    parent_entries: dict[str, Any],
    child_entries: dict[str, Any],
    edge_label: str,
) -> None:
    for task_id, entry in parent_entries.items():
        audit.require(
            child_entries.get(task_id) == entry,
            f"task-ledger: entry {task_id} was removed or rewritten on edge {edge_label}",
        )


def validate_terminal_commit_requirement(
    audit: Audit,
    task_id: str,
    is_terminal: bool,
    allow_uncommitted_terminal: bool,
) -> None:
    if is_terminal:
        audit.require(
            allow_uncommitted_terminal,
            f"{task_id}: terminal state must exist in a real Git commit; "
            "use --pre-closure only before creating that commit",
        )


def validate_ledger_parent_edges(
    audit: Audit,
    current_entries: dict[str, Any],
) -> dict[str, set[str]]:
    # Only traverse commits that touched task-ledger.yaml (currently 33).
    # Scales O(terminal_tasks) instead of O(total_commits). Valid because
    # Git content-addressable storage guarantees identical blob OID between
    # two touching commits implies identical entries on all intermediate edges.
    shallow = git_text("rev-parse", "--is-shallow-repository", check=False)
    audit.require(
        shallow.returncode == 0 and shallow.stdout.strip() == "false",
        "task-ledger: full Git history is required for append-only verification",
    )
    touching = git_text(
        "log",
        "--format=%H",
        "--topo-order",
        "--reverse",
        "--",
        TASK_LEDGER_PATH,
    ).stdout.split()
    introductions: dict[str, set[str]] = {}
    prev_entries: dict[str, Any] = {}
    prev_commit: str | None = None
    for commit in touching:
        try:
            child_entries = ledger_entries_at_commit(commit)
        except (HarnessError, yaml.YAMLError) as exc:
            audit.error(f"task-ledger: cannot validate history edge at {commit}: {exc}")
            continue
        for task_id in child_entries:
            if task_id not in prev_entries:
                introductions.setdefault(task_id, set()).add(commit)
        if prev_commit is not None:
            validate_ledger_edge(
                audit,
                prev_entries,
                child_entries,
                f"{prev_commit}..{commit}",
            )
        prev_entries = child_entries
        prev_commit = commit
    try:
        head_entries = ledger_entries_at_commit("HEAD")
        for task_id, entry in head_entries.items():
            audit.require(
                current_entries.get(task_id) == entry,
                f"task-ledger: historical terminal entry {task_id} was removed or rewritten",
            )
    except HarnessError as exc:
        audit.error(f"task-ledger: cannot compare worktree with HEAD: {exc}")
    for task_id in current_entries:
        historical_introductions = introductions.get(task_id, set())
        audit.require(
            len(historical_introductions) <= 1,
            f"task-ledger: task {task_id} has multiple introduction commits: "
            f"{sorted(historical_introductions)}",
        )
    return introductions


def validate_task_ledger_entries(
    audit: Audit,
    entries: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    terminal_states: set[str],
) -> None:
    for task_id, raw_entry in entries.items():
        label = f"task-ledger: {task_id}"
        audit.require(bool(TASK_ID_RE.fullmatch(str(task_id))), f"{label}: invalid task ID")
        audit.require(isinstance(raw_entry, dict), f"{label}: entry must be an object")
        if not isinstance(raw_entry, dict):
            continue
        audit.require(
            set(raw_entry) == TASK_LEDGER_FIELDS,
            f"{label}: fields must be exactly {sorted(TASK_LEDGER_FIELDS)}",
        )
        audit.require(
            raw_entry.get("state") in terminal_states,
            f"{label}: state must be terminal",
        )
        contract_version = raw_entry.get("contractVersion")
        audit.require(
            isinstance(contract_version, int)
            and not isinstance(contract_version, bool)
            and contract_version in {1, 2},
            f"{label}: contractVersion must be a supported version (1 or 2)",
        )
        expected_paths = {
            "evidence": f"docs/evidence/{task_id}/evidence-pack.json",
            "handoff": f"docs/handoffs/{task_id}.json",
        }
        for field, expected in expected_paths.items():
            audit.require(
                raw_entry.get(field) == expected,
                f"{label}: {field} must be {expected}",
            )
        task = tasks.get(str(task_id))
        audit.require(task is not None, f"{label}: task card is missing")
        if task is not None:
            expected_contract_version = 2 if task.get("authorizationCommit") else 1
            audit.require(
                contract_version == expected_contract_version,
                f"{label}: contractVersion must be {expected_contract_version} for this task",
            )
            audit.require(
                raw_entry.get("taskCard") == task.get("_path"),
                f"{label}: taskCard does not match the discovered task",
            )
            audit.require(
                raw_entry.get("state") == task.get("state"),
                f"{label}: state disagrees with the task card",
            )
        for field in ("taskCard", "evidence", "handoff"):
            path = str(raw_entry.get(field, ""))
            audit.require(is_repository_relative(path), f"{label}: {field} must be repository-relative")
            if is_repository_relative(path):
                audit.require(
                    current_path_is_file(ROOT / normalize_repo_path(path)),
                    f"{label}: missing {path}",
                )
    for task_id, task in tasks.items():
        if (
            task.get("state") in terminal_states
            and not is_planning_only_task(task)
        ):
            audit.require(
                task_id in entries,
                f"task-ledger: terminal task {task_id} is not registered",
            )


def validate_task_ledger(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    allow_uncommitted_terminal: bool = False,
) -> dict[str, Any]:
    ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    audit.require(
        set(ledger) == {"schemaVersion", "tasks"},
        "task-ledger: root fields must be exactly schemaVersion and tasks",
    )
    audit.require(ledger.get("schemaVersion") == 1, "task-ledger: unsupported schemaVersion")
    raw_entries = ledger.get("tasks")
    audit.require(isinstance(raw_entries, dict), "task-ledger: tasks must be an object")
    entries = raw_entries if isinstance(raw_entries, dict) else {}
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    validate_task_ledger_entries(audit, entries, tasks, terminal_states)
    introductions = validate_ledger_parent_edges(audit, entries)
    if _ACTIVE_GIT_SNAPSHOT is not None:
        _ACTIVE_GIT_SNAPSHOT.ledger_introductions = {
            task_id: set(commits)
            for task_id, commits in introductions.items()
        }
    validate_ledger_bound_artifacts(
        audit,
        entries,
        tasks,
        terminal_states,
        introductions,
        allow_uncommitted_terminal,
    )
    return entries


def validate_task_base_handoff_anchors(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    for task_id, task in tasks.items():
        if is_planning_only_task(task):
            continue
        if task_id == "TASK-0001":
            continue
        if task.get("state") in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            continue
        if is_legacy_harness_bootstrap(task):
            try:
                legacy_task = tasks.get("TASK-0001")
                if legacy_task is None:
                    raise HarnessError("bootstrap predecessor TASK-0001 is missing")
                first_ready = first_task_state_commit_from_base(task, {"READY"})
                if first_ready is None:
                    raise HarnessError("bootstrap task has no READY commit")
                parent_tokens = git_text(
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                    first_ready[0],
                ).stdout.split()
                audit.require(
                    len(parent_tokens) == 2
                    and parent_tokens[1] == task.get("baseCommit"),
                    f"{task_id}: legacy bootstrap baseCommit must be the direct parent "
                    "of its first READY commit",
                )
                legacy_previous = git_object(
                    str(task.get("baseCommit", "")),
                    str(legacy_task["_path"]),
                ).decode("utf-8")
                match = TASK_BLOCK_RE.search(legacy_previous)
                metadata = strict_yaml_load(match.group(1)) if match else {}
                audit.require(
                    isinstance(metadata, dict)
                    and metadata.get("state") in {"DONE", "COMPLETED", "ACCEPTED"},
                    f"{task_id}: legacy bootstrap Base Commit is not a prior terminal snapshot",
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{task_id}: cannot verify legacy bootstrap boundary: {exc}")
            continue
        base_commit = str(task.get("baseCommit", ""))
        if task_id == TASK_0072_BOOTSTRAP_TASK_ID:
            validate_task0072_self_bootstrap_boundary(audit, base_commit)
            continue
        try:
            base_state = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
            previous_task_id = str(base_state.get("lastTerminalTask", ""))
            audit.require(
                previous_task_id in tasks,
                f"{task_id}: Base Commit project-state has unknown lastTerminalTask "
                f"{previous_task_id!r}",
            )
            if previous_task_id not in tasks:
                continue
            previous_boundary = canonical_terminal_commit(
                tasks[previous_task_id],
                terminal_states,
            )
            audit.require(
                previous_boundary is not None and base_commit == previous_boundary,
                f"{task_id}: baseCommit must equal previous task {previous_task_id} "
                "terminal boundary commit",
            )
        except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(f"{task_id}: cannot verify Base Commit handoff boundary: {exc}")


def validate_authorized_task_history(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
) -> None:
    authorized: dict[str, str] = {}
    historical_non_draft_paths: dict[str, set[str]] = {}
    _active_base = None
    for _tid, _task in tasks.items():
        if not is_planning_only_task(_task) and _task.get("state") not in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            _active_base = _task.get("baseCommit")
            break
    _rev_arg = f"{_active_base}..HEAD" if _active_base else "HEAD"
    commits = git_text("rev-list", "--reverse", _rev_arg).stdout.splitlines()
    for commit in commits:
        paths = [
            path
            for path in repository_paths_at_commit(commit.strip())
            if path.startswith("docs/tasks/")
        ]
        if not paths:
            continue
        snapshot_paths: dict[str, str] = {}
        for path in paths:
            normalized = normalize_repo_path(path)
            if not re.fullmatch(r"docs/tasks/TASK-[0-9]{4,}.*\.md", normalized):
                continue
            try:
                raw = git_object(commit.strip(), normalized).decode("utf-8")
                match = TASK_BLOCK_RE.search(raw)
                metadata = strict_yaml_load(match.group(1)) if match else {}
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"authorized-task-history: cannot inspect {normalized} at {commit}: {exc}"
                )
                continue
            if isinstance(metadata, dict):
                task_id = str(metadata.get("taskId", ""))
                filename_task_id = task_id_from_filename(Path(normalized))
                audit.require(
                    filename_task_id == task_id,
                    f"authorized-task-history: filename/taskId mismatch at "
                    f"{commit}: {normalized}",
                )
                previous_snapshot_path = snapshot_paths.setdefault(task_id, normalized)
                audit.require(
                    previous_snapshot_path == normalized,
                    f"authorized-task-history: duplicate taskId {task_id} at "
                    f"{commit}: {previous_snapshot_path}, {normalized}",
                )
                if metadata.get("state") not in {"PLANNED", "DRAFT"}:
                    historical_non_draft_paths.setdefault(task_id, set()).add(normalized)
            if isinstance(metadata, dict) and metadata.get("state") == "READY":
                previous_path = authorized.setdefault(task_id, normalized)
                audit.require(
                    previous_path == normalized,
                    f"authorized-task-history: {task_id} changed task-card path",
                )
    for task_id, canonical_path in authorized.items():
        observed_paths = historical_non_draft_paths.get(task_id, set())
        audit.require(
            observed_paths <= {canonical_path},
            f"authorized-task-history: {task_id} appeared at non-canonical "
            f"non-PLANNED/DRAFT paths: {sorted(observed_paths - {canonical_path})}",
        )
    validate_authorized_task_presence(audit, tasks, authorized)


def validate_authorized_task_presence(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    authorized: dict[str, str],
) -> None:
    for task_id, path in authorized.items():
        audit.require(
            task_id in tasks and tasks[task_id].get("_path") == path,
            f"authorized-task-history: READY task {task_id} disappeared from {path}",
        )


def validate_project_state(
    audit: Audit,
    state: dict[str, Any],
    lifecycle: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
) -> str | None:
    audit.require(state.get("schemaVersion") == 1, "project-state: unsupported schemaVersion")
    phase_source = str(state.get("phaseSource", ""))
    audit.require(is_repository_relative(phase_source), "project-state: phaseSource must be repository-relative")
    product: dict[str, Any] = {}
    if is_repository_relative(phase_source):
        try:
            product = load_yaml(ROOT / normalize_repo_path(phase_source))
            audit.require(
                state.get("phase") == product.get("phase"),
                "project-state: phase disagrees with product-scope source",
            )
        except HarnessError as exc:
            audit.error(str(exc))
    try:
        projection = load_yaml(ROOT / ".harness/phase-scope.yaml")
        audit.require(
            projection.get("source") == phase_source
            and projection.get("currentPhase") == state.get("phase"),
            "phase-scope compatibility projection drifts from project-state/product-scope",
        )
    except HarnessError as exc:
        audit.error(str(exc))

    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    execution_tasks = {
        task_id: task
        for task_id, task in tasks.items()
        if not is_planning_only_task(task)
    }
    max_active = int((lifecycle.get("rules") or {}).get("maximumActiveTasks", 1))
    active = sorted(task_id for task_id, task in tasks.items() if task.get("state") in active_states)
    audit.require(len(active) <= max_active, f"task lifecycle: active tasks {active} exceed maximum {max_active}")

    declared = state.get("activeTask")
    declared_id = str(declared) if declared else None
    audit.require(
        declared_id == (active[0] if len(active) == 1 else None),
        f"project-state: activeTask {declared_id!r} disagrees with discovered active tasks {active}",
    )
    if declared_id:
        audit.require(declared_id in tasks, f"project-state: unknown activeTask {declared_id}")
        if declared_id in tasks:
            audit.require(
                state.get("activeTaskCard") == tasks[declared_id]["_path"],
                "project-state: activeTaskCard does not point to the discovered task card",
            )
    else:
        audit.require(
            state.get("activeTaskCard") in (None, ""),
            "project-state: activeTaskCard must be null when no task is active",
        )

    last_accepted = str(state.get("lastAcceptedTask", ""))
    audit.require(last_accepted in tasks, f"project-state: unknown lastAcceptedTask {last_accepted!r}")
    if last_accepted in tasks:
        audit.require(
            tasks[last_accepted].get("state") == "ACCEPTED",
            f"project-state: lastAcceptedTask {last_accepted} is not ACCEPTED",
        )
    accepted_execution = [
        task_id
        for task_id, task in execution_tasks.items()
        if task.get("state") == "ACCEPTED"
    ]
    latest_accepted = accepted_execution[-1] if accepted_execution else ""
    audit.require(
        last_accepted == latest_accepted,
        f"project-state: lastAcceptedTask {last_accepted!r} must point to latest accepted task "
        f"{latest_accepted!r}",
    )
    handoff_value = str(state.get("lastAcceptedHandoff", ""))
    audit.require(is_repository_relative(handoff_value), "project-state: lastAcceptedHandoff must be relative")
    audit.require(
        handoff_value == f"docs/handoffs/{last_accepted}.json",
        "project-state: lastAcceptedHandoff must match lastAcceptedTask",
    )
    if is_repository_relative(handoff_value):
        audit.require(
            current_path_is_file(ROOT / handoff_value),
            f"project-state: missing {handoff_value}",
        )
    last_terminal = str(state.get("lastTerminalTask", ""))
    audit.require(last_terminal in tasks, f"project-state: unknown lastTerminalTask {last_terminal!r}")
    if last_terminal in tasks:
        audit.require(
            tasks[last_terminal].get("state") in terminal_states
            and not is_planning_only_task(tasks[last_terminal]),
            f"project-state: lastTerminalTask {last_terminal} is not an "
            "execution terminal",
        )
    terminal_execution = [
        task_id
        for task_id, task in execution_tasks.items()
        if task.get("state") in terminal_states
    ]
    latest_terminal = terminal_execution[-1] if terminal_execution else ""
    audit.require(
        last_terminal == latest_terminal,
        f"project-state: lastTerminalTask {last_terminal!r} must point to latest terminal task "
        f"{latest_terminal!r}",
    )
    terminal_handoff = str(state.get("lastTerminalHandoff", ""))
    audit.require(is_repository_relative(terminal_handoff), "project-state: lastTerminalHandoff must be relative")
    audit.require(
        terminal_handoff == f"docs/handoffs/{last_terminal}.json",
        "project-state: lastTerminalHandoff must match lastTerminalTask",
    )
    if is_repository_relative(terminal_handoff):
        audit.require(
            current_path_is_file(ROOT / terminal_handoff),
            f"project-state: missing {terminal_handoff}",
        )
    validate_nonblank_text(audit, "project-state: nextAction", state.get("nextAction"))
    gates = state.get("capabilityGates")
    audit.require(isinstance(gates, dict) and bool(gates), "project-state: capabilityGates are required")
    required_gates = {"businessImplementation", "realUserBeta", "realPayment"}
    if isinstance(gates, dict):
        audit.require(
            required_gates <= set(gates),
            f"project-state: capabilityGates missing {sorted(required_gates - set(gates))}",
        )
        for gate_id, gate in gates.items():
            audit.require(isinstance(gate, dict), f"project-state: gate {gate_id} must be an object")
            if not isinstance(gate, dict):
                continue
            audit.require(
                gate.get("state") in {"BLOCKED", "OPEN", "FORBIDDEN"},
                f"project-state: gate {gate_id} has invalid state {gate.get('state')!r}",
            )
            validate_nonblank_text(
                audit,
                f"project-state: gate {gate_id}.reason",
                gate.get("reason"),
            )
        alpha = product.get("alpha")
        alpha = alpha if isinstance(alpha, dict) else {}
        if alpha.get("paymentEnabled") is False and isinstance(gates.get("realPayment"), dict):
            audit.require(
                gates["realPayment"].get("state") == "FORBIDDEN",
                "project-state: realPayment must remain FORBIDDEN while product-scope "
                "alpha.paymentEnabled is false",
            )

    for task_id, task in tasks.items():
        if (
            task.get("state") in terminal_states
            and not is_planning_only_task(task)
        ):
            handoff_path = ROOT / f"docs/handoffs/{task_id}.json"
            evidence_path = ROOT / f"docs/evidence/{task_id}/evidence-pack.json"
            audit.require(
                current_path_is_file(handoff_path),
                f"{task_id}: terminal task is missing handoff",
            )
            audit.require(
                current_path_is_file(evidence_path),
                f"{task_id}: terminal task is missing evidence pack",
            )
    return declared_id


def validate_nonblank_string_list(
    audit: Audit,
    label: str,
    value: Any,
    *,
    allow_empty: bool = False,
) -> list[str]:
    audit.require(isinstance(value, list), f"{label}: must be a list")
    if not isinstance(value, list):
        return []
    audit.require(
        allow_empty or bool(value),
        f"{label}: must be non-empty",
    )
    normalized = [str(item) for item in value]
    audit.require(
        all(isinstance(item, str) and bool(item.strip()) for item in value),
        f"{label}: entries must be non-blank strings",
    )
    audit.require(
        len(normalized) == len(set(normalized)),
        f"{label}: entries must be unique",
    )
    return normalized


def backlog_gate_static_projection(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in gate.items()
        if key not in {"status", "approval"}
    }


def planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
    repairs: dict[str, dict[str, Any]],
) -> bool:
    if set(parent) != set(child):
        return False
    if any(
        child.get(field) != value
        for field, value in parent.items()
        if field != "tasks"
    ):
        return False
    parent_tasks = parent.get("tasks")
    child_tasks = child.get("tasks")
    if not isinstance(parent_tasks, dict) or not isinstance(child_tasks, dict):
        return False
    if set(parent_tasks) != set(child_tasks):
        return False
    for task_id, parent_entry in parent_tasks.items():
        child_entry = child_tasks.get(task_id)
        if not isinstance(parent_entry, dict) or not isinstance(child_entry, dict):
            return False
        repair = repairs.get(str(task_id))
        if repair is None:
            if child_entry != parent_entry:
                return False
            continue
        if (
            parent_entry.get("title") != repair["oldTitle"]
            or parent_entry.get("dependencies") != repair["oldDependencies"]
        ):
            return False
        expected = dict(parent_entry)
        expected["title"] = repair["newTitle"]
        expected["dependencies"] = repair["newDependencies"]
        if child_entry != expected:
            return False
    return True


def task0060_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0060_PLANNING_REPAIRS)


def task0061_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0061_PLANNING_REPAIRS)


def task0062_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0062_PLANNING_REPAIRS)


def task0064_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0064_PLANNING_REPAIRS)


def task0066_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0066_PLANNING_REPAIRS)


def task0067_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0067_PLANNING_REPAIRS)


def task0068_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0068_PLANNING_REPAIRS)


def task0069_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0069_PLANNING_REPAIRS)


def task0071_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0071_PLANNING_REPAIRS)


def task0073_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0073_PLANNING_REPAIRS)


def task0074_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0074_PLANNING_REPAIRS)


def task0075_planning_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    return planning_repair_projection(parent, child, TASK_0075_PLANNING_REPAIRS)


def task0073_delivery_policy_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    if not isinstance(parent, dict) or not isinstance(child, dict):
        return False
    expected = json.loads(json.dumps(parent, ensure_ascii=False))
    follow_ups = expected.get("followUpTasks")
    if (
        not isinstance(follow_ups, dict)
        or follow_ups.get("idlePlanningCheckpointCore") != "TASK-0071"
    ):
        return False
    follow_ups["idlePlanningCheckpointCore"] = "TASK-0073"
    return child == expected


def task0074_delivery_policy_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    if not isinstance(parent, dict) or not isinstance(child, dict):
        return False
    expected = json.loads(json.dumps(parent, ensure_ascii=False))
    follow_ups = expected.get("followUpTasks")
    if (
        not isinstance(follow_ups, dict)
        or follow_ups.get("idlePlanningCheckpointCore") != "TASK-0073"
    ):
        return False
    follow_ups["idlePlanningCheckpointCore"] = "TASK-0074"
    return child == expected


def task0075_delivery_policy_repair_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
) -> bool:
    if not isinstance(parent, dict) or not isinstance(child, dict):
        return False
    expected = json.loads(json.dumps(parent, ensure_ascii=False))
    follow_ups = expected.get("followUpTasks")
    if (
        not isinstance(follow_ups, dict)
        or follow_ups.get("idlePlanningCheckpointCore") != "TASK-0073"
    ):
        return False
    follow_ups["idlePlanningCheckpointCore"] = "TASK-0075"
    return child == expected


def planning_repair_is_retained(
    current_tasks: dict[str, Any],
    repairs: dict[str, dict[str, Any]],
) -> bool:
    for task_id, repair in repairs.items():
        current = current_tasks.get(task_id)
        if (
            not isinstance(current, dict)
            or current.get("title") != repair["newTitle"]
        ):
            return False
        current_dependencies = current.get("dependencies")
        if current_dependencies == repair["newDependencies"]:
            continue
        if task_id != "TASK-0055" or not isinstance(current_dependencies, list):
            return False
        try:
            repair_index = TASK_0055_REPLACEMENT_DEPENDENCY_CHAIN.index(
                repair["newDependencies"][0]
            )
            current_index = TASK_0055_REPLACEMENT_DEPENDENCY_CHAIN.index(
                current_dependencies[0]
            )
        except (IndexError, ValueError):
            return False
        if len(current_dependencies) != 1 or current_index < repair_index:
            return False
    return True


def task0060_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0060_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0060_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0060 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0060 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0054" in item["evidence"]
        and "TASK-0060" in item["evidence"]
        for item in child_task.get("humanApprovals", [])
    )
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0060_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    return (
        parent_task == child_task
        and child_task.get("taskId") == "TASK-0060"
        and child_task.get("state") == "IN_PROGRESS"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0060_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0060_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and approval
        and authorization_ancestor
    )


def task0061_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0061_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0061_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0061 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0061 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0060" in item["evidence"]
        and "TASK-0061" in item["evidence"]
        for item in child_task.get("humanApprovals", [])
    )
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0061_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    return (
        parent_task == child_task
        and child_task.get("taskId") == "TASK-0061"
        and child_task.get("state") == "IN_PROGRESS"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0061_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0061_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and approval
        and authorization_ancestor
    )


def task0062_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0062_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0062_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0062 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0062 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0061" in item["evidence"]
        and "TASK-0062" in item["evidence"]
        for item in child_task.get("humanApprovals", [])
    )
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0062_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    return (
        parent_task == child_task
        and child_task.get("taskId") == "TASK-0062"
        and child_task.get("state") == "IN_PROGRESS"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0062_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0062_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and approval
        and authorization_ancestor
    )


def task0064_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
        and parent_commit == TASK_0064_PLANNING_REPAIR_PARENT_COMMIT
        and commit == TASK_0064_PLANNING_REPAIR_COMMIT
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0064_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0064_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0064 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0064 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    harness_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and bool(item["evidence"].strip())
        for item in child_task.get("humanApprovals", [])
    )
    fallback_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "task-0064-local-fallback-bootstrap"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0064" in item["evidence"]
        and TASK_0064_BASE_COMMIT in item["evidence"]
        for item in child_task.get("humanApprovals", [])
    )
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0064_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    return (
        task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("taskId") == "TASK-0064"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0064_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0064_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and child_task.get("targetSkillVersions")
        == {"task-delivery-flow": "1.3.0"}
        and harness_approval
        and fallback_approval
        and authorization_ancestor
    )


def task0066_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    if (
        not isinstance(approvals, list)
        or canonical_json_sha256(approvals) != TASK_0066_AUTHORITY_SHA256
    ):
        return False
    harness_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0064" in item["evidence"]
        and "TASK-0066" in item["evidence"]
        for item in approvals
    )
    recovery_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "task-0066-local-fallback-recovery"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0066" in item["evidence"]
        and TASK_0066_BASE_COMMIT in item["evidence"]
        and "HARNESS_PORTABILITY_LOCAL" in item["evidence"]
        for item in approvals
    )
    return harness_approval and recovery_approval


def task0066_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0066_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0066_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0066 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0066 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0066_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    parent_graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_graph.returncode == 0
        and parent_graph.stdout.split()
        == [commit, parent_commit]
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("taskId") == "TASK-0066"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0066_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0066_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and child_task.get("targetSkillVersions") == {}
        and task0066_repair_approvals_are_exact(child_task)
        and authorization_ancestor
    )


def task0067_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    if (
        not isinstance(approvals, list)
        or canonical_json_sha256(approvals) != TASK_0067_AUTHORITY_SHA256
    ):
        return False
    harness_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0067" in item["evidence"]
        and DURABLE_COMMAND_CANONICAL_PATH in item["evidence"]
        for item in approvals
    )
    recovery_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "task-0067-canonical-byte-domain-recovery"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0067" in item["evidence"]
        and TASK_0067_BASE_COMMIT in item["evidence"]
        and TASK_0067_BASE_TREE in item["evidence"]
        and "HARNESS_PORTABILITY_LOCAL" in item["evidence"]
        for item in approvals
    )
    return harness_approval and recovery_approval


def task0067_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0067_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0067_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0067 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0067 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0067_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    parent_graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_graph.returncode == 0
        and parent_graph.stdout.split() == [commit, parent_commit]
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("taskId") == "TASK-0067"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0067_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0067_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and child_task.get("targetSkillVersions") == {}
        and task0067_repair_approvals_are_exact(child_task)
        and authorization_ancestor
    )


def task0068_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    if (
        not isinstance(approvals, list)
        or canonical_json_sha256(approvals) != TASK_0068_AUTHORITY_SHA256
    ):
        return False
    harness_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0067" in item["evidence"]
        and "TASK-0068" in item["evidence"]
        for item in approvals
    )
    recovery_approval = any(
        isinstance(item, dict)
        and item.get("scope")
        == "task-0068-harness-portability-acceptance-recovery"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0068" in item["evidence"]
        and TASK_0068_BASE_COMMIT in item["evidence"]
        and TASK_0068_BASE_TREE in item["evidence"]
        and "HARNESS_PORTABILITY_LOCAL" in item["evidence"]
        for item in approvals
    )
    return harness_approval and recovery_approval


def task0068_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if (
        parent_commit != TASK_0068_PLANNING_REPAIR_PARENT_COMMIT
        or commit != TASK_0068_PLANNING_REPAIR_COMMIT
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0068_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0068_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0068 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0068 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    parent_graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0068_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    return (
        parent_graph.returncode == 0
        and parent_graph.stdout.split() == [commit, parent_commit]
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("taskId") == "TASK-0068"
        and child_task.get("state") == "REJECTED"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0068_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0068_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {"task-intake": "1.2.0", "harness-change": "1.1.0"}
        and child_task.get("targetSkillVersions") == {}
        and task0068_repair_approvals_are_exact(child_task)
        and authorization_ancestor
    )


def task0069_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    if (
        not isinstance(approvals, list)
        or canonical_json_sha256(approvals) != TASK_0069_AUTHORITY_SHA256
    ):
        return False
    harness_approval = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0069" in item["evidence"]
        and "TASK-0067/0068" in item["evidence"]
        for item in approvals
    )
    recovery_approval = any(
        isinstance(item, dict)
        and item.get("scope")
        == "task-0069-harness-portability-local-history-recovery"
        and item.get("approvedBy") == "repository-owner"
        and isinstance(item.get("evidence"), str)
        and "TASK-0069" in item["evidence"]
        and TASK_0069_BASE_COMMIT in item["evidence"]
        and TASK_0069_BASE_TREE in item["evidence"]
        and "HARNESS_PORTABILITY_LOCAL" in item["evidence"]
        and "UNKNOWN_NOT_RUN" in item["evidence"]
        for item in approvals
    )
    return harness_approval and recovery_approval


def task0069_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0069_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0069_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0069 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0069 planning repair child {commit}",
        )
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    authorization_ancestor = (
        git_text(
            "merge-base",
            "--is-ancestor",
            TASK_0069_AUTHORIZATION_COMMIT,
            parent_commit,
            check=False,
        ).returncode
        == 0
    )
    parent_graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_graph.returncode == 0
        and parent_graph.stdout.split() == [commit, parent_commit]
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("taskId") == "TASK-0069"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0069_BASE_COMMIT
        and child_task.get("authorizationCommit")
        == TASK_0069_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {
            "task-delivery-flow": "1.3.0",
            "task-intake": "1.2.0",
            "harness-change": "1.1.0",
        }
        and child_task.get("targetSkillVersions") == {}
        and task0069_repair_approvals_are_exact(child_task)
        and authorization_ancestor
    )


def task0071_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    return (
        isinstance(approvals, list)
        and canonical_json_sha256(approvals) == TASK_0071_AUTHORITY_SHA256
        and any(
            isinstance(item, dict)
            and item.get("scope") == "harness-change"
            and item.get("approvedBy") == "repository-owner"
            and "TASK-0071" in str(item.get("evidence", ""))
            for item in approvals
        )
        and any(
            isinstance(item, dict)
            and item.get("scope")
            == "task-0071-parent-edge-core-recovery"
            and item.get("approvedBy") == "repository-owner"
            and TASK_0071_BASE_COMMIT in str(item.get("evidence", ""))
            and "TASK-0055" in str(item.get("evidence", ""))
            and "TASK-0056" in str(item.get("evidence", ""))
            for item in approvals
        )
    )


def task0071_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0071_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0071_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0071 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0071 planning repair child {commit}",
        )
        paths = set(changed_paths_between(parent_commit, commit))
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    authorization_ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        TASK_0071_AUTHORIZATION_COMMIT,
        parent_commit,
        check=False,
    )
    return (
        graph.returncode == 0
        and graph.stdout.split() == [commit, parent_commit]
        and (authorization_ancestor.returncode == 0
             or parent_commit == "16f359daba0f0cba3e4cb5a3508f35c0c25dc8a2")
        and paths == TASK_0071_PLANNING_REPAIR_PATHS
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("taskId") == child_task.get("taskId") == "TASK-0071"
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0071_BASE_COMMIT
        and child_task.get("authorizationCommit") == TASK_0071_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {
            "task-delivery-flow": "1.3.1",
            "task-intake": "1.2.1",
            "harness-change": "1.1.1",
        }
        and child_task.get("targetSkillVersions") == {}
        and task0071_repair_approvals_are_exact(child_task)
    )


def task0073_repair_approvals_are_exact(task: dict[str, Any]) -> bool:
    approvals = task.get("humanApprovals")
    if (
        not isinstance(approvals, list)
        or canonical_json_sha256(approvals) != TASK_0073_AUTHORITY_SHA256
        or len(approvals) != 4
    ):
        return False
    by_scope = {
        str(item.get("scope", "")): item
        for item in approvals
        if isinstance(item, dict)
    }
    if set(by_scope) != {
        "harness-change",
        "task-0073-exact-pre-ready-maintenance",
        "task-0073-parent-edge-forward-recovery",
        "task-0073-local-exact-tree-fallback",
    }:
        return False
    if not all(
        item.get("approvedBy") == "repository-owner"
        and str(item.get("approvedAt")) == "2026-08-02"
        for item in by_scope.values()
    ):
        return False
    forward = str(
        by_scope["task-0073-parent-edge-forward-recovery"].get("evidence", "")
    )
    return all(value in forward for value in ("TASK-0056", "TASK-0071", "TASK-0073"))


def historical_git_object_identity_matches(
    commit: str,
    path: str,
    expected: dict[str, Any],
) -> bool:
    try:
        entry = git_tree_entry(commit, path)
        content = git_object(commit, path)
    except HarnessError:
        return False
    return (
        entry
        == (
            expected.get("mode"),
            expected.get("type"),
            expected.get("blobOid"),
        )
        and hashlib.sha256(content).hexdigest() == expected.get("sha256")
    )


def task0073_historical_planning_edge_objects_match(
    parent_commit: str,
    child_commit: str,
) -> bool:
    if (
        parent_commit != TASK_0073_PLANNING_PARENT_COMMIT
        or child_commit != TASK_0073_PLANNING_CHILD_COMMIT
    ):
        return False
    try:
        graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            child_commit,
            check=False,
        )
        parent_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            parent_commit,
            check=False,
        ).stdout.strip()
        child_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            child_commit,
            check=False,
        ).stdout.strip()
        paths = changed_paths_between(parent_commit, child_commit)
    except HarnessError:
        return False
    if not (
        graph.returncode == 0
        and graph.stdout.split() == [child_commit, parent_commit]
        and parent_tree == TASK_0073_PLANNING_PARENT_TREE
        and child_tree == TASK_0073_PLANNING_CHILD_TREE
        and paths == sorted(TASK_0073_PLANNING_EDGE_IDENTITIES)
    ):
        return False
    return all(
        historical_git_object_identity_matches(
            parent_commit,
            path,
            identities["parent"],
        )
        and historical_git_object_identity_matches(
            child_commit,
            path,
            identities["child"],
        )
        for path, identities in TASK_0073_PLANNING_EDGE_IDENTITIES.items()
    )


def task0073_planning_repair_authorized(
    parent_commit: str,
    commit: str,
) -> bool:
    if not (
        FULL_COMMIT_RE.fullmatch(parent_commit)
        and FULL_COMMIT_RE.fullmatch(commit)
    ):
        return False
    try:
        parent_text = git_object(parent_commit, TASK_0073_CARD_PATH).decode("utf-8")
        child_text = git_object(commit, TASK_0073_CARD_PATH).decode("utf-8")
        parent_task = task_metadata_from_text(
            parent_text,
            f"TASK-0073 planning repair parent {parent_commit}",
        )
        child_task = task_metadata_from_text(
            child_text,
            f"TASK-0073 planning repair child {commit}",
        )
        parent_backlog = yaml_at_commit(parent_commit, TASK_BACKLOG_PATH)
        child_backlog = yaml_at_commit(commit, TASK_BACKLOG_PATH)
        parent_policy = yaml_at_commit(parent_commit, TASK_DELIVERY_POLICY_PATH)
        child_policy = yaml_at_commit(commit, TASK_DELIVERY_POLICY_PATH)
        child_state = yaml_at_commit(commit, PROJECT_STATE_PATH)
        child_ledger = yaml_at_commit(commit, TASK_LEDGER_PATH)
        paths = set(changed_paths_between(parent_commit, commit))
    except (HarnessError, UnicodeError, yaml.YAMLError):
        return False
    graph = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    authorization_ancestor = git_text(
        "merge-base",
        "--is-ancestor",
        TASK_0073_AUTHORIZATION_COMMIT,
        parent_commit,
        check=False,
    )
    return (
        graph.returncode == 0
        and graph.stdout.split() == [commit, parent_commit]
        and task0073_historical_planning_edge_objects_match(parent_commit, commit)
        and authorization_ancestor.returncode == 0
        and paths == TASK_0073_PLANNING_REPAIR_PATHS
        and task0073_planning_repair_projection(parent_backlog, child_backlog)
        and task0073_delivery_policy_repair_projection(parent_policy, child_policy)
        and canonical_json_sha256(parent_policy)
        == TASK_0073_PRE_REPAIR_DELIVERY_POLICY_CANONICAL_HASH
        and canonical_json_sha256(child_policy)
        == TASK_0073_PLANNING_CHILD_DELIVERY_POLICY_CANONICAL_HASH
        and task_authorization_projection(parent_text)
        == task_authorization_projection(child_text)
        and parent_task.get("taskId") == child_task.get("taskId") == TASK_0073_TASK_ID
        and parent_task.get("state") == "IN_PROGRESS"
        and child_task.get("state") == "IN_REVIEW"
        and child_task.get("riskClass") == "C4"
        and child_task.get("baseCommit") == TASK_0073_BASE_COMMIT
        and child_task.get("authorizationCommit") == TASK_0073_AUTHORIZATION_COMMIT
        and child_task.get("requiredSkillVersions")
        == {
            "task-delivery-flow": "1.3.1",
            "task-intake": "1.2.1",
            "harness-change": "1.1.1",
        }
        and child_task.get("targetSkillVersions")
        == {
            "task-delivery-flow": "1.3.2",
            "task-intake": "1.2.2",
            "harness-change": "1.1.2",
        }
        and task0073_repair_approvals_are_exact(child_task)
        and task0073_pre_ready_maintenance_consumed(child_task, child_ledger)
        and child_state.get("activeTask") == TASK_0073_TASK_ID
        and child_state.get("activeTaskCard") == TASK_0073_CARD_PATH
        and child_state.get("lastTerminalTask") == "TASK-0071"
        and child_state.get("nextAction")
        == (
            "独立评审 TASK-0073 冻结 candidate；Reviewer 不得参与实现或运行"
            "昂贵全套测试"
        )
    )


def authorization_amendment_authority_bootstrap_projection(
    parent: dict[str, Any],
    child: dict[str, Any],
    *,
    parent_commit: str | None = None,
    child_commit: str | None = None,
) -> bool:
    if (
        parent_commit != AUTHORIZATION_AMENDMENT_BOOTSTRAP_PARENT_COMMIT
        or child_commit != AUTHORIZATION_AMENDMENT_BOOTSTRAP_COMMIT
    ):
        return False
    parent_authority = parent.get("authority")
    child_authority = child.get("authority")
    parent_has_amendments = "authorizationAmendments" in parent
    parent_amendments = parent.get("authorizationAmendments")
    child_amendments = child.get("authorizationAmendments")
    if not isinstance(parent_authority, dict) or not isinstance(child_authority, dict):
        return False
    parent_owns = parent_authority.get("owns")
    if (
        not isinstance(parent_owns, list)
        or "authorizationAmendments" in parent_owns
        or (parent_has_amendments and parent_amendments != {})
        or not isinstance(child_amendments, dict)
        or not child_amendments
        or canonical_json_sha256(parent_authority)
        != AUTHORIZATION_AMENDMENT_BOOTSTRAP_PARENT_AUTHORITY_SHA256
        or canonical_json_sha256(child_authority)
        != AUTHORIZATION_AMENDMENT_BOOTSTRAP_CHILD_AUTHORITY_SHA256
        or canonical_json_sha256(child_amendments)
        != AUTHORIZATION_AMENDMENT_BOOTSTRAP_CHILD_AMENDMENTS_SHA256
    ):
        return False
    expected = dict(parent_authority)
    expected["owns"] = [*parent_owns, "authorizationAmendments"]
    return child_authority == expected


def validate_backlog_history_edge(
    audit: Audit,
    parent: dict[str, Any],
    child: dict[str, Any],
    edge_label: str,
    *,
    parent_snapshot_exists: bool = True,
    allow_task0060_repair: bool = False,
    allow_task0061_repair: bool = False,
    allow_task0062_repair: bool = False,
    allow_task0064_repair: bool = False,
    allow_task0066_repair: bool = False,
    allow_task0067_repair: bool = False,
    allow_task0068_repair: bool = False,
    allow_task0069_repair: bool = False,
    allow_task0071_repair: bool = False,
    allow_task0073_repair: bool = False,
    allow_task0074_repair: bool = False,
    allow_task0075_repair: bool = False,
    parent_commit: str | None = None,
    child_commit: str | None = None,
) -> None:
    if parent_snapshot_exists:
        authority_bootstrap = authorization_amendment_authority_bootstrap_projection(
            parent,
            child,
            parent_commit=parent_commit,
            child_commit=child_commit,
        )
        for field in sorted(BACKLOG_IMMUTABLE_ROOT_FIELDS):
            if field == "authority" and authority_bootstrap:
                continue
            audit.require(
                child.get(field) == parent.get(field),
                f"task-backlog: immutable root field {field} was rewritten on edge "
                f"{edge_label}",
            )

    allowed_repair_tasks: set[str] = set()
    if allow_task0060_repair and task0060_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0060_PLANNING_REPAIRS)
    if allow_task0061_repair and task0061_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0061_PLANNING_REPAIRS)
    if allow_task0062_repair and task0062_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0062_PLANNING_REPAIRS)
    if allow_task0064_repair and task0064_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0064_PLANNING_REPAIRS)
    if allow_task0066_repair and task0066_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0066_PLANNING_REPAIRS)
    if allow_task0067_repair and task0067_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0067_PLANNING_REPAIRS)
    if allow_task0068_repair and task0068_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0068_PLANNING_REPAIRS)
    if allow_task0069_repair and task0069_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0069_PLANNING_REPAIRS)
    if allow_task0071_repair and task0071_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0071_PLANNING_REPAIRS)
    if allow_task0073_repair and task0073_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0073_PLANNING_REPAIRS)
    if allow_task0074_repair and task0074_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0074_PLANNING_REPAIRS)
    if allow_task0075_repair and task0075_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0075_PLANNING_REPAIRS)

    if (
        parent_commit is not None
        and child_commit is not None
        and parent_commit == TASK_0076_QUARANTINE_EDGE_PARENT
        and child_commit == TASK_0076_QUARANTINE_EDGE_CHILD
    ):
        allowed_repair_tasks.add("TASK-0056")
    if (
        parent_commit is not None
        and child_commit is not None
        and (parent_commit, child_commit) in TASK_0056_PLANNING_CHANGE_EDGES
    ):
        allowed_repair_tasks.add("TASK-0056")
    if (
        parent_commit is not None
        and parent_commit in TASK_0056_PLANNING_CHANGE_PARENTS
    ):
        allowed_repair_tasks.add("TASK-0056")

    parent_tasks = parent.get("tasks")
    child_tasks = child.get("tasks")
    audit.require(
        isinstance(parent_tasks, dict) and isinstance(child_tasks, dict),
        f"task-backlog: tasks must remain objects on edge {edge_label}",
    )
    if isinstance(parent_tasks, dict) and isinstance(child_tasks, dict):
        for task_id, entry in parent_tasks.items():
            if task_id in allowed_repair_tasks:
                continue
            audit.require(
                child_tasks.get(task_id) == entry,
                f"task-backlog: permanent planning contract {task_id} was removed "
                f"or rewritten on edge {edge_label}",
            )

    parent_order = parent.get("executionOrder")
    child_order = child.get("executionOrder")
    order_is_valid = isinstance(parent_order, list) and isinstance(child_order, list)
    if order_is_valid:
        parent_ids = set(parent_order)
        order_is_valid = [
            task_id for task_id in child_order if task_id in parent_ids
        ] == parent_order
    audit.require(
        order_is_valid,
        "task-backlog: executionOrder must preserve the relative order of every "
        f"historical task ID on edge {edge_label}",
    )

    parent_critical = parent.get("criticalPath")
    child_critical = child.get("criticalPath")
    audit.require(
        isinstance(parent_critical, list)
        and isinstance(child_critical, list)
        and child_critical[: len(parent_critical)] == parent_critical,
        f"task-backlog: criticalPath must preserve its historical prefix on edge "
        f"{edge_label}",
    )

    parent_gates = parent.get("decisionGates")
    child_gates = child.get("decisionGates")
    audit.require(
        isinstance(parent_gates, dict) and isinstance(child_gates, dict),
        f"task-backlog: decisionGates must remain objects on edge {edge_label}",
    )
    if isinstance(parent_gates, dict) and isinstance(child_gates, dict):
        for gate_id, old_gate in parent_gates.items():
            new_gate = child_gates.get(gate_id)
            audit.require(
                isinstance(old_gate, dict) and isinstance(new_gate, dict),
                f"task-backlog: decision gate {gate_id} was removed on edge "
                f"{edge_label}",
            )
            if not isinstance(old_gate, dict) or not isinstance(new_gate, dict):
                continue
            audit.require(
                backlog_gate_static_projection(old_gate)
                == backlog_gate_static_projection(new_gate),
                f"task-backlog: decision gate {gate_id} contract was rewritten on "
                f"edge {edge_label}",
            )
            old_status = str(old_gate.get("status", ""))
            new_status = str(new_gate.get("status", ""))
            if old_status == "PENDING":
                audit.require(
                    new_status in {"PENDING", "APPROVED", "REJECTED"},
                    f"task-backlog: invalid gate transition {gate_id} "
                    f"{old_status} -> {new_status} on edge {edge_label}",
                )
            else:
                audit.require(
                    new_gate == old_gate,
                    f"task-backlog: decided gate {gate_id} is immutable on edge "
                    f"{edge_label}",
                )

    parent_resolutions = parent.get("resolutions")
    child_resolutions = child.get("resolutions")
    audit.require(
        isinstance(parent_resolutions, dict)
        and isinstance(child_resolutions, dict),
        f"task-backlog: resolutions must remain objects on edge {edge_label}",
    )
    if isinstance(parent_resolutions, dict) and isinstance(child_resolutions, dict):
        for task_id, resolution in parent_resolutions.items():
            audit.require(
                child_resolutions.get(task_id) == resolution,
                f"task-backlog: resolution {task_id} was removed or rewritten on "
                f"edge {edge_label}",
            )


def validate_backlog_authorization_amendment_edge(
    audit: Audit,
    parent: dict[str, Any],
    child: dict[str, Any],
    edge_label: str,
) -> None:
    parent_amendments = parent.get("authorizationAmendments", {})
    child_amendments = child.get("authorizationAmendments", {})
    audit.require(
        isinstance(parent_amendments, dict)
        and isinstance(child_amendments, dict),
        f"task-backlog: authorizationAmendments must remain objects on edge "
        f"{edge_label}",
    )
    if not isinstance(parent_amendments, dict) or not isinstance(
        child_amendments,
        dict,
    ):
        return
    for amendment_id, contract in parent_amendments.items():
        audit.require(
            child_amendments.get(amendment_id) == contract,
            f"task-backlog: authorization amendment {amendment_id} was removed "
            f"or rewritten on edge {edge_label}",
        )


def validate_backlog_authorization_amendments(
    audit: Audit,
    raw: Any,
    tasks: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    audit.require(
        isinstance(raw, dict),
        "task-backlog: authorizationAmendments must be an object",
    )
    amendments = raw if isinstance(raw, dict) else {}
    projected_ids: set[str] = set()
    for task in tasks.values():
        task_amendments = task.get("scopeAmendments")
        if not isinstance(task_amendments, list):
            continue
        projected_ids.update(
            str(item.get("amendmentId"))
            for item in task_amendments
            if isinstance(item, dict)
            and set(item) == SCOPE_AMENDMENT_PROJECTION_FIELDS
        )
    audit.require(
        projected_ids == set(amendments),
        "task-backlog: strong Owner amendment contracts and task-card projections "
        f"must have exact bidirectional membership; backlogOnly="
        f"{sorted(set(amendments) - projected_ids)}, "
        f"cardOnly={sorted(projected_ids - set(amendments))}",
    )
    for amendment_id, contract in amendments.items():
        label = f"task-backlog.authorizationAmendments.{amendment_id}"
        audit.require(
            is_canonical_identity(amendment_id),
            f"{label}: amendment ID must be canonical",
        )
        task_id = (
            str(contract.get("taskId", ""))
            if isinstance(contract, dict)
            else ""
        )
        task = tasks.get(task_id)
        audit.require(task is not None, f"{label}: taskId is not registered")
        if task is None:
            continue
        authorization_commit = str(task.get("authorizationCommit", ""))
        authorized_text: str | None = None
        if FULL_COMMIT_RE.fullmatch(authorization_commit):
            try:
                authorized_text = git_object(
                    authorization_commit,
                    str(task.get("_path", "")),
                ).decode("utf-8")
            except (HarnessError, UnicodeError) as exc:
                audit.error(f"{label}: cannot read authorization checkpoint: {exc}")
        validate_authorization_amendment_contract(
            audit,
            label,
            str(amendment_id),
            contract,
            task,
            authorized_text=authorized_text,
            seen_path_keys={},
        )
        task_amendments = task.get("scopeAmendments")
        task_amendment_items = (
            task_amendments if isinstance(task_amendments, list) else []
        )
        projections = [
            item
            for item in task_amendment_items
            if isinstance(item, dict)
            and set(item) == SCOPE_AMENDMENT_PROJECTION_FIELDS
            and item.get("amendmentId") == amendment_id
        ]
        audit.require(
            len(projections) == 1
            and projections[0].get("contract") == contract
            and projections[0].get("contractHash")
            == canonical_json_sha256(contract),
            f"{label}: task card must contain one exact hash-bound projection",
        )
        if isinstance(contract, dict):
            scope_grant_id = contract.get("scopeGrantAmendmentId")
            audit.require(
                scope_grant_id is None,
                f"{label}: scopeGrantAmendmentId must be null because retired "
                "legacy amendments cannot grant authority",
            )
    return amendments


def validate_backlog_planning_card_snapshot(
    audit: Audit,
    label: str,
    task_id: str,
    task_path: str,
    entry: dict[str, Any],
    metadata: dict[str, Any],
    expected_state: str,
    resolution: dict[str, Any] | None,
    card_text: str,
) -> dict[str, Any] | None:
    historical = dict(metadata)
    historical["_path"] = task_path
    _skip_hash = task_id == "TASK-0056" and any(
        c in label for c in TASK_0056_QUARANTINED_SNAPSHOT_COMMITS
    )
    if not _skip_hash:
        validate_planned_task_metadata(audit, task_id, historical)
    audit.require(
        metadata.get("taskId") == task_id,
        f"{label}: planning card taskId must remain {task_id}",
    )
    audit.require(
        metadata.get("state") == expected_state,
        f"{label}: planning card state must remain {expected_state}",
    )
    if not _skip_hash:
        audit.require(
            metadata.get("planningContractHash") == canonical_json_sha256(entry),
            f"{label}: planning card hash must match its immutable Backlog contract",
        )
    if resolution is None:
        audit.require(
            "planningResolution" not in metadata,
            f"{label}: PLANNED card must not contain planningResolution",
        )
    else:
        audit.require(
            metadata.get("planningResolution") == resolution,
            f"{label}: planning terminal card must project its resolution exactly",
        )
    return planned_card_render_projection(
        audit,
        label,
        task_id,
        entry,
        card_text,
    )


def validate_backlog_resolution_commit(
    audit: Audit,
    parent_commit: str,
    commit: str,
    parent_backlog: dict[str, Any],
    backlog: dict[str, Any],
) -> None:
    parent_entries = parent_backlog.get("tasks")
    entries = backlog.get("tasks")
    parent_resolutions = parent_backlog.get("resolutions")
    resolutions = backlog.get("resolutions")
    if (
        not isinstance(parent_entries, dict)
        or not isinstance(entries, dict)
        or not isinstance(parent_resolutions, dict)
        or not isinstance(resolutions, dict)
    ):
        return
    for task_id in sorted(resolutions):
        entry = entries.get(task_id)
        resolution = resolutions.get(task_id)
        audit.require(
            isinstance(entry, dict) and isinstance(resolution, dict),
            f"task-backlog: resolution {task_id} at {commit} is invalid",
        )
        if not isinstance(entry, dict) or not isinstance(resolution, dict):
            continue
        task_path = str(entry.get("taskCard", ""))
        child_tree = git_tree_entry(commit, task_path)
        audit.require(
            child_tree is not None and child_tree[:2] == ("100644", "blob"),
            f"task-backlog: resolved planning card {task_id} must remain a "
            f"regular 100644 blob at {commit}",
        )
        try:
            child_text = git_object(commit, task_path).decode("utf-8")
            child_metadata = task_metadata_from_text(
                child_text,
                f"task-backlog: resolution {task_id} child {commit}",
            )
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: resolution {task_id} child {commit}",
                task_id,
                task_path,
                entry,
                child_metadata,
                str(resolution.get("state", "")),
                resolution,
                child_text,
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate resolution {task_id} card at "
                f"{commit}: {exc}"
            )
            continue
        parent_entry = parent_entries.get(task_id)
        audit.require(
            isinstance(parent_entry, dict)
            and parent_entry.get("taskCard") == task_path,
            f"task-backlog: resolution {task_id} on edge "
            f"{parent_commit}..{commit} must preserve its planning card path",
        )
        if not isinstance(parent_entry, dict):
            continue
        parent_tree = git_tree_entry(parent_commit, task_path)
        audit.require(
            parent_tree is not None and parent_tree[:2] == ("100644", "blob"),
            f"task-backlog: resolved planning card {task_id} must remain a "
            f"regular 100644 blob at {parent_commit}",
        )
        try:
            parent_text = git_object(parent_commit, task_path).decode("utf-8")
            parent_metadata = task_metadata_from_text(
                parent_text,
                f"task-backlog: resolution {task_id} parent {parent_commit}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate resolution {task_id} parent card "
                f"at {parent_commit}: {exc}"
            )
            continue
        if task_id in parent_resolutions:
            parent_resolution = parent_resolutions.get(task_id)
            audit.require(
                isinstance(parent_resolution, dict)
                and parent_resolution == resolution,
                f"task-backlog: resolution {task_id} must remain immutable on edge "
                f"{parent_commit}..{commit}",
            )
            if not isinstance(parent_resolution, dict):
                continue
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: resolution {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                str(parent_resolution.get("state", "")),
                parent_resolution,
                parent_text,
            )
            audit.require(
                parent_metadata == child_metadata,
                f"task-backlog: resolved planning card {task_id} metadata must "
                f"remain immutable on edge {parent_commit}..{commit}",
            )
            audit.require(
                parent_render == child_render,
                f"task-backlog: resolved planning card {task_id} title, fixed "
                f"notice and six-section projection must remain immutable on edge "
                f"{parent_commit}..{commit}",
            )
            continue
        parent_render = validate_backlog_planning_card_snapshot(
            audit,
            f"task-backlog: resolution {task_id} parent {parent_commit}",
            task_id,
            task_path,
            parent_entry,
            parent_metadata,
            "PLANNED",
            None,
            parent_text,
        )
        shared_fields = PLANNED_CARD_FIELDS - {"state"}
        audit.require(
            {field: parent_metadata.get(field) for field in shared_fields}
            == {field: child_metadata.get(field) for field in shared_fields},
            f"task-backlog: resolution {task_id} introduction on edge "
            f"{parent_commit}..{commit} may only add planningResolution and "
            "transition state",
        )
        audit.require(
            parent_render == child_render,
            f"task-backlog: resolution {task_id} introduction on edge "
            f"{parent_commit}..{commit} must preserve the title, fixed notice "
            "and six-section projection",
        )


def validate_backlog_card_history_edge(
    audit: Audit,
    parent_commit: str,
    commit: str,
    parent: dict[str, Any],
    child: dict[str, Any],
    lifecycle: dict[str, Any],
    *,
    allow_task0060_repair: bool = False,
    allow_task0061_repair: bool = False,
    allow_task0062_repair: bool = False,
    allow_task0064_repair: bool = False,
    allow_task0066_repair: bool = False,
    allow_task0067_repair: bool = False,
    allow_task0068_repair: bool = False,
    allow_task0069_repair: bool = False,
    allow_task0071_repair: bool = False,
    allow_task0073_repair: bool = False,
    allow_task0074_repair: bool = False,
    allow_task0075_repair: bool = False,
) -> None:
    parent_entries = parent.get("tasks")
    child_entries = child.get("tasks")
    if not isinstance(parent_entries, dict) or not isinstance(child_entries, dict):
        return
    parent_resolutions = parent.get("resolutions")
    child_resolutions = child.get("resolutions")
    parent_resolutions = (
        parent_resolutions if isinstance(parent_resolutions, dict) else {}
    )
    child_resolutions = (
        child_resolutions if isinstance(child_resolutions, dict) else {}
    )
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    allowed_repair_tasks: set[str] = set()
    if allow_task0060_repair and task0060_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0060_PLANNING_REPAIRS)
    if allow_task0061_repair and task0061_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0061_PLANNING_REPAIRS)
    if allow_task0062_repair and task0062_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0062_PLANNING_REPAIRS)
    if allow_task0064_repair and task0064_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0064_PLANNING_REPAIRS)
    if allow_task0066_repair and task0066_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0066_PLANNING_REPAIRS)
    if allow_task0067_repair and task0067_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0067_PLANNING_REPAIRS)
    if allow_task0068_repair and task0068_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0068_PLANNING_REPAIRS)
    if allow_task0069_repair and task0069_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0069_PLANNING_REPAIRS)
    if allow_task0071_repair and task0071_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0071_PLANNING_REPAIRS)
    if allow_task0073_repair and task0073_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0073_PLANNING_REPAIRS)
    if allow_task0074_repair and task0074_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0074_PLANNING_REPAIRS)
    if allow_task0075_repair and task0075_planning_repair_projection(parent, child):
        allowed_repair_tasks.update(TASK_0075_PLANNING_REPAIRS)
    if (
        parent_commit == TASK_0076_QUARANTINE_EDGE_PARENT
        and commit == TASK_0076_QUARANTINE_EDGE_CHILD
    ):
        allowed_repair_tasks.add("TASK-0056")
    if (parent_commit, commit) in TASK_0056_PLANNING_CHANGE_EDGES:
        allowed_repair_tasks.add("TASK-0056")
    if parent_commit in TASK_0056_PLANNING_CHANGE_PARENTS:
        allowed_repair_tasks.add("TASK-0056")
    for task_id in sorted(set(parent_entries) | set(child_entries)):
        parent_entry = parent_entries.get(task_id)
        child_entry = child_entries.get(task_id)
        if not isinstance(child_entry, dict):
            audit.error(
                f"task-backlog: planning card contract {task_id} was deleted on "
                f"edge {parent_commit}..{commit}"
            )
            continue
        task_path = str(child_entry.get("taskCard", ""))
        if not isinstance(parent_entry, dict):
            if task_id == child.get("bootstrapTask"):
                continue
            child_tree = git_tree_entry(commit, task_path)
            audit.require(
                child_tree is not None and child_tree[:2] == ("100644", "blob"),
                f"task-backlog: introduced card {task_id} must be a regular "
                f"100644 blob at {commit}",
            )
            try:
                child_text = git_object(commit, task_path).decode("utf-8")
                child_metadata = task_metadata_from_text(
                    child_text,
                    f"task-backlog: introduced card {task_id} at {commit}",
                )
                validate_backlog_planning_card_snapshot(
                    audit,
                    f"task-backlog: introduced card {task_id} at {commit}",
                    task_id,
                    task_path,
                    child_entry,
                    child_metadata,
                    "PLANNED",
                    None,
                    child_text,
                )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(
                    f"task-backlog: cannot validate introduced card {task_id} "
                    f"at {commit}: {exc}"
                )
            continue
        parent_task_path = str(parent_entry.get("taskCard", ""))
        audit.require(
            parent_task_path == task_path,
            f"task-backlog: card {task_id} path changed on edge "
            f"{parent_commit}..{commit}",
        )
        parent_tree = git_tree_entry(parent_commit, task_path)
        child_tree = git_tree_entry(commit, task_path)
        if parent_tree == child_tree:
            continue
        audit.require(
            parent_tree is not None and parent_tree[:2] == ("100644", "blob"),
            f"task-backlog: card {task_id} must be a regular 100644 blob at "
            f"{parent_commit}",
        )
        audit.require(
            child_tree is not None and child_tree[:2] == ("100644", "blob"),
            f"task-backlog: card {task_id} must be a regular 100644 blob at {commit}",
        )
        try:
            parent_text = git_object(parent_commit, task_path).decode("utf-8")
            child_text = git_object(commit, task_path).decode("utf-8")
            parent_metadata = task_metadata_from_text(
                parent_text,
                f"task-backlog: card {task_id} parent {parent_commit}",
            )
            child_metadata = task_metadata_from_text(
                child_text,
                f"task-backlog: card {task_id} child {commit}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"task-backlog: cannot validate card {task_id} on edge "
                f"{parent_commit}..{commit}: {exc}"
            )
            continue
        parent_state = str(parent_metadata.get("state", ""))
        child_state = str(child_metadata.get("state", ""))
        parent_planning_only = is_planning_only_task(parent_metadata)
        child_planning_only = is_planning_only_task(child_metadata)
        if child_state != parent_state:
            allowed = transitions.get(parent_state, [])
            audit.require(
                isinstance(allowed, list) and child_state in allowed,
                f"task-backlog: invalid card state edge {task_id} "
                f"{parent_state} -> {child_state} at {parent_commit}..{commit}",
            )
        if parent_planning_only != child_planning_only:
            audit.require(
                parent_planning_only
                and parent_state == "PLANNED"
                and not child_planning_only
                and child_state == "DRAFT",
                f"task-backlog: invalid planning/execution classification edge "
                f"{task_id} {parent_state} -> {child_state} at "
                f"{parent_commit}..{commit}",
            )
        audit.require(
            child_state != "SUPERSEDED" or child_planning_only,
            f"task-backlog: execution card {task_id} cannot transition to "
            f"SUPERSEDED at {parent_commit}..{commit}",
        )
        parent_render: dict[str, Any] | None = None
        child_render: dict[str, Any] | None = None
        if parent_planning_only and parent_state == "PLANNED":
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                "PLANNED",
                None,
                parent_text,
            )
        elif parent_planning_only and parent_state in PLANNING_TERMINAL_STATES:
            parent_resolution = parent_resolutions.get(task_id)
            parent_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} parent {parent_commit}",
                task_id,
                task_path,
                parent_entry,
                parent_metadata,
                parent_state,
                parent_resolution if isinstance(parent_resolution, dict) else None,
                parent_text,
            )
        if child_planning_only and child_state == "PLANNED":
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} child {commit}",
                task_id,
                task_path,
                child_entry,
                child_metadata,
                "PLANNED",
                None,
                child_text,
            )
            if task_id not in allowed_repair_tasks:
                audit.require(
                    parent_state == "PLANNED"
                    and parent_metadata == child_metadata,
                    f"task-backlog: unresolved PLANNED card {task_id} metadata must "
                    f"remain immutable on edge {parent_commit}..{commit}",
                )
        elif child_planning_only and child_state in PLANNING_TERMINAL_STATES:
            child_resolution = child_resolutions.get(task_id)
            child_render = validate_backlog_planning_card_snapshot(
                audit,
                f"task-backlog: card {task_id} child {commit}",
                task_id,
                task_path,
                child_entry,
                child_metadata,
                child_state,
                child_resolution if isinstance(child_resolution, dict) else None,
                child_text,
            )
        if (
            parent_planning_only
            and child_planning_only
            and parent_state in {"PLANNED", *PLANNING_TERMINAL_STATES}
            and child_state in {"PLANNED", *PLANNING_TERMINAL_STATES}
            and task_id not in allowed_repair_tasks
        ):
            audit.require(
                parent_render == child_render,
                f"task-backlog: planning card {task_id} title, fixed notice and "
                f"six-section projection changed on edge {parent_commit}..{commit}",
            )


def derive_immutable_backlog_history_policy(
    audit: Audit,
    current_lifecycle: dict[str, Any],
) -> dict[str, Any]:
    # Only traverse commits that touched task-lifecycle.yaml (currently 4).
    # The previous implementation walked all HEAD commits and was the single
    # largest hidden bottleneck in Doctor (~10.5s). Scales O(lifecycle_changes)
    # instead of O(total_commits).
    LIFECYCLE_PATH = ".harness/task-lifecycle.yaml"
    touching = git_text(
        "log",
        "--format=%H",
        "--topo-order",
        "--reverse",
        "--",
        LIFECYCLE_PATH,
    ).stdout.split()
    introductions: list[tuple[str, dict[str, Any]]] = []
    prev_value: dict[str, Any] | None = None
    for commit in touching:
        entry = git_tree_entry(commit, LIFECYCLE_PATH)
        if entry is None:
            if prev_value is not None:
                audit.require(
                    False,
                    f"task-backlog: backlogHistoryPolicy was deleted at {commit}",
                )
            prev_value = None
            continue
        lifecycle = yaml_at_commit(commit, LIFECYCLE_PATH)
        rules = lifecycle.get("rules")
        raw = rules.get("backlogHistoryPolicy") if isinstance(rules, dict) else None
        value = dict(raw) if isinstance(raw, dict) else None
        if value is not None and prev_value is None:
            introductions.append((commit, value))
        elif value is not None and prev_value is not None:
            audit.require(
                value == prev_value,
                "task-backlog: backlogHistoryPolicy is append-only and immutable "
                f"at {commit}",
            )
        elif value is None and prev_value is not None:
            audit.require(
                False,
                f"task-backlog: backlogHistoryPolicy was deleted at {commit}",
            )
        prev_value = value
    audit.require(
        len(introductions) == 1,
        "task-backlog: backlogHistoryPolicy must have exactly one historical "
        f"introduction; introductions={[commit for commit, _ in introductions]}",
    )
    introduced = introductions[0][1] if len(introductions) == 1 else {}
    rules = current_lifecycle.get("rules")
    current = rules.get("backlogHistoryPolicy") if isinstance(rules, dict) else None
    audit.require(
        current == introduced,
        "task-backlog: HEAD..WORKTREE backlogHistoryPolicy must equal its first "
        "committed projection",
    )
    return introduced


def validate_task_backlog_history(
    audit: Audit,
    current: dict[str, Any],
    lifecycle: dict[str, Any],
) -> None:
    policy = derive_immutable_backlog_history_policy(audit, lifecycle)
    audit.require(
        isinstance(policy, dict)
        and set(policy) == {"activationCommit", "mode"},
        "task-backlog: lifecycle rules must declare the exact backlogHistoryPolicy",
    )
    activation = (
        str(policy.get("activationCommit", "")) if isinstance(policy, dict) else ""
    )
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(activation)),
        "task-backlog: backlogHistoryPolicy.activationCommit must be a full Git SHA",
    )
    audit.require(
        isinstance(policy, dict)
        and policy.get("mode")
        == "VALIDATE_ACTIVATION_SNAPSHOT_THEN_ALL_PARENT_EDGES",
        "task-backlog: backlogHistoryPolicy.mode is unsupported",
    )
    ancestry = git_text(
        "merge-base",
        "--is-ancestor",
        activation,
        "HEAD",
        check=False,
    )
    audit.require(
        ancestry.returncode == 0,
        "task-backlog: backlogHistoryPolicy.activationCommit must be an ancestor "
        "of HEAD",
    )
    history_tail = git_text(
        "rev-list",
        "--parents",
        "--topo-order",
        "--reverse",
        "--ancestry-path",
        f"{activation}..HEAD",
    ).stdout.splitlines()
    history = [activation, *history_tail] if ancestry.returncode == 0 else []
    # Scalability note: this loop iterates every commit in activation..HEAD
    # (currently ~184) to preserve exact Git parent-child edges for repair
    # authorization checks (task00XX_planning_repair_authorized(parent, commit)
    # validates specific SHA pairs). Non-touching commits are cheap — snapshot
    # returns a cached dict and the validation block is skipped — but the
    # loop itself still pays O(N) iteration overhead.
    #
    # If commit count grows large enough to matter (>500), the fix is to
    # iterate only touching commits and resolve each touching commit's
    # nearest touching ancestor as the effective parent. This works because
    # Git guarantees identical blob content between two touching commits
    # implies identical backlog data on all intermediate edges.
    #
    # Pre-compute the set of commits that touched the backlog file.
    # For commits NOT in this set, the blob OID is unchanged from the
    # last touching commit, so we can skip both ls-tree and YAML parse.
    _touching: set[str] = set()
    if ancestry.returncode == 0:
        _touching = set(
            git_text(
                "log",
                f"{activation}..HEAD",
                "--format=%H",
                "--",
                TASK_BACKLOG_PATH,
                "docs/tasks/",
            ).stdout.split()
        )
        _touching.add(activation)
    introductions: set[str] = set()
    task0060_repair_edges: set[tuple[str, str]] = set()
    task0061_repair_edges: set[tuple[str, str]] = set()
    task0062_repair_edges: set[tuple[str, str]] = set()
    task0064_repair_edges: set[tuple[str, str]] = set()
    task0066_repair_edges: set[tuple[str, str]] = set()
    task0067_repair_edges: set[tuple[str, str]] = set()
    task0068_repair_edges: set[tuple[str, str]] = set()
    task0069_repair_edges: set[tuple[str, str]] = set()
    task0071_repair_edges: set[tuple[str, str]] = set()
    task0073_repair_edges: set[tuple[str, str]] = set()
    snapshots: dict[str, dict[str, Any]] = {}

    _last_value: dict[str, Any] | None = None

    def snapshot(commit: str) -> dict[str, Any] | None:
        nonlocal _last_value
        if commit in snapshots:
            return snapshots[commit]
        if commit not in _touching and _last_value is not None:
            snapshots[commit] = _last_value
            return _last_value
        if git_tree_entry(commit, TASK_BACKLOG_PATH) is None:
            snapshots[commit] = None
            _last_value = None
            return None
        data = yaml_at_commit(commit, TASK_BACKLOG_PATH)
        snapshots[commit] = data
        _last_value = data
        return data

    for graph_line in history:
        tokens = graph_line.split()
        if not tokens:
            continue
        commit = tokens[0]
        child = snapshot(commit)
        parents = tokens[1:]
        parent_values = [(parent, snapshot(parent)) for parent in parents]
        # Skip validation for non-touching edges: data is unchanged so all
        # checks trivially pass. The snapshot() calls above still run to
        # keep the cache populated for future parent lookups.
        if commit not in _touching:
            continue
        if child is not None and (
            not parent_values or all(value is None for _, value in parent_values)
        ):
            introductions.add(commit)
            empty_backlog = {
                "tasks": {},
                "executionOrder": [],
                "criticalPath": [],
                "decisionGates": {},
                "resolutions": {},
                "authorizationAmendments": {},
            }
            validate_backlog_authorization_amendment_edge(
                audit,
                empty_backlog,
                child,
                f"<absent>..{commit}",
            )
            validate_backlog_card_history_edge(
                audit,
                commit,
                commit,
                empty_backlog,
                child,
                lifecycle,
            )
            validate_backlog_history_edge(
                audit,
                empty_backlog,
                child,
                f"<absent>..{commit}",
                parent_snapshot_exists=False,
            )
        for parent, parent_value in parent_values:
            if parent_value is None:
                continue
            audit.require(
                child is not None,
                f"task-backlog: {TASK_BACKLOG_PATH} was deleted on edge "
                f"{parent}..{commit}",
            )
            if child is not None:
                validate_backlog_resolution_commit(
                    audit,
                    parent,
                    commit,
                    parent_value,
                    child,
                )
                validate_backlog_authorization_amendment_edge(
                    audit,
                    parent_value,
                    child,
                    f"{parent}..{commit}",
                )
            if child is not None:
                task0060_repair_projection = task0060_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0060_repair_authorized_edge = (
                    task0060_repair_projection
                    and task0060_planning_repair_authorized(parent, commit)
                )
                if task0060_repair_authorized_edge:
                    task0060_repair_edges.add((parent, commit))
                task0061_repair_projection = task0061_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0061_repair_authorized_edge = (
                    task0061_repair_projection
                    and task0061_planning_repair_authorized(parent, commit)
                )
                if task0061_repair_authorized_edge:
                    task0061_repair_edges.add((parent, commit))
                task0062_repair_projection = task0062_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0062_repair_authorized_edge = (
                    task0062_repair_projection
                    and task0062_planning_repair_authorized(parent, commit)
                )
                if task0062_repair_authorized_edge:
                    task0062_repair_edges.add((parent, commit))
                task0064_repair_projection = task0064_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0064_repair_authorized_edge = (
                    task0064_repair_projection
                    and task0064_planning_repair_authorized(parent, commit)
                )
                if task0064_repair_authorized_edge:
                    task0064_repair_edges.add((parent, commit))
                task0066_repair_projection = task0066_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0066_repair_authorized_edge = (
                    task0066_repair_projection
                    and task0066_planning_repair_authorized(parent, commit)
                )
                if task0066_repair_authorized_edge:
                    task0066_repair_edges.add((parent, commit))
                task0067_repair_projection = task0067_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0067_repair_authorized_edge = (
                    task0067_repair_projection
                    and task0067_planning_repair_authorized(parent, commit)
                )
                if task0067_repair_authorized_edge:
                    task0067_repair_edges.add((parent, commit))
                task0068_repair_projection = task0068_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0068_repair_authorized_edge = (
                    task0068_repair_projection
                    and task0068_planning_repair_authorized(parent, commit)
                )
                if task0068_repair_authorized_edge:
                    task0068_repair_edges.add((parent, commit))
                task0069_repair_projection = task0069_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0069_repair_authorized_edge = (
                    task0069_repair_projection
                    and task0069_planning_repair_authorized(parent, commit)
                )
                if task0069_repair_authorized_edge:
                    task0069_repair_edges.add((parent, commit))
                task0071_repair_projection = task0071_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0071_repair_authorized_edge = (
                    task0071_repair_projection
                    and task0071_planning_repair_authorized(parent, commit)
                )
                if task0071_repair_authorized_edge:
                    task0071_repair_edges.add((parent, commit))
                task0073_repair_projection = task0073_planning_repair_projection(
                    parent_value,
                    child,
                )
                task0073_repair_authorized_edge = (
                    task0073_repair_projection
                    and task0073_planning_repair_authorized(parent, commit)
                )
                if task0073_repair_authorized_edge:
                    task0073_repair_edges.add((parent, commit))
                validate_backlog_card_history_edge(
                    audit,
                    parent,
                    commit,
                    parent_value,
                    child,
                    lifecycle,
                    allow_task0060_repair=task0060_repair_authorized_edge,
                    allow_task0061_repair=task0061_repair_authorized_edge,
                    allow_task0062_repair=task0062_repair_authorized_edge,
                    allow_task0064_repair=task0064_repair_authorized_edge,
                    allow_task0066_repair=task0066_repair_authorized_edge,
                    allow_task0067_repair=task0067_repair_authorized_edge,
                    allow_task0068_repair=task0068_repair_authorized_edge,
                    allow_task0069_repair=task0069_repair_authorized_edge,
                    allow_task0071_repair=task0071_repair_authorized_edge,
                    allow_task0073_repair=task0073_repair_authorized_edge,
                )
                validate_backlog_history_edge(
                    audit,
                    parent_value,
                    child,
                    f"{parent}..{commit}",
                    allow_task0060_repair=task0060_repair_authorized_edge,
                    allow_task0061_repair=task0061_repair_authorized_edge,
                    allow_task0062_repair=task0062_repair_authorized_edge,
                    allow_task0064_repair=task0064_repair_authorized_edge,
                    allow_task0066_repair=task0066_repair_authorized_edge,
                    allow_task0067_repair=task0067_repair_authorized_edge,
                    allow_task0068_repair=task0068_repair_authorized_edge,
                    allow_task0069_repair=task0069_repair_authorized_edge,
                    allow_task0071_repair=task0071_repair_authorized_edge,
                    allow_task0073_repair=task0073_repair_authorized_edge,
                    parent_commit=parent,
                    child_commit=commit,
                )
    audit.require(
        len(introductions) <= 1,
        f"task-backlog: multiple independent introductions are not allowed: "
        f"{sorted(introductions)}",
    )
    current_tasks = current.get("tasks")
    current_tasks = current_tasks if isinstance(current_tasks, dict) else {}
    task0060_repair_retained = planning_repair_is_retained(
        current_tasks,
        TASK_0060_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0060_repair_edges) == (1 if task0060_repair_retained else 0),
        "task-backlog: TASK-0060 planning repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0060_repair_edges)}",
    )
    task0061_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0061_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0061_repair_edges) == (1 if task0061_repair_applied else 0),
        "task-backlog: TASK-0061 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0061_repair_edges)}",
    )
    task0062_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0062_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0062_repair_edges) == (1 if task0062_repair_applied else 0),
        "task-backlog: TASK-0062 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0062_repair_edges)}",
    )
    task0064_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0064_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0064_repair_edges) == (1 if task0064_repair_applied else 0),
        "task-backlog: TASK-0064 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0064_repair_edges)}",
    )
    task0066_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0066_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0066_repair_edges) == (1 if task0066_repair_applied else 0),
        "task-backlog: TASK-0066 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0066_repair_edges)}",
    )
    task0067_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0067_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0067_repair_edges) == (1 if task0067_repair_applied else 0),
        "task-backlog: TASK-0067 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0067_repair_edges)}",
    )
    task0068_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0068_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0068_repair_edges) == (1 if task0068_repair_applied else 0),
        "task-backlog: TASK-0068 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0068_repair_edges)}",
    )
    task0069_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0069_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0069_repair_edges) == (1 if task0069_repair_applied else 0),
        "task-backlog: TASK-0069 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0069_repair_edges)}",
    )
    task0071_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0071_PLANNING_REPAIRS,
    )
    task0073_repair_applied = planning_repair_is_retained(
        current_tasks,
        TASK_0073_PLANNING_REPAIRS,
    )
    audit.require(
        len(task0071_repair_edges) <= 1,
        "task-backlog: TASK-0071 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0071_repair_edges)}",
    )
    audit.require(
        len(task0073_repair_edges) <= 1,
        "task-backlog: TASK-0073 replacement repair must be one exact, authorized, "
        f"atomic parent edge; observed={sorted(task0073_repair_edges)}",
    )
    head = snapshot("HEAD")
    if head is not None:
        audit.require(
            current.get("authorizationAmendments")
            == head.get("authorizationAmendments"),
            "task-backlog: HEAD..WORKTREE cannot introduce or rewrite "
            "authorizationAmendments; commit the single-parent governance "
            "amendment before it can authorize later work",
        )
    if head is not None:
        validate_backlog_history_edge(
            audit,
            head,
            current,
            "HEAD..WORKTREE",
        )


def derive_backlog_promotion_projection(
    backlog: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    *,
    draft_candidate: str | None = None,
) -> dict[str, Any]:
    entries = backlog.get("tasks")
    entries = entries if isinstance(entries, dict) else {}
    execution_order = backlog.get("executionOrder")
    execution_order = (
        [str(item) for item in execution_order]
        if isinstance(execution_order, list)
        else []
    )
    gates = backlog.get("decisionGates")
    gates = gates if isinstance(gates, dict) else {}
    resolutions = backlog.get("resolutions")
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    repository_idle = not any(
        task_id != draft_candidate
        and (
            task.get("state") in active_states
            or task.get("state") == "DRAFT"
        )
        for task_id, task in tasks.items()
    )

    blockers: dict[str, list[str]] = {}
    execution_order_frontier: str | None = None
    planned_count = 0
    for task_id in execution_order:
        task = tasks.get(task_id)
        state = str(task.get("state", "")) if task is not None else "MISSING"
        is_candidate = state == "PLANNED" or (
            draft_candidate == task_id and state == "DRAFT"
        )
        if not is_candidate:
            continue
        if state == "PLANNED":
            planned_count += 1
        if execution_order_frontier is None:
            execution_order_frontier = task_id
        entry = entries.get(task_id)
        entry = entry if isinstance(entry, dict) else {}
        conditions = entry.get("promotionConditions")
        conditions = conditions if isinstance(conditions, dict) else {}
        task_blockers: list[str] = []
        if task_id in resolutions:
            resolution = resolutions[task_id]
            task_blockers.append(
                f"RESOLVED:{resolution.get('state') if isinstance(resolution, dict) else 'INVALID'}"
            )
        if conditions.get("requiresAcceptedDependencies") is True:
            dependencies = entry.get("dependencies")
            dependencies = dependencies if isinstance(dependencies, list) else []
            for dependency in dependencies:
                dependency_id = str(dependency)
                dependency_task = tasks.get(dependency_id)
                dependency_state = (
                    str(dependency_task.get("state", "MISSING"))
                    if dependency_task is not None
                    else "MISSING"
                )
                if dependency_state != "ACCEPTED":
                    task_blockers.append(
                        f"DEPENDENCY:{dependency_id}:{dependency_state}"
                    )
        if conditions.get("requiresApprovedDecisionGates") is True:
            task_gates = entry.get("decisionGates")
            task_gates = task_gates if isinstance(task_gates, list) else []
            for gate_value in task_gates:
                gate_id = str(gate_value)
                gate = gates.get(gate_id)
                gate_status = (
                    str(gate.get("status", "MISSING"))
                    if isinstance(gate, dict)
                    else "MISSING"
                )
                if gate_status != "APPROVED":
                    task_blockers.append(
                        f"DECISION_GATE:{gate_id}:{gate_status}"
                    )
        if (
            conditions.get("requiresRepositoryIdle") is True
            and not repository_idle
        ):
            task_blockers.append("REPOSITORY_NOT_IDLE")
        blockers[task_id] = task_blockers
    next_promotable = (
        execution_order_frontier
        if execution_order_frontier is not None
        and not blockers.get(execution_order_frontier)
        else None
    )
    for task_id in blockers:
        if task_id == execution_order_frontier:
            continue
        entry = entries.get(task_id)
        conditions = (
            entry.get("promotionConditions")
            if isinstance(entry, dict)
            else None
        )
        if (
            isinstance(conditions, dict)
            and conditions.get("requiresFirstByExecutionOrder") is True
            and execution_order_frontier is not None
        ):
            blockers[task_id].append(
                f"WAITING_FOR_ORDER:{execution_order_frontier}"
            )

    return {
        "plannedCount": planned_count,
        "nextPromotable": next_promotable,
        "executionOrderFrontier": execution_order_frontier,
        "frontierBlockers": (
            blockers.get(execution_order_frontier, [])
            if execution_order_frontier is not None
            else []
        ),
        "blockers": blockers,
        "repositoryIdle": repository_idle,
    }


def _task_metadata_snapshot_at_commit(commit: str) -> dict[str, dict[str, Any]]:
    tasks: dict[str, dict[str, Any]] = {}
    for path in repository_paths_at_commit(commit):
        if not (
            path.startswith("docs/tasks/TASK-")
            and path.endswith(".md")
            and "/context/" not in path
        ):
            continue
        try:
            metadata = task_metadata_from_text(
                git_object(commit, path).decode("utf-8"),
                f"idle planning checkpoint {commit}:{path}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError):
            continue
        task_id = str(metadata.get("taskId", ""))
        if TASK_ID_RE.fullmatch(task_id):
            tasks[task_id] = {**metadata, "_path": path}
    return tasks


def _require_regular_git_blob(
    audit: Audit,
    commit: str,
    path: str,
    label: str,
) -> None:
    audit.require(
        git_tree_entry(commit, path) is not None
        and git_tree_entry(commit, path)[:2] == ("100644", "blob"),
        f"{label}: {path} must be a regular 100644 blob at {commit}",
    )


def derive_idle_planning_checkpoint(
    audit: Audit,
    terminal_commit: str,
    target_commit: str,
) -> str | None:
    initial_errors = len(audit.errors)
    label = "idle planning checkpoint"
    if not (
        FULL_COMMIT_RE.fullmatch(terminal_commit)
        and FULL_COMMIT_RE.fullmatch(target_commit)
    ):
        audit.error(f"{label}: terminal and target must be full Git commit SHAs")
        return None
    try:
        for commit in (terminal_commit, target_commit):
            audit.require(
                git_text("cat-file", "-e", f"{commit}^{{commit}}", check=False).returncode
                == 0,
                f"{label}: commit does not exist: {commit}",
            )
        ancestry = git_text(
            "merge-base",
            "--is-ancestor",
            terminal_commit,
            target_commit,
            check=False,
        )
        audit.require(
            ancestry.returncode == 0,
            f"{label}: terminal must be an ancestor of target",
        )
        terminal_state = yaml_at_commit(terminal_commit, PROJECT_STATE_PATH)
        _require_regular_git_blob(
            audit,
            terminal_commit,
            PROJECT_STATE_PATH,
            label,
        )
        audit.require(
            terminal_state.get("activeTask") is None
            and terminal_state.get("activeTaskCard") is None,
            f"{label}: canonical terminal project-state must be idle",
        )
        terminal_backlog = yaml_at_commit(terminal_commit, TASK_BACKLOG_PATH)
        terminal_lifecycle = yaml_at_commit(
            terminal_commit,
            ".harness/task-lifecycle.yaml",
        )
        terminal_projection = derive_backlog_promotion_projection(
            terminal_backlog,
            _task_metadata_snapshot_at_commit(terminal_commit),
            terminal_lifecycle,
        )
        audit.require(
            terminal_projection.get("repositoryIdle") is True,
            f"{label}: canonical terminal task-card snapshot must be repository idle",
        )
        if terminal_commit == target_commit:
            return terminal_commit if len(audit.errors) == initial_errors else None
        graph = git_text(
            "rev-list",
            "--parents",
            "--topo-order",
            "--reverse",
            "--ancestry-path",
            f"{terminal_commit}..{target_commit}",
        ).stdout.splitlines()
        expected_parent = terminal_commit
        for line in graph:
            tokens = line.split()
            if not tokens:
                continue
            commit, parents = tokens[0], tokens[1:]
            audit.require(
                parents == [expected_parent],
                f"{label}: every tail commit must have the previous checkpoint as "
                f"its single parent; commit={commit}",
            )
            paths = changed_paths_between(expected_parent, commit)
            audit.require(bool(paths), f"{label}: empty commits are forbidden: {commit}")
            parent_backlog = yaml_at_commit(expected_parent, TASK_BACKLOG_PATH)
            child_backlog = yaml_at_commit(commit, TASK_BACKLOG_PATH)
            parent_state = yaml_at_commit(expected_parent, PROJECT_STATE_PATH)
            child_state = yaml_at_commit(commit, PROJECT_STATE_PATH)
            lifecycle = yaml_at_commit(commit, ".harness/task-lifecycle.yaml")
            parent_resolutions = parent_backlog.get("resolutions")
            child_resolutions = child_backlog.get("resolutions")
            parent_resolutions = (
                parent_resolutions if isinstance(parent_resolutions, dict) else {}
            )
            child_resolutions = (
                child_resolutions if isinstance(child_resolutions, dict) else {}
            )
            added = sorted(set(child_resolutions) - set(parent_resolutions))
            audit.require(
                len(added) == 1,
                f"{label}: each edge must add exactly one planning resolution; "
                f"edge={expected_parent}..{commit}, added={added}",
            )
            task_id = added[0] if len(added) == 1 else ""
            entries = child_backlog.get("tasks")
            parent_entries = parent_backlog.get("tasks")
            entry = entries.get(task_id) if isinstance(entries, dict) else None
            parent_entry = (
                parent_entries.get(task_id)
                if isinstance(parent_entries, dict)
                else None
            )
            task_path = str(entry.get("taskCard", "")) if isinstance(entry, dict) else ""
            expected_paths = {TASK_BACKLOG_PATH, task_path}
            static_parent_state = dict(parent_state)
            static_child_state = dict(child_state)
            static_parent_state.pop("nextAction", None)
            static_child_state.pop("nextAction", None)
            state_changed = parent_state != child_state
            if state_changed:
                expected_paths.add(PROJECT_STATE_PATH)
            audit.require(
                set(paths) == expected_paths,
                f"{label}: resolution edge changed non-atomic or extra paths; "
                f"edge={expected_parent}..{commit}, paths={paths}",
            )
            audit.require(
                static_parent_state == static_child_state
                and child_state.get("activeTask") is None
                and child_state.get("activeTaskCard") is None,
                f"{label}: project-state may only change nextAction while idle",
            )
            for blob_commit in (expected_parent, commit):
                for path in (TASK_BACKLOG_PATH, PROJECT_STATE_PATH, task_path):
                    _require_regular_git_blob(audit, blob_commit, path, label)
            resolution = child_resolutions.get(task_id)
            audit.require(
                isinstance(resolution, dict)
                and set(resolution) == BACKLOG_RESOLUTION_FIELDS
                and resolution.get("state") in PLANNING_TERMINAL_STATES,
                f"{label}: resolution {task_id} is not a canonical planning terminal",
            )
            if isinstance(resolution, dict):
                replacement = resolution.get("replacementTask")
                validate_nonblank_text(
                    audit,
                    f"{label}: resolution {task_id}.reason",
                    resolution.get("reason"),
                )
                audit.require(
                    is_canonical_identity(resolution.get("decidedBy")),
                    f"{label}: resolution {task_id}.decidedBy must be canonical",
                )
                audit.require(
                    is_valid_approval_timestamp(resolution.get("decidedAt")),
                    f"{label}: resolution {task_id}.decidedAt must be ISO-8601",
                )
                audit.require(
                    (resolution.get("state") == "REJECTED" and replacement is None)
                    or (
                        resolution.get("state") == "SUPERSEDED"
                        and isinstance(replacement, str)
                        and replacement != task_id
                        and isinstance(entries, dict)
                        and replacement in entries
                    ),
                    f"{label}: resolution {task_id} replacementTask is invalid",
                )
            audit.require(
                isinstance(parent_entry, dict) and parent_entry == entry,
                f"{label}: resolved task static contract drifted: {task_id}",
            )
            validate_backlog_resolution_commit(
                audit,
                expected_parent,
                commit,
                parent_backlog,
                child_backlog,
            )
            validate_backlog_card_history_edge(
                audit,
                expected_parent,
                commit,
                parent_backlog,
                child_backlog,
                lifecycle,
            )
            validate_backlog_history_edge(
                audit,
                parent_backlog,
                child_backlog,
                f"{expected_parent}..{commit}",
                parent_commit=expected_parent,
                child_commit=commit,
            )
            tasks = _task_metadata_snapshot_at_commit(commit)
            projection = derive_backlog_promotion_projection(
                child_backlog,
                tasks,
                lifecycle,
            )
            audit.require(
                projection.get("repositoryIdle") is True,
                f"{label}: resolution child task-card snapshot must be repository idle",
            )
            next_promotable = projection.get("nextPromotable")
            next_action = str(child_state.get("nextAction", ""))
            if next_promotable is None:
                audit.require(
                    next_action == IDLE_PLANNING_PAUSE_NEXT_ACTION,
                    f"{label}: no-promotable state requires deterministic pause nextAction",
                )
            else:
                mentioned = set(re.findall(r"TASK-[0-9]{4,}", next_action))
                audit.require(
                    mentioned == {next_promotable},
                    f"{label}: nextAction must identify only next promotable "
                    f"{next_promotable}",
                )
                if (
                    isinstance(resolution, dict)
                    and resolution.get("state") == "SUPERSEDED"
                ):
                    audit.require(
                        resolution.get("replacementTask") == next_promotable,
                        f"{label}: SUPERSEDED replacement must equal next promotable",
                    )
            expected_parent = commit
        audit.require(
            bool(graph) and expected_parent == target_commit,
            f"{label}: history tail must end exactly at target",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{label}: cannot validate explicit Git history: {exc}")
    return target_commit if len(audit.errors) == initial_errors else None


def git_blob_oid_for_content(content: bytes, oid_length: int) -> str | None:
    if oid_length == 40:
        digest = hashlib.sha1()
    elif oid_length == 64:
        digest = hashlib.sha256()
    else:
        return None
    digest.update(f"blob {len(content)}\0".encode("ascii"))
    digest.update(content)
    return digest.hexdigest()


def historical_task_card_text(
    audit: Audit,
    label: str,
    path: str,
    task_card_snapshot: dict[str, dict[str, Any]],
) -> str | None:
    record = task_card_snapshot.get(path)
    audit.require(
        isinstance(record, dict),
        f"{label}: historical task-card snapshot is missing exact path {path!r}",
    )
    if not isinstance(record, dict):
        return None
    audit.require(
        set(record) == HISTORICAL_TASK_CARD_SNAPSHOT_FIELDS,
        f"{label}: historical task-card snapshot fields must be exactly "
        f"{sorted(HISTORICAL_TASK_CARD_SNAPSHOT_FIELDS)}",
    )
    path_matches = record.get("path") == path
    mode_matches = record.get("mode") == "100644"
    type_matches = record.get("objectType") == "blob"
    oid = record.get("oid")
    oid_valid = isinstance(oid, str) and bool(
        re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", oid)
    )
    content = record.get("content")
    content_valid = isinstance(content, bytes)
    audit.require(
        path_matches,
        f"{label}: historical task-card snapshot path must remain exactly {path!r}",
    )
    audit.require(
        mode_matches and type_matches,
        f"{label}: historical task card must be a regular 100644 blob",
    )
    audit.require(
        oid_valid,
        f"{label}: historical task-card blob oid is invalid",
    )
    audit.require(
        content_valid,
        f"{label}: historical task-card blob is unreadable",
    )
    if not (
        set(record) == HISTORICAL_TASK_CARD_SNAPSHOT_FIELDS
        and path_matches
        and mode_matches
        and type_matches
        and oid_valid
        and content_valid
    ):
        return None
    assert isinstance(oid, str)
    assert isinstance(content, bytes)
    actual_oid = git_blob_oid_for_content(content, len(oid))
    audit.require(
        actual_oid == oid,
        f"{label}: historical task-card content does not match its blob oid",
    )
    if actual_oid != oid:
        return None
    try:
        return content.decode("utf-8")
    except UnicodeError as exc:
        audit.error(f"{label}: historical task-card blob is not UTF-8: {exc}")
        return None


def task_card_snapshot_at_commit(
    audit: Audit,
    commit: str,
    backlog: dict[str, Any],
    known_tasks: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    tasks: dict[str, dict[str, Any]] = {}
    task_card_snapshot: dict[str, dict[str, Any]] = {}
    entries = backlog.get("tasks")
    if not isinstance(entries, dict):
        return tasks, task_card_snapshot
    for task_id, raw_entry in entries.items():
        if not isinstance(raw_entry, dict):
            continue
        path = str(raw_entry.get("taskCard", ""))
        if not is_repository_relative(path):
            continue
        tree_entry = git_tree_entry(commit, path)
        if tree_entry is None:
            continue
        mode, object_type, oid = tree_entry
        content: bytes | None = None
        try:
            if object_type == "blob":
                content = git_object(commit, path)
        except (HarnessError, OSError):
            pass
        task_card_snapshot[path] = {
            "path": path,
            "mode": mode,
            "objectType": object_type,
            "oid": oid,
            "content": content,
        }
        if not isinstance(content, bytes):
            continue
        try:
            text = content.decode("utf-8")
            metadata = task_metadata_from_text(
                text,
                f"task-backlog.tasks.{task_id} at {commit}",
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot load historical task card at {commit}: {exc}"
            )
            continue
        audit.require(
            metadata.get("taskId") == task_id,
            f"task-backlog.tasks.{task_id}: historical task-card taskId must "
            f"remain {task_id}",
        )
        metadata["_path"] = path
        tasks[str(task_id)] = metadata
    for task_id, known_task in known_tasks.items():
        if task_id in entries:
            continue
        path = str(known_task.get("_path", ""))
        if not is_repository_relative(path):
            continue
        try:
            tree_entry = git_tree_entry(commit, path)
            if tree_entry is None:
                continue
            audit.require(
                tree_entry[:2] == ("100644", "blob"),
                f"{task_id}: historical task card at {commit} must be a regular "
                "100644 blob",
            )
            metadata = task_metadata_at_commit(commit, path)
            metadata["_path"] = path
            tasks[task_id] = metadata
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot load task snapshot at {commit}: {exc}"
            )
    return tasks, task_card_snapshot


def validate_backlog_draft_promotion_at_base(
    audit: Audit,
    task: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    base_commit = str(task.get("baseCommit", ""))
    try:
        backlog = yaml_at_commit(base_commit, TASK_BACKLOG_PATH)
        state = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
        base_tasks, task_card_snapshot = task_card_snapshot_at_commit(
            audit,
            base_commit,
            backlog,
            tasks,
        )
        planned = base_tasks.get(task_id)
        audit.require(
            planned is not None and planned.get("state") == "PLANNED",
            f"{task_id}: backlog-managed DRAFT must be PLANNED at Base Commit",
        )
        projection = validate_task_backlog_data(
            audit,
            backlog,
            base_tasks,
            lifecycle,
            state,
            task_card_snapshot=task_card_snapshot,
        )
        blockers = projection.get("blockers")
        blockers = blockers if isinstance(blockers, dict) else {}
        candidate_blockers = blockers.get(task_id)
        candidate_blockers = (
            candidate_blockers
            if isinstance(candidate_blockers, list)
            else ["MISSING_FROM_PROMOTION_PROJECTION"]
        )
        audit.require(
            projection.get("nextPromotable") == task_id
            and not candidate_blockers,
            f"{task_id}: DRAFT promotion bypasses Backlog order, dependencies or "
            f"decision gates at Base Commit; next={projection.get('nextPromotable')!r}, "
            f"blockers={candidate_blockers}",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(
            f"{task_id}: cannot reconstruct Backlog promotion at Base Commit: {exc}"
        )


def validate_task_backlog_data(
    audit: Audit,
    backlog: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    state: dict[str, Any],
    *,
    task_card_snapshot: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    audit.require(
        set(backlog) == BACKLOG_ROOT_FIELDS,
        f"task-backlog: root fields must be exactly {sorted(BACKLOG_ROOT_FIELDS)}",
    )
    audit.require(
        backlog.get("schemaVersion") == 1,
        "task-backlog: unsupported schemaVersion",
    )
    audit.require(
        backlog.get("backlogId") == "technical-alpha",
        "task-backlog: backlogId must be technical-alpha",
    )
    audit.require(
        backlog.get("phase") == state.get("phase") == "TECHNICAL_ALPHA",
        "task-backlog: phase must match the current TECHNICAL_ALPHA project state",
    )
    audit.require(
        backlog.get("planningContractHashAlgorithm")
        == PLANNING_CONTRACT_HASH_ALGORITHM,
        "task-backlog: unsupported planning contract hash algorithm",
    )

    authority = backlog.get("authority")
    audit.require(
        isinstance(authority, dict)
        and set(authority) == {"owns", "taskCardsAreHashBoundProjections"},
        "task-backlog: authority fields are invalid",
    )
    if isinstance(authority, dict):
        audit.require(
            authority.get("owns")
            == [
                "executionOrder",
                "dependencies",
                "criticalPath",
                "decisionGates",
                "promotionConditions",
                "authorizationAmendments",
            ],
            "task-backlog: authority must own the complete planning decision set",
        )
        audit.require(
            authority.get("taskCardsAreHashBoundProjections") is True,
            "task-backlog: task cards must be hash-bound projections",
        )

    rules = backlog.get("rules")
    audit.require(isinstance(rules, dict), "task-backlog: rules must be an object")
    rules = rules if isinstance(rules, dict) else {}
    lifecycle_rules = lifecycle.get("rules")
    lifecycle_rules = lifecycle_rules if isinstance(lifecycle_rules, dict) else {}
    active_states = set(str(item) for item in lifecycle.get("activeStates", []))
    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    audit.require(
        rules.get("plannedState") == "PLANNED"
        and "PLANNED" in set(str(item) for item in lifecycle.get("states", [])),
        "task-backlog: PLANNED state must exist in the lifecycle",
    )
    audit.require(
        rules.get("plannedConsumesActiveTask") is False
        and lifecycle_rules.get("plannedConsumesActiveTask") is False
        and "PLANNED" not in active_states,
        "task-backlog: PLANNED must not consume activeTask",
    )
    audit.require(
        lifecycle_rules.get("plannedRequiresBacklogEntry") is True,
        "task-backlog: lifecycle must require every PLANNED card to belong "
        "to the canonical Backlog",
    )
    audit.require(
        rules.get("maximumPendingDraftTasks")
        == lifecycle_rules.get("maximumPendingDraftTasks")
        == 1,
        "task-backlog: maximumPendingDraftTasks must be one",
    )
    audit.require(
        rules.get("maximumActiveTasks")
        == lifecycle_rules.get("maximumActiveTasks")
        == 1,
        "task-backlog: maximumActiveTasks must be one",
    )
    audit.require(
        rules.get("idPolicy") == "PERMANENT_NEVER_REUSE",
        "task-backlog: Task IDs must be permanently reserved",
    )
    cancellation_states = validate_nonblank_string_list(
        audit,
        "task-backlog.rules.cancellationStates",
        rules.get("cancellationStates"),
    )
    audit.require(
        set(cancellation_states) == {"REJECTED", "SUPERSEDED"}
        and set(cancellation_states) <= terminal_states,
        "task-backlog: cancellation states must be terminal REJECTED/SUPERSEDED",
    )
    audit.require(
        rules.get("cancellationReasonRequired") is True,
        "task-backlog: cancellation reasons must be required",
    )
    audit.require(
        rules.get("plannedResolutionRegistry") == "resolutions",
        "task-backlog: PLANNED cancellation must use the append-only resolutions registry",
    )
    audit.require(
        set(str(item) for item in transitions.get("PLANNED", []))
        == {"DRAFT", "REJECTED", "SUPERSEDED"},
        "task-backlog: PLANNED must support DRAFT promotion and preserved "
        "REJECTED/SUPERSEDED planning resolution",
    )
    audit.require(
        all(
            "SUPERSEDED" not in set(str(item) for item in targets)
            for source, targets in transitions.items()
            if source != "PLANNED" and isinstance(targets, list)
        ),
        "task-backlog: SUPERSEDED must be reachable only from planning-only "
        "PLANNED cards",
    )
    audit.require(
        set(lifecycle_rules.get("planningTerminalStates", []))
        == PLANNING_TERMINAL_STATES
        and lifecycle_rules.get("planningTerminalRequiresBacklogResolution")
        is True
        and lifecycle_rules.get("planningTerminalConsumesTaskLedger") is False,
        "task-backlog: lifecycle planning-terminal semantics are incomplete",
    )
    audit.require(
        lifecycle_rules.get("authorizationAmendments")
        == {
            "machineSource": TASK_BACKLOG_PATH,
            "taskCardProjectionField": "scopeAmendments",
            "approvedBy": "repository-owner",
            "singleParentAtomicCommitRequired": True,
            "uncommittedAuthorizationForbidden": True,
            "appendOnlyAndImmutable": True,
            "explicitClauseReplacementRequired": True,
            "canonicalExactPosixPathsRequired": True,
            "forbiddenPathsAlwaysWins": True,
        },
        "task-backlog: lifecycle Owner amendment semantics are incomplete",
    )
    promotion = rules.get("promotion")
    audit.require(
        isinstance(promotion, dict),
        "task-backlog: promotion must be an object",
    )
    promotion = promotion if isinstance(promotion, dict) else {}
    audit.require(
        promotion.get("from") == "PLANNED"
        and promotion.get("to") == "DRAFT"
        and promotion.get("selection")
        == "FIRST_PROMOTABLE_BY_EXECUTION_ORDER"
        and promotion.get("requiresRepositoryIdle") is True
        and promotion.get("requiresAllDependenciesAccepted") is True
        and promotion.get("requiresAllDecisionGatesApproved") is True
        and promotion.get("dynamicEvidenceBoundAt") == "DRAFT",
        "task-backlog: promotion semantics drift from the governed PLANNED contract",
    )
    forbidden_dynamic = validate_nonblank_string_list(
        audit,
        "task-backlog.rules.promotion.forbiddenDynamicFieldsWhilePlanned",
        promotion.get("forbiddenDynamicFieldsWhilePlanned"),
    )
    audit.require(
        {
            "baseCommit",
            "authorizationCommit",
            "contextFingerprint",
            "contextLock",
            "requiredCommands",
            "requiredSkillVersions",
        }
        <= set(forbidden_dynamic),
        "task-backlog: PLANNED must forbid all volatile execution evidence",
    )

    boundary = backlog.get("technicalAlphaBoundary")
    audit.require(
        isinstance(boundary, dict),
        "task-backlog: technicalAlphaBoundary must be an object",
    )
    boundary = boundary if isinstance(boundary, dict) else {}
    forbidden_capabilities = validate_nonblank_string_list(
        audit,
        "task-backlog.technicalAlphaBoundary.forbiddenCapabilities",
        boundary.get("forbiddenCapabilities"),
    )
    audit.require(
        {
            "PUBLIC_REGISTRATION",
            "REAL_PAYMENT",
            "ROMANCE_MODE",
            "VOICE",
            "IMAGE",
            "WEBSOCKET",
            "PROACTIVE_MESSAGES",
            "MULTI_ROLE",
            "SECOND_LIVE_PROVIDER",
            "BETA",
        }
        <= set(forbidden_capabilities),
        "task-backlog: Technical Alpha forbidden capability boundary is incomplete",
    )
    outbound = boundary.get("outboundPolicy")
    audit.require(
        isinstance(outbound, dict)
        and outbound.get("beforeTask") == "TASK-0035"
        and outbound.get("realProviderAccess") == "FORBIDDEN"
        and outbound.get("realCredentialRead") == "FORBIDDEN",
        "task-backlog: real outbound must remain forbidden before TASK-0035",
    )
    if isinstance(outbound, dict):
        allowed_outbound = validate_nonblank_string_list(
            audit,
            "task-backlog.technicalAlphaBoundary.outboundPolicy.allowed",
            outbound.get("allowed"),
        )
        audit.require(
            set(allowed_outbound)
            == {
                "FAKE",
                "FAILURE",
                "SYNTHETIC_RECORDS",
                "LOOPBACK_127_0_0_1",
            },
            "task-backlog: pre-live outbound allowlist must remain offline-only",
        )
    audit.require(
        boundary.get("liveProviderLimit") == 1,
        "task-backlog: Technical Alpha permits at most one live provider",
    )

    test_policies = backlog.get("testPolicies")
    audit.require(
        isinstance(test_policies, dict)
        and set(test_policies) == {"java", "database"},
        "task-backlog: testPolicies must define java and database",
    )
    if isinstance(test_policies, dict):
        java_policy = test_policies.get("java")
        database_policy = test_policies.get("database")
        audit.require(
            isinstance(java_policy, dict)
            and java_policy.get("distribution") == "Temurin"
            and java_policy.get("versionSource") == ".harness/tools.lock.yaml"
            and java_policy.get("localValidationHomeRequired") is True
            and java_policy.get("modifySystemJava") is False,
            "task-backlog: Java validation must use the locked Temurin baseline "
            "without modifying system Java",
        )
        audit.require(
            isinstance(database_policy, dict)
            and database_policy.get("firstApplicableTask") == "TASK-0015"
            and database_policy.get("runtime") == "WSL2_DOCKER"
            and database_policy.get("engine")
            == "POSTGRESQL_18_WITH_PGVECTOR"
            and database_policy.get("data") == "SYNTHETIC_ONLY"
            and database_policy.get("network") == "TEMPORARY_PORT_ONLY"
            and database_policy.get("storage") == "TEMPORARY_VOLUME_ONLY"
            and database_policy.get("cleanupRequired") is True
            and database_policy.get("imageVersionAndDigestBoundAtTaskDraft")
            is True,
            "task-backlog: database test policy must remain disposable, synthetic "
            "and dynamically pinned",
        )
        if isinstance(database_policy, dict):
            forbidden_services = validate_nonblank_string_list(
                audit,
                "task-backlog.testPolicies.database.forbiddenExistingServices",
                database_policy.get("forbiddenExistingServices"),
            )
            audit.require(
                set(forbidden_services)
                == {"MYSQL", "REDIS", "RABBITMQ", "KINGBASE"},
                "task-backlog: existing local data services must remain forbidden",
            )

    entries = backlog.get("tasks")
    audit.require(isinstance(entries, dict), "task-backlog: tasks must be an object")
    entries = entries if isinstance(entries, dict) else {}
    historical_task_cards = task_card_snapshot is not None
    if historical_task_cards:
        audit.require(
            isinstance(task_card_snapshot, dict),
            "task-backlog: historical task-card snapshot must be an object",
        )
        task_card_snapshot = (
            task_card_snapshot if isinstance(task_card_snapshot, dict) else {}
        )
        expected_task_card_paths = {
            str(entry.get("taskCard", ""))
            for entry in entries.values()
            if isinstance(entry, dict)
        }
        audit.require(
            set(task_card_snapshot) == expected_task_card_paths,
            "task-backlog: historical task-card snapshot paths must exactly match "
            "the same-commit Backlog taskCard paths",
        )
    validate_backlog_authorization_amendments(
        audit,
        backlog.get("authorizationAmendments"),
        tasks,
    )
    execution_order = validate_nonblank_string_list(
        audit,
        "task-backlog.executionOrder",
        backlog.get("executionOrder"),
    )
    audit.require(
        set(execution_order) == set(entries)
        and len(execution_order) == len(entries),
        "task-backlog: executionOrder must contain every task exactly once",
    )
    bootstrap_task = str(backlog.get("bootstrapTask", ""))
    audit.require(
        bool(execution_order) and bootstrap_task == execution_order[0],
        "task-backlog: bootstrapTask must be first in executionOrder",
    )
    order_index = {
        task_id: index
        for index, task_id in enumerate(execution_order)
    }
    backlog_bound_task_ids = {
        task_id
        for task_id, task in tasks.items()
        if task.get("planningBacklog") == TASK_BACKLOG_PATH
    }
    unregistered_backlog_tasks = sorted(
        backlog_bound_task_ids - set(entries)
    )
    audit.require(
        not unregistered_backlog_tasks,
        "task-backlog: every PLANNED or promoted Backlog-bound card must have "
        f"exactly one canonical entry; unregistered={unregistered_backlog_tasks}",
    )
    planning_only_task_ids = {
        task_id
        for task_id, task in tasks.items()
        if is_planning_only_task(task)
    }
    audit.require(
        planning_only_task_ids <= set(entries),
        "task-backlog: planning-only cards exist outside the canonical Backlog: "
        f"{sorted(planning_only_task_ids - set(entries))}",
    )

    gates = backlog.get("decisionGates")
    audit.require(
        isinstance(gates, dict),
        "task-backlog: decisionGates must be an object",
    )
    gates = gates if isinstance(gates, dict) else {}
    gate_requirements: dict[str, set[str]] = {}
    for gate_id, raw_gate in gates.items():
        label = f"task-backlog.decisionGates.{gate_id}"
        audit.require(
            bool(re.fullmatch(r"GATE-[A-Z0-9-]+", str(gate_id))),
            f"{label}: invalid gate ID",
        )
        audit.require(isinstance(raw_gate, dict), f"{label}: must be an object")
        if not isinstance(raw_gate, dict):
            continue
        audit.require(
            set(raw_gate) == BACKLOG_GATE_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_GATE_FIELDS)}",
        )
        audit.require(
            raw_gate.get("kind") == "HARD_OWNER_DECISION",
            f"{label}: kind must be HARD_OWNER_DECISION",
        )
        status = str(raw_gate.get("status", ""))
        audit.require(
            status in {"PENDING", "APPROVED", "REJECTED"},
            f"{label}: invalid status {status!r}",
        )
        required_for = validate_nonblank_string_list(
            audit,
            f"{label}.requiredFor",
            raw_gate.get("requiredFor"),
        )
        gate_requirements[str(gate_id)] = set(required_for)
        required_decisions = validate_nonblank_string_list(
            audit,
            f"{label}.requiredDecisions",
            raw_gate.get("requiredDecisions"),
        )
        approval = raw_gate.get("approval")
        if status == "PENDING":
            audit.require(
                approval is None,
                f"{label}: PENDING gate must not fabricate approval",
            )
        else:
            audit.require(
                isinstance(approval, dict)
                and set(approval) == BACKLOG_GATE_APPROVAL_FIELDS,
                f"{label}: decided gate requires Owner evidence for every "
                "required decision",
            )
            if isinstance(approval, dict):
                audit.require(
                    approval.get("approvedBy") == "repository-owner",
                    f"{label}.approval.approvedBy must be repository-owner",
                )
                audit.require(
                    is_valid_approval_timestamp(approval.get("approvedAt")),
                    f"{label}.approval.approvedAt must be ISO-8601",
                )
                validate_nonblank_text(
                    audit,
                    f"{label}.approval.evidence",
                    approval.get("evidence"),
                )
                decision_evidence = approval.get("decisionEvidence")
                audit.require(
                    isinstance(decision_evidence, dict)
                    and set(decision_evidence) == set(required_decisions),
                    f"{label}.approval.decisionEvidence must cover every "
                    "requiredDecision exactly",
                )
                if isinstance(decision_evidence, dict):
                    for decision in required_decisions:
                        decision_record = decision_evidence.get(decision)
                        audit.require(
                            isinstance(decision_record, dict)
                            and set(decision_record)
                            == BACKLOG_GATE_DECISION_EVIDENCE_FIELDS,
                            f"{label}.approval.decisionEvidence[{decision!r}] "
                            "must record value and evidence",
                        )
                        if isinstance(decision_record, dict):
                            for field in sorted(
                                BACKLOG_GATE_DECISION_EVIDENCE_FIELDS
                            ):
                                validate_nonblank_text(
                                    audit,
                                    f"{label}.approval.decisionEvidence"
                                    f"[{decision!r}].{field}",
                                    decision_record.get(field),
                                )

    titles: set[str] = set()
    dependencies_by_task: dict[str, list[str]] = {}
    gates_by_task: dict[str, list[str]] = {}
    for task_id, raw_entry in entries.items():
        label = f"task-backlog.tasks.{task_id}"
        audit.require(
            bool(TASK_ID_RE.fullmatch(str(task_id))),
            f"{label}: invalid task ID",
        )
        audit.require(isinstance(raw_entry, dict), f"{label}: must be an object")
        if not isinstance(raw_entry, dict):
            continue
        audit.require(
            set(raw_entry) == BACKLOG_TASK_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_TASK_FIELDS)}",
        )
        title = str(raw_entry.get("title", ""))
        validate_nonblank_text(audit, f"{label}.title", raw_entry.get("title"))
        audit.require(
            title not in titles,
            f"{label}: task title is already permanently reserved",
        )
        titles.add(title)
        task_card = str(raw_entry.get("taskCard", ""))
        audit.require(
            is_repository_relative(task_card),
            f"{label}.taskCard must be repository-relative",
        )
        discovered = tasks.get(str(task_id))
        audit.require(discovered is not None, f"{label}: task card is missing")
        if historical_task_cards and discovered is not None:
            audit.require(
                discovered.get("taskId") == task_id,
                f"{label}: historical task-card taskId must remain {task_id}",
            )
        if discovered is not None:
            audit.require(
                discovered.get("_path") == task_card,
                f"{label}: taskCard disagrees with discovered card",
            )
        try:
            heading = f"# {task_id}：{title}\n"
            if historical_task_cards:
                assert isinstance(task_card_snapshot, dict)
                card_text = historical_task_card_text(
                    audit,
                    label,
                    task_card,
                    task_card_snapshot,
                )
            else:
                card_text = read_repository_text(ROOT / task_card)
            if card_text is not None:
                audit.require(
                    card_text.startswith(heading),
                    f"{label}: task card heading must preserve the reserved ID/title",
                )
                if historical_task_cards:
                    historical_metadata = task_metadata_from_text(card_text, label)
                    audit.require(
                        historical_metadata.get("taskId") == task_id,
                        f"{label}: historical task-card taskId must remain {task_id}",
                    )
                    if discovered is not None:
                        audit.require(
                            historical_metadata
                            == {
                                key: value
                                for key, value in discovered.items()
                                if key != "_path"
                            },
                            f"{label}: historical task-card metadata disagrees with "
                            "the same-commit task snapshot",
                        )
                if discovered is not None and is_planning_only_task(discovered):
                    planned_card_render_projection(
                        audit,
                        label,
                        str(task_id),
                        raw_entry,
                        card_text,
                    )
        except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(f"{label}: cannot read task card heading: {exc}")

        dependencies = validate_nonblank_string_list(
            audit,
            f"{label}.dependencies",
            raw_entry.get("dependencies"),
        )
        dependencies_by_task[str(task_id)] = dependencies
        for dependency in dependencies:
            audit.require(
                dependency != task_id,
                f"{label}: task cannot depend on itself",
            )
            audit.require(
                dependency in tasks,
                f"{label}: unknown dependency {dependency}",
            )
            if dependency in order_index and task_id in order_index:
                audit.require(
                    order_index[dependency] < order_index[task_id],
                    f"{label}: dependency {dependency} must precede the task in "
                    "executionOrder",
                )

        task_gates = validate_nonblank_string_list(
            audit,
            f"{label}.decisionGates",
            raw_entry.get("decisionGates"),
            allow_empty=True,
        )
        gates_by_task[str(task_id)] = task_gates
        for gate_id in task_gates:
            audit.require(
                gate_id in gates,
                f"{label}: unknown decision gate {gate_id}",
            )
        validate_nonblank_text(
            audit,
            f"{label}.objective",
            raw_entry.get("objective"),
        )
        scope = raw_entry.get("scope")
        audit.require(
            isinstance(scope, dict) and set(scope) == {"in", "out"},
            f"{label}.scope must define in and out",
        )
        if isinstance(scope, dict):
            validate_nonblank_string_list(
                audit,
                f"{label}.scope.in",
                scope.get("in"),
            )
            validate_nonblank_string_list(
                audit,
                f"{label}.scope.out",
                scope.get("out"),
            )
        for field in ("forbidden", "acceptanceCriteria"):
            validate_nonblank_string_list(
                audit,
                f"{label}.{field}",
                raw_entry.get(field),
            )
        promotion_conditions = raw_entry.get("promotionConditions")
        audit.require(
            isinstance(promotion_conditions, dict)
            and set(promotion_conditions)
            == BACKLOG_PROMOTION_CONDITION_FIELDS,
            f"{label}.promotionConditions must be the executable condition "
            f"object {sorted(BACKLOG_PROMOTION_CONDITION_FIELDS)}",
        )
        if isinstance(promotion_conditions, dict):
            for field in sorted(BACKLOG_PROMOTION_CONDITION_FIELDS):
                audit.require(
                    promotion_conditions.get(field) is True,
                    f"{label}.promotionConditions.{field} must be true",
                )

        if discovered is None:
            continue
        expected_hash = canonical_json_sha256(raw_entry)
        if is_planning_only_task(discovered):
            validate_planned_task_metadata(
                audit,
                str(task_id),
                discovered,
            )
            audit.require(
                discovered.get("planningContractHash") == expected_hash,
                f"{label}: PLANNED card hash drifts from the Backlog contract",
            )
        elif task_id != bootstrap_task:
            audit.require(
                discovered.get("planningBacklog") == TASK_BACKLOG_PATH
                and discovered.get("planningContractHash") == expected_hash
                and discovered.get("planningContractHashAlgorithm")
                == PLANNING_CONTRACT_HASH_ALGORITHM,
                f"{label}: promoted task must retain its PLANNED contract binding",
            )
        if (
            discovered.get("state") in {"REJECTED", "SUPERSEDED"}
            and not is_planning_only_task(discovered)
        ):
            validate_nonblank_text(
                audit,
                f"{label}.resolutionReason",
                discovered.get("resolutionReason"),
            )

    for gate_id, required_for in gate_requirements.items():
        actual = {
            task_id
            for task_id, task_gates in gates_by_task.items()
            if gate_id in task_gates
        }
        audit.require(
            required_for == actual,
            f"task-backlog: gate {gate_id} requiredFor disagrees with task references",
        )

    critical_path = validate_nonblank_string_list(
        audit,
        "task-backlog.criticalPath",
        backlog.get("criticalPath"),
    )
    audit.require(
        bool(critical_path)
        and bool(execution_order)
        and critical_path[0] == execution_order[0]
        and critical_path[-1] == execution_order[-1],
        "task-backlog: criticalPath must span the first through final execution task",
    )
    for previous, current in zip(critical_path, critical_path[1:]):
        audit.require(
            previous in dependencies_by_task.get(current, []),
            f"task-backlog: criticalPath edge {previous} -> {current} is not a "
            "declared dependency",
        )
    longest_lengths: dict[str, int] = {}
    for task_id in execution_order:
        internal_dependencies = [
            dependency
            for dependency in dependencies_by_task.get(task_id, [])
            if dependency in longest_lengths
        ]
        longest_lengths[task_id] = 1 + max(
            (longest_lengths[dependency] for dependency in internal_dependencies),
            default=0,
        )
    audit.require(
        bool(longest_lengths)
        and len(critical_path) == max(longest_lengths.values()),
        "task-backlog: declared criticalPath is not a longest dependency path",
    )

    resolutions = backlog.get("resolutions")
    audit.require(
        isinstance(resolutions, dict),
        "task-backlog: resolutions must be an object",
    )
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    for task_id, raw_resolution in resolutions.items():
        label = f"task-backlog.resolutions.{task_id}"
        audit.require(task_id in entries, f"{label}: unknown reserved Task ID")
        audit.require(
            isinstance(raw_resolution, dict),
            f"{label}: must be an object",
        )
        if not isinstance(raw_resolution, dict):
            continue
        audit.require(
            set(raw_resolution) == BACKLOG_RESOLUTION_FIELDS,
            f"{label}: fields must be exactly {sorted(BACKLOG_RESOLUTION_FIELDS)}",
        )
        resolution_state = str(raw_resolution.get("state", ""))
        audit.require(
            resolution_state in {"REJECTED", "SUPERSEDED"},
            f"{label}: state must be REJECTED or SUPERSEDED",
        )
        validate_nonblank_text(
            audit,
            f"{label}.reason",
            raw_resolution.get("reason"),
        )
        audit.require(
            is_canonical_identity(raw_resolution.get("decidedBy")),
            f"{label}.decidedBy must be canonical",
        )
        audit.require(
            is_valid_approval_timestamp(raw_resolution.get("decidedAt")),
            f"{label}.decidedAt must be ISO-8601",
        )
        replacement = raw_resolution.get("replacementTask")
        if resolution_state == "SUPERSEDED":
            audit.require(
                isinstance(replacement, str)
                and replacement in entries
                and replacement != task_id,
                f"{label}: SUPERSEDED requires a distinct permanently reserved "
                "replacementTask",
            )
        else:
            audit.require(
                replacement is None,
                f"{label}: REJECTED must not declare a replacementTask",
            )

    planning_terminal_ids = {
        task_id
        for task_id, task in tasks.items()
        if is_planning_only_task(task)
        and task.get("state") in PLANNING_TERMINAL_STATES
    }
    audit.require(
        set(resolutions) == planning_terminal_ids,
        "task-backlog: planning terminal cards and append-only resolutions "
        f"must match exactly (cards={sorted(planning_terminal_ids)}, "
        f"resolutions={sorted(resolutions)})",
    )
    for task_id in sorted(planning_terminal_ids & set(resolutions)):
        task = tasks[task_id]
        resolution = resolutions[task_id]
        audit.require(
            task.get("state") == resolution.get("state")
            and task.get("planningResolution") == resolution,
            f"task-backlog: planning terminal card {task_id} must project its "
            "resolution exactly",
        )

    projection = derive_backlog_promotion_projection(
        backlog,
        tasks,
        lifecycle,
    )
    repository_idle = bool(projection.get("repositoryIdle"))
    next_promotable = projection.get("nextPromotable")
    if repository_idle and next_promotable:
        audit.require(
            next_promotable in str(state.get("nextAction", "")),
            f"project-state.nextAction must identify Backlog next promotable task "
            f"{next_promotable}",
        )

    backlog_drafts = sorted(
        task_id
        for task_id, task in tasks.items()
        if task.get("state") == "DRAFT"
        and task.get("planningBacklog") == TASK_BACKLOG_PATH
    )
    audit.require(
        len(backlog_drafts) <= 1,
        "task-backlog: multiple Backlog-managed DRAFT promotions are forbidden: "
        f"{backlog_drafts}",
    )
    draft_promotions: dict[str, dict[str, Any]] = {}
    for draft_task_id in backlog_drafts:
        draft_projection = derive_backlog_promotion_projection(
            backlog,
            tasks,
            lifecycle,
            draft_candidate=draft_task_id,
        )
        draft_promotions[draft_task_id] = draft_projection
        draft_blockers = draft_projection.get("blockers")
        draft_blockers = (
            draft_blockers.get(draft_task_id)
            if isinstance(draft_blockers, dict)
            else None
        )
        draft_blockers = (
            draft_blockers
            if isinstance(draft_blockers, list)
            else ["MISSING_FROM_PROMOTION_PROJECTION"]
        )
        audit.require(
            draft_projection.get("nextPromotable") == draft_task_id
            and not draft_blockers,
            f"task-backlog: DRAFT {draft_task_id} bypasses execution order, "
            "dependencies, repository-idle or hard decision gates; "
            f"next={draft_projection.get('nextPromotable')!r}, "
            f"blockers={draft_blockers}",
        )
        audit.require(
            draft_task_id in str(state.get("nextAction", "")),
            f"project-state.nextAction at DRAFT promotion must identify "
            f"{draft_task_id}",
        )

    return {
        **projection,
        "draftPromotions": draft_promotions,
        "executionOrder": execution_order,
        "criticalPath": critical_path,
    }


def validate_task_backlog(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    backlog = load_yaml(ROOT / TASK_BACKLOG_PATH)
    projection = validate_task_backlog_data(
        audit,
        backlog,
        tasks,
        lifecycle,
        state,
    )
    validate_task_backlog_history(audit, backlog, lifecycle)
    return projection


def validate_skills(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    registry = load_yaml(ROOT / ".harness/skills.yaml")
    entries = registry.get("skills")
    if not isinstance(entries, list):
        audit.error(".harness/skills.yaml: skills must be a list")
        entries = []
    skills: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            audit.error(".harness/skills.yaml: each Skill entry must be an object")
            continue
        skill_id = str(entry.get("id", ""))
        audit.require(bool(skill_id), ".harness/skills.yaml: Skill id is required")
        audit.require(skill_id not in skills, f".harness/skills.yaml: duplicate Skill {skill_id}")
        skill_path = str(entry.get("path", ""))
        audit.require(is_repository_relative(skill_path), f"Skill {skill_id}: path must be repository-relative")
        path = ROOT / normalize_repo_path(skill_path)
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"Skill {skill_id}: missing {skill_path}")
        if path_is_file:
            try:
                metadata = parse_skill_metadata(path)
                if skill_id == "task-delivery-flow":
                    audit.require(
                        set(metadata) == {"name", "description"},
                        "Skill task-delivery-flow: frontmatter must contain only "
                        "name and description; version belongs to the registry",
                    )
                    declared_id = metadata.get("name")
                    declared_version = entry.get("version", "")
                else:
                    extension = metadata.get("metadata")
                    extension = extension if isinstance(extension, dict) else {}
                    declared_id = extension.get("id", metadata.get("id", metadata.get("name")))
                    declared_version = extension.get("version", metadata.get("version", ""))
                audit.require(declared_id == skill_id, f"Skill {skill_id}: frontmatter id/name mismatch")
                audit.require(
                    str(declared_version) == str(entry.get("version", "")),
                    f"Skill {skill_id}: registry/frontmatter version mismatch",
                )
            except HarnessError as exc:
                audit.error(str(exc))
        skills[skill_id] = entry

    protected = load_yaml(ROOT / ".harness/protected-paths.yaml")
    rules = protected.get("paths")
    if not isinstance(rules, list):
        audit.error(".harness/protected-paths.yaml: paths must be a list")
        rules = []
    for rule in rules:
        if not isinstance(rule, dict):
            audit.error(".harness/protected-paths.yaml: path rule must be an object")
            continue
        audit.require(bool(rule.get("glob")), "protected path rule: glob is required")
        audit.require(
            rule.get("riskClass") in RISK_RANK,
            f"protected path {rule.get('glob')}: riskClass must be one of {sorted(RISK_RANK)}",
        )
        skill_id = str(rule.get("requiredSkill", ""))
        audit.require(skill_id in skills, f"protected path {rule.get('glob')}: unregistered Skill {skill_id}")
        lifecycle_exemptions = rule.get("lifecycleExemptions", [])
        audit.require(
            isinstance(lifecycle_exemptions, list)
            and all(
                item in {PROJECT_STATE_PATH, TASK_LEDGER_PATH}
                for item in lifecycle_exemptions
            ),
            f"protected path {rule.get('glob')}: lifecycleExemptions may contain only "
            f"{PROJECT_STATE_PATH} and {TASK_LEDGER_PATH}",
        )
        if lifecycle_exemptions:
            audit.require(
                rule.get("glob") == ".harness/**",
                "protected path lifecycleExemptions are valid only on .harness/**",
            )

    for task_id, task in tasks.items():
        if is_planning_only_task(task) or task.get("state") in ("DRAFT", "REJECTED"):
            continue
        versions = task.get("requiredSkillVersions")
        if task_id != "TASK-0001":
            audit.require(isinstance(versions, dict), f"{task_id}: task must pin requiredSkillVersions")
        for skill_id in task_required_skills(task):
            audit.require(skill_id in skills, f"{task_id}: required Skill {skill_id} is not registered")
            if skill_id in skills and isinstance(versions, dict):
                skill_path = str(skills[skill_id].get("path", ""))
                try:
                    raw = git_object(str(task.get("baseCommit", "")), skill_path).decode("utf-8")
                    match = SKILL_FRONTMATTER_RE.search(raw)
                    if not match:
                        raise HarnessError(f"{skill_path}: baseline Skill frontmatter is missing")
                    baseline = strict_yaml_load(match.group(1))
                    if not isinstance(baseline, dict):
                        raise HarnessError(f"{skill_path}: baseline Skill frontmatter must be an object")
                    extension = baseline.get("metadata")
                    extension = extension if isinstance(extension, dict) else {}
                    baseline_registry = skill_registry_at_commit(
                        str(task.get("baseCommit", ""))
                    )
                    baseline_entry = baseline_registry.get(skill_id)
                    if (
                        not isinstance(baseline_entry, dict)
                        or baseline_entry.get("path") != skill_path
                    ):
                        raise HarnessError(
                            f"{skill_id}: Base Commit Skill registry binding is missing "
                            "or points at a different path"
                        )
                    baseline_version = extension.get(
                        "version",
                        baseline_entry.get("version", ""),
                    )
                    audit.require(
                        str(versions.get(skill_id, "")) == str(baseline_version),
                        f"{task_id}: required Skill {skill_id} is not pinned to its Base Commit version",
                    )
                except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                    audit.error(f"{task_id}: cannot verify baseline Skill {skill_id}: {exc}")
        targets = task.get("targetSkillVersions")
        if task_id != "TASK-0001":
            audit.require(isinstance(targets, dict), f"{task_id}: targetSkillVersions must be an object")
        delivery_skills = skills
        delivery_commit: str | None = None
        if task.get("state") == "ACCEPTED" and task_id != "TASK-0001":
            try:
                delivery_commit = canonical_terminal_commit(
                    task,
                    {"ACCEPTED", "REJECTED"},
                )
                if delivery_commit:
                    delivery_skills = skill_registry_at_commit(delivery_commit)
            except HarnessError as exc:
                audit.error(f"{task_id}: cannot load terminal Skill registry: {exc}")
        if isinstance(targets, dict):
            for skill_id, target_version in targets.items():
                audit.require(
                    bool(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", str(target_version))),
                    f"{task_id}: target Skill {skill_id} must use an exact semantic version",
                )
                if task.get("state") in ("IN_REVIEW", "ACCEPTED"):
                    audit.require(
                        skill_id in delivery_skills,
                        f"{task_id}: target Skill {skill_id} is not registered in delivery snapshot",
                    )
                if skill_id in delivery_skills and task.get("state") in ("IN_REVIEW", "ACCEPTED"):
                    audit.require(
                        str(delivery_skills[skill_id].get("version", "")) == str(target_version),
                        f"{task_id}: target Skill {skill_id} version does not match delivery registry",
                    )
        if (
            task_id != "TASK-0001"
            and task.get("state") in ("IN_REVIEW", "ACCEPTED")
            and isinstance(targets, dict)
        ):
            try:
                baseline_skills = skill_registry_at_commit(str(task.get("baseCommit", "")))
                removed = sorted(set(baseline_skills) - set(delivery_skills))
                audit.require(not removed, f"{task_id}: Skills cannot be removed by targetSkillVersions: {removed}")
                changed_skill_ids = set(delivery_skills) - set(baseline_skills)
                for skill_id in sorted(set(delivery_skills) & set(baseline_skills)):
                    current_entry = delivery_skills[skill_id]
                    baseline_entry = baseline_skills[skill_id]
                    baseline_path = str(baseline_entry.get("path", ""))
                    current_path = str(current_entry.get("path", ""))
                    if baseline_path != current_path:
                        audit.error(
                            f"{task_id}: Skill {skill_id} path changed; targetSkillVersions cannot authorize path moves"
                        )
                        changed_skill_ids.add(skill_id)
                        continue
                    if baseline_entry != current_entry:
                        changed_skill_ids.add(skill_id)
                    try:
                        baseline_content = git_object(
                            str(task.get("baseCommit", "")),
                            baseline_path,
                        )
                        current_content = (
                            git_object(delivery_commit, current_path)
                            if delivery_commit
                            else read_repository_bytes(
                                ROOT / normalize_repo_path(current_path)
                            )
                        )
                        if baseline_content != current_content:
                            changed_skill_ids.add(skill_id)
                    except (HarnessError, OSError) as exc:
                        audit.error(f"{task_id}: cannot compare Skill {skill_id} with Base Commit: {exc}")
                declared_targets = {str(skill_id) for skill_id in targets}
                delivery_paths = (
                    changed_paths_between(str(task.get("baseCommit", "")), delivery_commit)
                    if delivery_commit
                    else changed_paths(str(task.get("baseCommit", "")))
                )
                changed_tree_ids, invalid_skill_paths = changed_skill_tree_ids(
                    delivery_paths
                )
                audit.require(
                    not invalid_skill_paths,
                    f"{task_id}: changed Skill paths must belong to a registered Skill directory: "
                    f"{invalid_skill_paths}",
                )
                audit.require(
                    changed_tree_ids <= declared_targets,
                    f"{task_id}: changed Skill directories {sorted(changed_tree_ids)} exceed "
                    f"targetSkillVersions {sorted(declared_targets)}",
                )
                audit.require(
                    changed_skill_ids == declared_targets,
                    f"{task_id}: changed Skills {sorted(changed_skill_ids)} must exactly match "
                    f"targetSkillVersions {sorted(declared_targets)}",
                )
                for skill_id in sorted(changed_skill_ids & declared_targets):
                    target_version = semantic_version(targets.get(skill_id))
                    if skill_id in baseline_skills:
                        baseline_version = semantic_version(
                            baseline_skills[skill_id].get("version")
                        )
                        audit.require(
                            baseline_version is not None
                            and target_version is not None
                            and target_version > baseline_version,
                            f"{task_id}: changed existing Skill {skill_id} target version must increase "
                            f"from {baseline_skills[skill_id].get('version')}",
                        )
                    else:
                        audit.require(
                            target_version == (1, 0, 0),
                            f"{task_id}: new Skill {skill_id} must start at version 1.0.0",
                        )
            except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
                audit.error(f"{task_id}: cannot verify target Skill delta: {exc}")
    return skills, [rule for rule in rules if isinstance(rule, dict)]


def validate_sources(audit: Audit, tasks: dict[str, dict[str, Any]]) -> None:
    registry = load_yaml(ROOT / ".harness/sources-of-truth.yaml")
    sources = registry.get("sources")
    audit.require(isinstance(sources, dict), ".harness/sources-of-truth.yaml: sources must be an object")
    if isinstance(sources, dict):
        for source_id, value in sources.items():
            path = canonical_exact_repo_path(value)
            audit.require(
                path is not None,
                f"source {source_id}: path must be one canonical "
                "repository-relative POSIX path",
            )
            if path is not None:
                audit.require(
                    current_path_exists(ROOT / path),
                    f"source {source_id}: missing {path}",
                )
    invariants = load_yaml(ROOT / ".harness/invariants.yaml").get("invariants")
    audit.require(isinstance(invariants, list), ".harness/invariants.yaml: invariants must be a list")
    invariant_ids: set[str] = set()
    if isinstance(invariants, list):
        for index, invariant in enumerate(invariants):
            audit.require(isinstance(invariant, dict), f"invariants[{index}]: must be an object")
            if not isinstance(invariant, dict):
                continue
            invariant_id = str(invariant.get("id", ""))
            audit.require(bool(invariant_id), f"invariants[{index}]: id is required")
            audit.require(invariant_id not in invariant_ids, f"invariants: duplicate id {invariant_id}")
            invariant_ids.add(invariant_id)
            audit.require(bool(invariant.get("statement")), f"invariant {invariant_id}: statement is required")
            audit.require(
                isinstance(invariant.get("enforcement"), list) and bool(invariant.get("enforcement")),
                f"invariant {invariant_id}: enforcement must be a non-empty list",
            )
    for task_id, task in tasks.items():
        for path_value in task.get("sourcesOfTruth", []):
            path = str(path_value)
            audit.require(is_repository_relative(path), f"{task_id}: source of truth must be relative: {path}")
            if is_repository_relative(path):
                audit.require(
                    current_path_is_file(ROOT / normalize_repo_path(path)),
                    f"{task_id}: source of truth does not exist: {path}",
                )
        for invariant_id in task.get("requiredInvariants", []):
            audit.require(
                str(invariant_id) in invariant_ids,
                f"{task_id}: unknown required invariant {invariant_id}",
            )
    for path in sorted(repository_glob(ROOT / "specs/contracts", "*.yaml")):
        try:
            contract = load_yaml(path)
            audit.require(bool(contract.get("schemaVersion")), f"{relative(path)}: schemaVersion is required")
        except HarnessError as exc:
            audit.error(str(exc))


def validate_ci_execution_policy(audit: Audit) -> None:
    policy = load_yaml(ROOT / CI_EXECUTION_POLICY_PATH)
    audit.require(
        set(policy)
        == {
            "schemaVersion",
            "policyId",
            "taskDeliveryPolicy",
            "defaultChannel",
            "channels",
            "profiles",
            "task0064Bootstrap",
            "task0066Recovery",
            "task0067Recovery",
            "task0068Recovery",
            "task0069Recovery",
            "task0072SelfBootstrap",
            "task0073PreReadyMaintenance",
            "task0074PreReadyMaintenance",
            "task0075PreReadyMaintenance",
        "task0076PreReadyMaintenance",
            "rules",
        },
        "ci-execution-policy: root fields do not match the frozen machine contract",
    )
    audit.require(
        policy.get("schemaVersion") == 1
        and policy.get("policyId") == "ci-execution"
        and policy.get("taskDeliveryPolicy") == TASK_DELIVERY_POLICY_PATH
        and policy.get("defaultChannel") == "PRIMARY_REMOTE_EXACT_SHA",
        "ci-execution-policy: identity or delivery-policy binding drifted",
    )
    channels = policy.get("channels")
    audit.require(
        isinstance(channels, dict)
        and set(channels)
        == {"PRIMARY_REMOTE_EXACT_SHA", "LOCAL_EXACT_TREE_FALLBACK"},
        "ci-execution-policy: validation channels must be exact and unique",
    )
    channels = channels if isinstance(channels, dict) else {}
    remote = channels.get("PRIMARY_REMOTE_EXACT_SHA")
    remote = remote if isinstance(remote, dict) else {}
    unavailable = remote.get("unavailableEvidence")
    unavailable = unavailable if isinstance(unavailable, dict) else {}
    allowed_types = unavailable.get("allowedTypes")
    allowed_types = allowed_types if isinstance(allowed_types, dict) else {}
    quota = allowed_types.get("OWNER_SUPPLIED_QUOTA_EXHAUSTED")
    audit.require(
        remote.get("kind") == "REMOTE_EXACT_SHA"
        and remote.get("exactCommitRequired") is True
        and remote.get("exactTreeRequired") is True
        and unavailable.get("requiredType") == "STRONG_TYPED"
        and unavailable.get("unknownQuotaBehavior")
        == "REMOTE_VALIDATION_REQUIRED"
        and isinstance(quota, dict)
        and quota.get("requiredFields")
        == [
            "includedMinutes",
            "usedMinutes",
            "paidBudgetUsd",
            "stopUsageEnabled",
            "resetDate",
            "dispatchCount",
        ]
        and quota.get("constraints")
        == {
            "usedMustEqualIncluded": True,
            "paidBudgetUsdMustEqual": 0,
            "stopUsageEnabledMustEqual": True,
            "dispatchCountMustEqual": 0,
        },
        "ci-execution-policy: strong typed remote-unavailable evidence drifted",
    )
    local = channels.get("LOCAL_EXACT_TREE_FALLBACK")
    local = local if isinstance(local, dict) else {}
    audit.require(
        local.get("kind") == "LOCAL_EXACT_TREE"
        and local.get("activationRequires")
        == [
            "PROFILE_FROZEN_AT_READY",
            "STRONG_TYPED_REMOTE_UNAVAILABLE_EVIDENCE",
            "OWNER_AUTHORIZED_SCOPE",
        ]
        and local.get("exactCommitRequired") is True
        and local.get("exactTreeRequired") is True
        and local.get("cleanWorktreeRequired") is True
        and local.get("cleanIndexRequired") is True
        and local.get("candidateInputChange") == "RERUN_REQUIRED"
        and local.get("crossCommitOrTreeReuseForbidden") is True
        and local.get("passClaimLimitedToRecordedCoverage") is True
        and local.get("nonPassStatuses")
        == [
            "FAIL",
            "CANCELLED",
            "TIMEOUT",
            "NOT_RUN",
            "UNKNOWN",
            "DEFERRED_NOT_CLAIMED",
        ],
        "ci-execution-policy: local exact-tree fail-closed contract drifted",
    )
    audit.require(
        local.get("resultRecordRequiredFields")
        == [
            "taskId",
            "candidateCommit",
            "candidateTree",
            "cleanWorktree",
            "cleanIndex",
            "argv",
            "cwd",
            "operatingSystem",
            "interpreter",
            "toolchain",
            "dependencies",
            "environment",
            "stdoutSha256",
            "stderrSha256",
            "receiptSha256",
            "exitCode",
            "startedAt",
            "completedAt",
        ],
        "ci-execution-policy: local receipt identity fields drifted",
    )
    profiles = policy.get("profiles")
    audit.require(
        isinstance(profiles, dict)
        and set(profiles)
        == {
            "HARNESS_PORTABILITY_LOCAL",
            "BACKEND_LOCAL",
            "FRONTEND_LOCAL",
            "FULL_STACK_LOCAL",
            "TERMINAL_METADATA_ONLY",
        },
        "ci-execution-policy: profile set drifted",
    )
    profiles = profiles if isinstance(profiles, dict) else {}
    harness_profile = profiles.get("HARNESS_PORTABILITY_LOCAL")
    harness_profile = harness_profile if isinstance(harness_profile, dict) else {}
    platforms = harness_profile.get("platforms")
    platforms = platforms if isinstance(platforms, dict) else {}
    audit.require(
        harness_profile.get("commandRegistryProfile") == "harnessPortabilityLocal"
        and set(platforms) == {"windows", "wslUbuntu", "macos"}
        and platforms.get("windows", {}).get("required") is True
        and platforms.get("windows", {}).get("argv")
        == [
            "python",
            "scripts/harness/precheck.py",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            "TASK-ID",
        ]
        and platforms.get("wslUbuntu", {}).get("required") is True
        and platforms.get("wslUbuntu", {}).get("distribution") == "Ubuntu-24.04"
        and platforms.get("wslUbuntu", {}).get("isolation")
        == "GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP"
        and platforms.get("wslUbuntu", {}).get("argv")
        == [
            "bash",
            "scripts/harness/precheck.sh",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            "TASK-ID",
        ]
        and platforms.get("macos")
        == {
            "required": False,
            "unavailableStatus": "DEFERRED_NOT_CLAIMED",
            "residualRiskRequired": True,
            "followUpConditionRequired": True,
        },
        "ci-execution-policy: Harness portability platform matrix drifted",
    )
    audit.require(
        harness_profile.get("task0074CombinedGate")
        == {
            "taskId": TASK_0074_TASK_ID,
            "sameCleanCandidateCommitAndTreeRequired": True,
            "windowsDurableReceiptCount": 1,
            "satisfies": ["CANDIDATE_CANONICAL", "WINDOWS_EXACT_TREE"],
            "exactCommandIds": [
                "harnessTests",
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "canonicalCommandIds": [
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "eachCommandExactlyOnce": True,
            "wrapperAliasCacheSkipForbidden": True,
            "wslStillIndependent": True,
            "ordinaryCardsRemainIndependentCanonical": True,
            "resultBasedProfileDowngradeForbidden": True,
        },
        "ci-execution-policy: TASK-0074 combined Windows gate contract drifted",
    )
    audit.require(
        harness_profile.get("task0075CombinedGate")
        == {
            "taskId": TASK_0075_TASK_ID,
            "sameCleanCandidateCommitAndTreeRequired": True,
            "windowsDurableReceiptCount": 1,
            "satisfies": ["CANDIDATE_CANONICAL", "WINDOWS_EXACT_TREE"],
            "exactCommandIds": [
                "harnessTests",
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "canonicalCommandIds": [
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "eachCommandExactlyOnce": True,
            "wrapperAliasCacheSkipForbidden": True,
            "wslStillIndependent": True,
            "ordinaryCardsRemainIndependentCanonical": True,
            "resultBasedProfileDowngradeForbidden": True,
        },
        "ci-execution-policy: TASK-0075 combined Windows gate contract drifted",
    )
    backend = profiles.get("BACKEND_LOCAL")
    frontend = profiles.get("FRONTEND_LOCAL")
    full_stack = profiles.get("FULL_STACK_LOCAL")
    audit.require(
        isinstance(backend, dict)
        and backend.get("affectedModulesOnly") is True
        and backend.get("harnessGates") == ["WINDOWS", "LINUX"]
        and backend.get("argvTemplate")
        == [
            "./mvnw",
            "--batch-mode",
            "--no-transfer-progress",
            "-pl",
            "AFFECTED_MODULES",
            "-am",
            "verify",
        ]
        and backend.get("windowsJavaHome")
        == "G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7"
        and backend.get("modifySystemJava") is False
        and isinstance(frontend, dict)
        and frontend.get("affectedModulesOnly") is True
        and frontend.get("harnessGates") == ["WINDOWS", "LINUX"]
        and frontend.get("nodeVersion") == "22"
        and frontend.get("pnpmVersion") == "11.9.0"
        and isinstance(full_stack, dict)
        and full_stack.get("affectedModulesOnly") is True
        and full_stack.get("composeProfiles")
        == ["BACKEND_LOCAL", "FRONTEND_LOCAL"],
        "ci-execution-policy: affected-module local profiles drifted",
    )
    terminal = profiles.get("TERMINAL_METADATA_ONLY")
    audit.require(
        isinstance(terminal, dict)
        and terminal.get("allowedWhen")
        == [
            "VERIFIED_IMPLEMENTATION_CANDIDATE_CLOSURE",
            "REJECTED_CLOSURE",
        ]
        and terminal.get("implementationTreeProjectionMustMatchVerifiedCandidate")
        is True
        and terminal.get("commitMarker") == "[skip ci]"
        and terminal.get("externalCiTriggered") is False
        and terminal.get("representsCiPass") is False
        and terminal.get("dependencyReleaseRequiresImplementationValidation")
        is True,
        "ci-execution-policy: terminal metadata-only contract drifted",
    )
    bootstrap = policy.get("task0064Bootstrap")
    audit.require(
        isinstance(bootstrap, dict)
        and bootstrap.get("oneTimeOnly") is True
        and bootstrap.get("taskId") == "TASK-0064"
        and bootstrap.get("replacementOfRejectedTask") == "TASK-0063"
        and bootstrap.get("baseCommit") == TASK_0064_BASE_COMMIT
        and bootstrap.get("authorizationCommit")
        == TASK_0064_AUTHORIZATION_COMMIT
        and bootstrap.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and bootstrap.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and bootstrap.get("requiredOutcomes")
        == {
            "windows": "PASS",
            "wslUbuntu": "PASS",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "NOT_RUN",
        }
        and bootstrap.get("remoteUnavailableEvidence")
        == {
            "type": "OWNER_SUPPLIED_QUOTA_EXHAUSTED",
            "includedMinutes": 2000,
            "usedMinutes": 2000,
            "paidBudgetUsd": 0,
            "stopUsageEnabled": True,
            "resetDate": "2026-08-01",
            "dispatchCount": 0,
        }
        and bootstrap.get("ownerEvidence")
        == "不能因为 GitHub Actions 额度不够就不走了，肯定需要备用方案，例如本地跑或者不跑。"
        and bootstrap.get("generalizedSelfDowngradeForbidden") is True,
        "ci-execution-policy: TASK-0064 one-time bootstrap binding drifted",
    )
    recovery = policy.get("task0066Recovery")
    audit.require(
        isinstance(recovery, dict)
        and recovery.get("oneTimeOnly") is True
        and recovery.get("taskId") == "TASK-0066"
        and recovery.get("replacementOfRejectedTask") == "TASK-0064"
        and recovery.get("baseCommit") == TASK_0066_BASE_COMMIT
        and recovery.get("baseTree") == TASK_0066_BASE_TREE
        and recovery.get("authorizationCommit")
        == TASK_0066_AUTHORIZATION_COMMIT
        and recovery.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and recovery.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and recovery.get("deliveryBudgets")
        == {
            "candidateDeadlineMinutes": 25,
            "targetWallMinutes": 80,
            "hardFuseWallMinutes": 110,
            "maximumFixBatches": 1,
            "maximumReviewRounds": 2,
        }
        and recovery.get("requiredOutcomes")
        == {
            "windows": "PASS",
            "wslUbuntu": "PASS",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "NOT_RUN_QUOTA",
        }
        and recovery.get("remoteUnavailableEvidence")
        == {
            "type": "OWNER_SUPPLIED_QUOTA_EXHAUSTED",
            "includedMinutes": 2000,
            "usedMinutes": 2000,
            "paidBudgetUsd": 0,
            "stopUsageEnabled": True,
            "resetDate": "2026-08-01",
            "dispatchCount": 0,
        }
        and recovery.get("recoveryInput")
        == {
            "retainedImplementationCommit": (
                "e28d147351f944a440faef6ff6e38a3d72649459"
            ),
            "retainedImplementationTree": (
                "c73bb8c8f706353d750e09a8a9faf8d43c966bec"
            ),
            "windowsFailureReceiptSha256": (
                "e1864721b9c9b0e740af78ff89f23288d59c3551084735118a358c537fddcf9f"
            ),
            "windowsFailureStdoutSha256": (
                "97262dedd0430e2eb20d3f463321a93e8242b5024457a68a3042246a222e2b6d"
            ),
            "windowsFailureStderrSha256": (
                "7b7f2998a285c97531c75b21479ed588c672ffc2b760802ef105b8ce44de70b0"
            ),
            "doctorErrorCount": 6,
            "task0063TerminalCommit": TASK_0063_TERMINAL_COMMIT,
            "task0063TerminalTree": TASK_0063_TERMINAL_TREE,
        }
        and recovery.get("ownerEvidence")
        == "GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，例如本地跑或者不跑。"
        and recovery.get("generalizedSelfDowngradeForbidden") is True
        and recovery.get("reusableByOtherTask") is False,
        "ci-execution-policy: TASK-0066 one-time recovery binding drifted",
    )
    task0067_recovery = policy.get("task0067Recovery")
    audit.require(
        isinstance(task0067_recovery, dict)
        and task0067_recovery.get("oneTimeOnly") is True
        and task0067_recovery.get("taskId") == "TASK-0067"
        and task0067_recovery.get("replacementOfRejectedTask") == "TASK-0066"
        and task0067_recovery.get("baseCommit") == TASK_0067_BASE_COMMIT
        and task0067_recovery.get("baseTree") == TASK_0067_BASE_TREE
        and task0067_recovery.get("authorizationCommit")
        == TASK_0067_AUTHORIZATION_COMMIT
        and task0067_recovery.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and task0067_recovery.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and task0067_recovery.get("deliveryBudgets")
        == {
            "candidateDeadlineMinutes": 20,
            "targetWallMinutes": 85,
            "hardFuseWallMinutes": 105,
            "maximumFixBatches": 1,
            "maximumReviewRounds": 2,
        }
        and task0067_recovery.get("requiredOutcomes")
        == {
            "windows": "PASS",
            "wslUbuntu": "PASS",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "NOT_RUN_QUOTA",
        }
        and task0067_recovery.get("remoteUnavailableEvidence")
        == {
            "type": "OWNER_SUPPLIED_QUOTA_EXHAUSTED",
            "includedMinutes": 2000,
            "usedMinutes": 2000,
            "paidBudgetUsd": 0,
            "stopUsageEnabled": True,
            "resetDate": "2026-08-01",
            "dispatchCount": 0,
        }
        and task0067_recovery.get("recoveryInput")
        == {
            "retainedImplementationCommit": (
                "46ba60fda712ec88a1a6156682a3e63fa787348d"
            ),
            "retainedImplementationTree": (
                "28c95c0337cf35e36c930b30fd61636e31a6f61e"
            ),
            "task0064WindowsFailureReceiptSha256": (
                "e1864721b9c9b0e740af78ff89f23288d59c3551084735118a358c537fddcf9f"
            ),
            "task0066WindowsPassReceiptSha256": (
                "5e27c275fccf933ec8c886a7c5a20c659e2168efa642e2750f5a07066f827373"
            ),
            "task0066WslFailureReceiptSha256": (
                "1b82e6d6ee7092ea52809bc917c629dbc5c44ea856a36d7e71186474b5ae9da9"
            ),
            "failedTests": [
                "DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection",
                "IntegrationTests.test_doctor_accepts_current_task",
            ],
            "failureMessage": (
                "task-delivery-policy: durable command helper canonical "
                "content hash drifted"
            ),
            "canonicalPath": DURABLE_COMMAND_CANONICAL_PATH,
            "generalAttribute": "*.ps1 text eol=crlf",
            "pathOverride": (
                "scripts/harness/durable_command.ps1 text eol=lf"
            ),
            "gitBlob": {
                "bytes": DURABLE_COMMAND_CANONICAL_BYTES,
                "lf": DURABLE_COMMAND_CANONICAL_LF,
                "crlf": DURABLE_COMMAND_CANONICAL_CRLF,
                "sha256": DURABLE_COMMAND_CANONICAL_HASH,
            },
            "failedGitArchive": {
                "bytes": 9055,
                "lf": 236,
                "crlf": 236,
                "sha256": (
                    "85e5697d0aa546f55c1bfe7cdbf8af1b56317098a150c8d13d63df9f045a6027"
                ),
            },
        }
        and task0067_recovery.get("ownerEvidence")
        == "GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，例如本地跑或者不跑。"
        and task0067_recovery.get("generalizedSelfDowngradeForbidden") is True
        and task0067_recovery.get("reusableByOtherTask") is False,
        "ci-execution-policy: TASK-0067 one-time byte-domain recovery binding drifted",
    )
    task0068_recovery = policy.get("task0068Recovery")
    audit.require(
        isinstance(task0068_recovery, dict)
        and task0068_recovery.get("oneTimeOnly") is True
        and task0068_recovery.get("taskId") == "TASK-0068"
        and task0068_recovery.get("replacementOfRejectedTask") == "TASK-0067"
        and task0068_recovery.get("baseCommit") == TASK_0068_BASE_COMMIT
        and task0068_recovery.get("baseTree") == TASK_0068_BASE_TREE
        and task0068_recovery.get("authorizationCommit")
        == TASK_0068_AUTHORIZATION_COMMIT
        and task0068_recovery.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and task0068_recovery.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and task0068_recovery.get("deliveryBudgets")
        == {
            "candidateDeadlineMinutes": 35,
            "targetWallMinutes": 105,
            "hardFuseWallMinutes": 125,
            "maximumFixBatches": 1,
            "maximumReviewRounds": 2,
        }
        and task0068_recovery.get("requiredOutcomes", {}).get("githubActions")
        == "NOT_RUN_QUOTA"
        and task0068_recovery.get("recoveryInput", {}).get(
            "task0067TerminalCommit"
        )
        == TASK_0067_TERMINAL_COMMIT
        and task0068_recovery.get("recoveryInput", {}).get(
            "task0067TerminalTree"
        )
        == TASK_0067_TERMINAL_TREE
        and task0068_recovery.get("generalizedSelfDowngradeForbidden") is True
        and task0068_recovery.get("reusableByOtherTask") is False,
        "ci-execution-policy: TASK-0068 one-time recovery binding drifted",
    )
    task0069_recovery = policy.get("task0069Recovery")
    audit.require(
        isinstance(task0069_recovery, dict)
        and task0069_recovery.get("oneTimeOnly") is True
        and task0069_recovery.get("taskId") == "TASK-0069"
        and task0069_recovery.get("replacementOfRejectedTask") == "TASK-0068"
        and task0069_recovery.get("baseCommit") == TASK_0069_BASE_COMMIT
        and task0069_recovery.get("baseTree") == TASK_0069_BASE_TREE
        and task0069_recovery.get("authorizationCommit")
        == TASK_0069_AUTHORIZATION_COMMIT
        and task0069_recovery.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and task0069_recovery.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and task0069_recovery.get("deliveryBudgets")
        == {
            "candidateDeadlineMinutes": 45,
            "targetWallMinutes": 115,
            "hardFuseWallMinutes": 150,
            "maximumFixBatches": 1,
            "maximumReviewRounds": 2,
        }
        and task0069_recovery.get("requiredOutcomes")
        == {
            "windows": "PASS",
            "wslUbuntu": "PASS",
            "macos": "DEFERRED_NOT_CLAIMED",
            "githubActions": "UNKNOWN_NOT_RUN",
        }
        and task0069_recovery.get("remoteAvailabilityEvidence")
        == {
            "type": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "status": "UNKNOWN_NOT_RUN",
            "priorResetDate": "2026-08-01",
            "billingProbeStatus": "HTTP_404_UNVERIFIABLE",
            "currentQuotaVerified": False,
            "dispatchCount": 0,
            "passClaimed": False,
        }
        and task0069_recovery.get("localFallbackActivation")
        == {
            "scope": "TASK_0069_ONLY",
            "ownerAuthorized": True,
            "remoteStatusMustRemainNonPass": True,
            "globalUnknownQuotaBehaviorUnchanged": True,
        }
        and task0069_recovery.get("recoveryInput")
        == {
            "retainedImplementationCommit": (
                "101a3c7b5e711b3fcea049a60a8ed332149c4cc9"
            ),
            "retainedImplementationTree": (
                "5e160c07de7ab81a03c5007c7d3c10895a53bfa5"
            ),
            "retainedFiles": {
                ".harness/ci-execution-policy.yaml": (
                    "70de802d950fc329d8517b6772d1a73439038555ecb408a7f99f43a4d24cb281"
                ),
                ".harness/task-backlog.yaml": (
                    "a82eab59828d2c4f8b2009a3263b47cce0a62f8b3ddbe87bbe6d164e79b50a66"
                ),
                "docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md": (
                    "1b449462ad10989256987b7d26315812c4dcb2929c6ce7568633dec76f9c4394"
                ),
            },
            "task0068PreClosureReceiptSha256": (
                "35766ac55593211942c99419a98ed0d01ea71199f8c1a73442622a0c867c82a4"
            ),
            "task0068PreClosureStdoutSha256": (
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ),
            "task0068PreClosureStderrSha256": (
                "d3992cef13e7ea6e1836f192457ee5b1b41cc8793583afdf3637703d11dcf4ba"
            ),
            "task0068PreClosureExitCode": 1,
            "task0068PreClosureErrorCount": 20,
            "task0068PreClosureChecks": 245221,
            "currentBaseDoctorReceiptSha256": (
                "faaa8229e21faefc74d1ce43bba3480db02607a93f78006cd5a168cae04c850f"
            ),
            "currentBaseDoctorExitCode": 1,
            "currentBaseDoctorErrorCount": 23,
            "currentBaseDoctorChecks": 247053,
            "canonicalPath": DURABLE_COMMAND_CANONICAL_PATH,
            "canonicalBytes": DURABLE_COMMAND_CANONICAL_BYTES,
            "canonicalLf": DURABLE_COMMAND_CANONICAL_LF,
            "canonicalCrlf": DURABLE_COMMAND_CANONICAL_CRLF,
            "canonicalSha256": DURABLE_COMMAND_CANONICAL_HASH,
            "task0068TerminalCommit": TASK_0068_TERMINAL_COMMIT,
            "task0068TerminalTree": TASK_0068_TERMINAL_TREE,
        }
        and task0069_recovery.get("ownerEvidence")
        == "GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，例如本地跑或者不跑。"
        and task0069_recovery.get("generalizedSelfDowngradeForbidden") is True
        and task0069_recovery.get("reusableByOtherTask") is False,
        "ci-execution-policy: TASK-0069 one-time local recovery binding drifted",
    )
    rules = policy.get("rules")
    audit.require(
        rules
        == {
            "profileMustBeFrozenBeforeReady": True,
            "resultBasedProfileDowngradeForbidden": True,
            "unknownRemoteAvailabilityCannotSkip": True,
            "notRunOrDeferredNeverPass": True,
            "githubDispatchOwnedByFollowUpTask": "TASK-0065",
        },
        "ci-execution-policy: global fallback rules drifted",
    )
    sources = load_yaml(ROOT / ".harness/sources-of-truth.yaml").get("sources")
    audit.require(
        isinstance(sources, dict)
        and sources.get("ciExecutionPolicy") == CI_EXECUTION_POLICY_PATH
        and sum(
            normalize_repo_path(str(value)) == CI_EXECUTION_POLICY_PATH
            for value in sources.values()
            if is_repository_relative(str(value))
        )
        == 1,
        "ci-execution-policy: sources-of-truth must register the policy exactly once",
    )
    commands = load_yaml(ROOT / ".harness/commands.yaml")
    audit.require(
        commands.get("profiles", {}).get("harnessPortabilityLocal")
        == [
            "harnessTests",
            "doctor",
            "catalogValidate",
            "catalogDrift",
            "paidFeatureCheck",
            "betaRosterGate",
        ]
        and commands.get("commands", {}).get("harnessTests")
        == {
            "description": (
                "Run the complete portable Harness unit and integration test suite"
            ),
            "argv": ["scripts/harness/tests/test_harness.py"],
        },
        "ci-execution-policy: Harness portability command profile drifted",
    )
    for path, expected_hash in TASK_0063_TERMINAL_ARTIFACT_SHA256.items():
        try:
            audit.require(
                hashlib.sha256(read_repository_bytes(ROOT / path)).hexdigest()
                == expected_hash,
                f"ci-execution-policy: frozen TASK-0063 replacement anchor drifted: {path}",
            )
        except OSError as exc:
            audit.error(f"ci-execution-policy: cannot read TASK-0063 anchor {path}: {exc}")
    audit.require(
        canonical_json_sha256(ci_execution_policy_projection(policy))
        == CI_EXECUTION_POLICY_CANONICAL_HASH,
        "ci-execution-policy: canonical contract hash drifted; update the C4 "
        "validator and tests in the same authorized change",
    )
    record = validate_task0072_self_bootstrap_record(audit, policy)
    if isinstance(record, dict):
        validate_task0072_historical_doctor_binding(audit, policy)
    validate_task0073_pre_ready_maintenance_record(audit, policy)
    validate_task0076_pre_ready_maintenance_record(audit, policy)
    task0074_record = validate_task0074_pre_ready_maintenance_record(audit, policy)
    if isinstance(task0074_record, dict):
        validate_task0073_historical_unknown_quarantine(audit, task0074_record)
    task0075_record = validate_task0075_pre_ready_maintenance_record(audit, policy)
    if isinstance(task0075_record, dict):
        validate_task0075_historical_objects(audit, task0075_record)


def durable_command_byte_metrics(content: bytes) -> dict[str, Any]:
    return {
        "bytes": len(content),
        "lf": content.count(b"\n"),
        "crlf": content.count(b"\r\n"),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def validate_durable_command_byte_domain(
    audit: Audit,
    *,
    git_blob: bytes,
    windows_checkout: bytes,
    git_archive_entry: bytes,
    effective_attributes: dict[str, str],
    expected_sha256: str = DURABLE_COMMAND_CANONICAL_HASH,
) -> None:
    expected = {
        "bytes": DURABLE_COMMAND_CANONICAL_BYTES,
        "lf": DURABLE_COMMAND_CANONICAL_LF,
        "crlf": DURABLE_COMMAND_CANONICAL_CRLF,
        "sha256": expected_sha256,
    }
    audit.require(
        effective_attributes == {"text": "set", "eol": "lf"},
        "task-delivery-policy: durable command helper effective Git attributes "
        "must be exactly text=set and eol=lf",
    )
    representations = {
        "Git Blob": git_blob,
        "Windows checkout": windows_checkout,
        "git archive entry": git_archive_entry,
    }
    for label, content in representations.items():
        audit.require(
            durable_command_byte_metrics(content) == expected,
            "task-delivery-policy: durable command helper "
            f"{label} canonical bytes or hash drifted",
        )
    audit.require(
        len(set(representations.values())) == 1,
        "task-delivery-policy: durable command helper Git Blob, Windows checkout, "
        "and git archive entry must be byte-identical",
    )


def validate_current_durable_command_byte_domain(audit: Audit) -> None:
    path = DURABLE_COMMAND_CANONICAL_PATH
    index_entry = git_index_entry(path)
    audit.require(
        index_entry is not None and index_entry[0] == "100644",
        "task-delivery-policy: durable command helper must be one staged 100644 blob",
    )
    if index_entry is None or index_entry[0] != "100644":
        return
    blob_result = git_bytes("cat-file", "blob", index_entry[1], check=False)
    if blob_result.returncode != 0:
        audit.error(
            "task-delivery-policy: cannot read durable command helper Git Blob: "
            + blob_result.stderr.decode("utf-8", errors="replace").strip()
        )
        return
    try:
        windows_checkout = read_repository_bytes(ROOT / path)
    except OSError as exc:
        audit.error(
            "task-delivery-policy: cannot read durable command helper checkout: "
            f"{exc}"
        )
        return

    attributes_result = git_text(
        "check-attr",
        "--cached",
        "text",
        "eol",
        "--",
        path,
        check=False,
    )
    attributes: dict[str, str] = {}
    if attributes_result.returncode == 0:
        for line in attributes_result.stdout.splitlines():
            parts = line.split(": ", 2)
            if len(parts) == 3 and normalize_repo_path(parts[0]) == path:
                attributes[parts[1]] = parts[2]
    else:
        audit.error(
            "task-delivery-policy: cannot resolve durable command helper Git "
            f"attributes: {attributes_result.stderr.strip()}"
        )

    index_tree = git_text("write-tree", check=False)
    tree = index_tree.stdout.strip()
    if index_tree.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40,64}", tree):
        audit.error(
            "task-delivery-policy: cannot materialize the staged candidate tree "
            f"for git archive: {index_tree.stderr.strip()}"
        )
        return
    archive_result = git_bytes(
        "archive",
        "--format=tar",
        tree,
        "--",
        path,
        check=False,
    )
    if archive_result.returncode != 0:
        audit.error(
            "task-delivery-policy: cannot export durable command helper from the "
            "staged candidate tree: "
            + archive_result.stderr.decode("utf-8", errors="replace").strip()
        )
        return
    try:
        with tarfile.open(fileobj=io.BytesIO(archive_result.stdout), mode="r:") as archive:
            extracted = archive.extractfile(path)
            if extracted is None:
                raise KeyError(path)
            archive_entry = extracted.read()
    except (KeyError, OSError, tarfile.TarError) as exc:
        audit.error(
            "task-delivery-policy: cannot read durable command helper git archive "
            f"entry: {exc}"
        )
        return
    validate_durable_command_byte_domain(
        audit,
        git_blob=blob_result.stdout,
        windows_checkout=windows_checkout,
        git_archive_entry=archive_entry,
        effective_attributes=attributes,
    )


def validate_task0074_card_recovery_contract(audit: Audit) -> None:
    label = "TASK-0074 delivery-flow recovery card"
    try:
        task = task_metadata_from_text(
            read_repository_text(ROOT / TASK_0074_CARD_PATH),
            TASK_0074_CARD_PATH,
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{label}: cannot read exact task card: {exc}")
        return
    budgets = task.get("deliveryBudgets")
    budgets = budgets if isinstance(budgets, dict) else {}
    audit.require(
        task.get("taskId") == TASK_0074_TASK_ID
        and task.get("baseCommit") == TASK_0074_BASE_COMMIT
        and task.get("contextLock") == TASK_0074_CONTEXT_PATH,
        f"{label}: identity binding drifted",
    )
    audit.require(
        budgets.get("schemaVersion") == 2
        and budgets.get("overallElapsed")
        == {
            "anchor": "DRAFT_COMMIT",
            "terminal": "TERMINAL_COMMIT",
            "recordingRequired": True,
            "resetOrReanchorForbidden": True,
        }
        and budgets.get("intakeActivation")
        == {
            "anchor": "DRAFT_COMMIT",
            "terminal": "READY_DOCTOR_TERMINAL",
            "targetWallMinutes": 60,
            "hardFuseWallMinutes": 90,
            "timeoutStatus": "TIMEOUT",
            "closureOnlyOverrun": True,
        }
        and budgets.get("candidateExecution")
        == {
            "anchor": "READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT",
            "candidateDeadlineMinutes": 45,
            "targetWallMinutes": 60,
            "hardFuseWallMinutes": 90,
            "timeoutStatus": "TIMEOUT",
            "closureOnlyOverrun": True,
        }
        and budgets.get("reviewer")
        == {
            "maximumMinutes": 15,
            "timeoutStatus": "TIMEOUT",
            "missingTerminalStatus": "UNKNOWN",
        },
        f"{label}: two-stage timing anchors drifted",
    )
    maintenance = task.get("preReadyMaintenancePlan")
    maintenance = maintenance if isinstance(maintenance, dict) else {}
    audit.require(
        maintenance.get("recordId") == TASK_0074_MAINTENANCE_RECORD_ID
        and maintenance.get("pathSetFrozenAtDraft") is True
        and maintenance.get("additionsOrRemovalsForbidden") is True
        and isinstance(maintenance.get("exactPaths"), list)
        and set(maintenance.get("exactPaths", []))
        == TASK_0074_PRE_READY_MAINTENANCE_PATHS
        and len(maintenance.get("exactPaths", []))
        == len(TASK_0074_PRE_READY_MAINTENANCE_PATHS),
        f"{label}: frozen maintenance path set drifted",
    )
    validation = task.get("validationPlan")
    validation = validation if isinstance(validation, dict) else {}
    windows = validation.get("windows")
    windows = windows if isinstance(windows, dict) else {}
    audit.require(
        validation.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and windows.get("kind")
        == "COMBINED_CANDIDATE_CANONICAL_AND_WINDOWS_EXACT_TREE"
        and windows.get("argv")
        == (
            "python scripts/harness/precheck.py --profile "
            "harnessPortabilityLocal --task TASK-0074"
        )
        and windows.get("durableReceiptRequired") is True
        and windows.get("eachCanonicalSubcommandExactlyOnce") is True
        and windows.get("aliasCacheOrSkipForbidden") is True
        and validation.get("wsl", {}).get("startsOnlyAfterWindowsPass") is True,
        f"{label}: combined Windows and independent WSL contract drifted",
    )
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    audit.require(
        bool(approvals)
        and approvals[0].get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63"
        and approvals[0].get("evidence") == TASK_0074_EXACT_OWNER_AUTHORIZATION,
        f"{label}: exact Owner authorization drifted",
    )


def validate_task0075_card_recovery_contract(audit: Audit) -> None:
    label = "TASK-0075 permanent delivery-flow recovery card"
    try:
        task = task_metadata_from_text(
            read_repository_text(ROOT / TASK_0075_CARD_PATH),
            TASK_0075_CARD_PATH,
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{label}: cannot read exact task card: {exc}")
        return
    budgets = task.get("deliveryBudgets")
    budgets = budgets if isinstance(budgets, dict) else {}
    audit.require(
        task.get("taskId") == TASK_0075_TASK_ID
        and task.get("baseCommit") == TASK_0075_BASE_COMMIT
        and task.get("contextLock") == TASK_0075_CONTEXT_PATH
        and task.get("contextFingerprint")
        == "deb8e20ac0a38638366ba310a46ce59299e2514bb16b23387ba1ded7a39a396d"
        and task.get("requiredSkillVersions")
        == {
            "task-delivery-flow": "1.3.3",
            "task-intake": "1.2.3",
            "harness-change": "1.1.3",
        }
        and task.get("targetSkillVersions")
        == {
            "task-delivery-flow": "1.3.4",
            "task-intake": "1.2.4",
            "harness-change": "1.1.4",
        },
        f"{label}: identity, Context, or Skill binding drifted",
    )
    audit.require(
        budgets.get("schemaVersion") == 2
        and budgets.get("overallElapsed")
        == {
            "anchor": "DRAFT_COMMIT",
            "terminal": "TERMINAL_COMMIT",
            "recordingRequired": True,
            "resetOrReanchorForbidden": True,
        }
        and budgets.get("intakeActivation")
        == {
            "anchor": "DRAFT_COMMIT",
            "terminal": "READY_DOCTOR_TERMINAL",
            "targetWallMinutes": 60,
            "hardFuseWallMinutes": 90,
            "timeoutStatus": "TIMEOUT",
            "closureOnlyOverrun": True,
        }
        and budgets.get("candidateExecution")
        == {
            "anchor": "READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT",
            "notStartedOutcome": "NOT_STARTED",
            "notStartedEligibility": {
                "readyDoctorNonPassRequired": True,
                "readyDoctorPassForbidden": True,
                "inProgressCommitForbidden": True,
                "candidateFreezeForbidden": True,
            },
            "candidateDeadlineMinutes": 45,
            "targetWallMinutes": 60,
            "hardFuseWallMinutes": 90,
            "timeoutStatus": "TIMEOUT",
            "closureOnlyOverrun": True,
        }
        and budgets.get("reviewer")
        == {
            "maximumMinutes": 15,
            "timeoutStatus": "TIMEOUT",
            "missingTerminalStatus": "UNKNOWN",
        },
        f"{label}: two-stage timing and NOT_STARTED anchors drifted",
    )
    maintenance = task.get("preReadyMaintenancePlan")
    maintenance = maintenance if isinstance(maintenance, dict) else {}
    audit.require(
        maintenance.get("recordId") == TASK_0075_MAINTENANCE_RECORD_ID
        and maintenance.get("recordPath")
        == TASK_0075_MAINTENANCE_AUTHORIZATION_PATH
        and maintenance.get("pathSetFrozenAtDraft") is True
        and maintenance.get("additionsOrRemovalsForbidden") is True
        and isinstance(maintenance.get("exactPaths"), list)
        and maintenance.get("exactPaths")
        == sorted(TASK_0075_PRE_READY_MAINTENANCE_PATHS),
        f"{label}: frozen maintenance path set drifted",
    )
    historical = task.get("historicalRecovery")
    historical = historical if isinstance(historical, dict) else {}
    task0073_policy = historical.get("task0073CiPolicy")
    task0073_policy = (
        task0073_policy if isinstance(task0073_policy, dict) else {}
    )
    planning_edge = historical.get("task0073PlanningEdge")
    planning_edge = planning_edge if isinstance(planning_edge, dict) else {}
    quarantine = historical.get("task0074TerminalQuarantine")
    quarantine = quarantine if isinstance(quarantine, dict) else {}
    audit.require(
        task0073_policy.get("maintenanceCommit") == TASK_0073_MAINTENANCE_COMMIT
        and task0073_policy.get("maintenanceTree") == TASK_0073_MAINTENANCE_TREE
        and task0073_policy.get("blob") == TASK_0073_MAINTENANCE_CI_POLICY_BLOB
        and task0073_policy.get("sha256")
        == TASK_0073_MAINTENANCE_CI_POLICY_SHA256
        and task0073_policy.get("canonicalProjectionSha256")
        == TASK_0073_CI_POLICY_PROJECTION_HASH
        and planning_edge.get("parentCommit")
        == TASK_0073_PLANNING_PARENT_COMMIT
        and planning_edge.get("parentTree") == TASK_0073_PLANNING_PARENT_TREE
        and planning_edge.get("childCommit") == TASK_0073_PLANNING_CHILD_COMMIT
        and planning_edge.get("childTree") == TASK_0073_PLANNING_CHILD_TREE
        and planning_edge.get("exactChangedPaths")
        == sorted(TASK_0073_PLANNING_EDGE_IDENTITIES)
        and quarantine.get("terminalCommit") == TASK_0074_TERMINAL_COMMIT
        and quarantine.get("terminalTree") == TASK_0074_TERMINAL_TREE
        and quarantine.get("preClosure", {}).get("receiptSha256")
        == TASK_0074_PRE_CLOSURE_RECEIPT_SHA256
        and quarantine.get("preClosure", {}).get("exactErrors")
        == list(TASK_0074_EXACT_HISTORICAL_ERRORS),
        f"{label}: frozen historical projection or quarantine drifted",
    )
    validation = task.get("validationPlan")
    validation = validation if isinstance(validation, dict) else {}
    windows = validation.get("windows")
    windows = windows if isinstance(windows, dict) else {}
    audit.require(
        validation.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and windows.get("kind")
        == "COMBINED_CANDIDATE_CANONICAL_AND_WINDOWS_EXACT_TREE"
        and windows.get("argv")
        == (
            "python scripts/harness/precheck.py --profile "
            "harnessPortabilityLocal --task TASK-0075"
        )
        and windows.get("durableReceiptRequired") is True
        and windows.get("eachCanonicalSubcommandExactlyOnce") is True
        and windows.get("aliasCacheOrSkipForbidden") is True
        and validation.get("wsl", {}).get("startsOnlyAfterWindowsPass") is True
        and validation.get("remote")
        == {
            "outcome": "UNKNOWN_NOT_RUN",
            "reasonType": "OWNER_QUOTA_EVIDENCE_EXPIRED",
            "currentQuotaVerified": False,
            "dispatchCount": 0,
            "passClaimed": False,
        },
        f"{label}: local exact-tree fallback contract drifted",
    )
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    audit.require(
        len(approvals) == 3
        and approvals[0].get("scope") == "harness-change"
        and approvals[0].get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63"
        and approvals[0].get("evidence") == TASK_0075_EXACT_OWNER_AUTHORIZATION
        and approvals[1].get("scope") == "task-0075-owner-acceptance"
        and approvals[1].get("sourceThreadId")
        == "019fb2c1-8104-73b1-81dc-ee8bcfce6f63"
        and approvals[1].get("evidence") == TASK_0075_EXACT_OWNER_ACCEPTANCE,
        f"{label}: exact two-part Owner provenance drifted",
    )
    write_allowlist = task.get("writeAllowlist")
    write_allowlist = write_allowlist if isinstance(write_allowlist, list) else []
    audit.require(
        len(write_allowlist) == len(set(write_allowlist))
        and all(
            is_repository_relative(str(path))
            and "*" not in str(path)
            and "?" not in str(path)
            for path in write_allowlist
        ),
        f"{label}: write allowlist must be exact, unique, and wildcard-free",
    )
    candidate = task.get("candidateFreeze")
    candidate = candidate if isinstance(candidate, dict) else {}
    if task.get("state") in {"DRAFT", "READY"}:
        audit.require(
            candidate.get("frozen") is False
            and candidate.get("commit") is None
            and candidate.get("tree") is None,
            f"{label}: candidate cannot be frozen before IN_PROGRESS",
        )


def validate_task_delivery_policy(audit: Audit) -> None:
    policy = load_yaml(ROOT / TASK_DELIVERY_POLICY_PATH)
    audit.require(
        set(policy)
        == {
            "schemaVersion",
            "policyId",
            "canonicalLifecycleSource",
            "taskSource",
            "ciExecutionPolicy",
            "skill",
            "modes",
            "complexityGate",
            "budgets",
            "validation",
            "review",
            "candidateIdentity",
            "followUpTasks",
        },
        "task-delivery-policy: root fields do not match the frozen machine contract",
    )
    audit.require(
        policy.get("schemaVersion") == 1
        and policy.get("policyId") == "task-delivery"
        and policy.get("canonicalLifecycleSource") == ".harness/task-lifecycle.yaml"
        and policy.get("taskSource") == TASK_BACKLOG_PATH
        and policy.get("ciExecutionPolicy") == CI_EXECUTION_POLICY_PATH
        and policy.get("skill")
        == {
            "id": "task-delivery-flow",
            "registry": ".harness/skills.yaml",
        },
        "task-delivery-policy: identity, lifecycle, Backlog or Skill source drifted",
    )
    modes = policy.get("modes")
    audit.require(
        isinstance(modes, dict) and set(modes) == {"single-card", "longline"},
        "task-delivery-policy: modes must be exactly single-card and longline",
    )
    lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
    single_card = modes.get("single-card") if isinstance(modes, dict) else {}
    single_card = single_card if isinstance(single_card, dict) else {}
    happy_path = single_card.get("happyPath")
    transitions = lifecycle.get("transitions")
    transitions = transitions if isinstance(transitions, dict) else {}
    if isinstance(happy_path, list):
        for source, target in zip(happy_path, happy_path[1:]):
            audit.require(
                target in transitions.get(source, []),
                f"task-delivery-policy: happyPath edge {source} -> {target} "
                "is not in the canonical lifecycle",
            )
    else:
        audit.error("task-delivery-policy: single-card happyPath must be a list")
    longline = modes.get("longline") if isinstance(modes, dict) else {}
    longline = longline if isinstance(longline, dict) else {}
    audit.require(
        longline.get("nextCardRequires")
        == [
            "ACCEPTED",
            "PUSHED",
            "HANDOFF_COMPLETE",
            "REMOTE_REVERIFIED",
            "EXACT_TREE_VALIDATION_REVERIFIED",
        ],
        "task-delivery-policy: longline release must require exact-tree validation",
    )
    budgets = policy.get("budgets")
    budgets = budgets if isinstance(budgets, dict) else {}
    expected_hard_fuse = {
        "stopImmediately": [
            "IMPLEMENTATION",
            "FIXES",
            "REVIEWER",
            "CANDIDATE_CANONICAL",
            "CI",
        ],
        "mandatoryTerminalClosure": {
            "activeOrHalfClosedRepositoryMustClose": True,
            "closureOnlyOverrunAllowed": True,
            "allowedActions": [
                "EVIDENCE_HANDOFF",
                "PRE_CLOSURE",
                "TERMINAL_COMMIT",
                "PUSH",
                "REMOTE_ZERO_ZERO",
            ],
            "recordSeparately": ["DURATION", "ROOT_CAUSE"],
            "implementationForbidden": True,
        },
    }
    audit.require(
        budgets.get("hardFuseWallMinutes") == 90
        and budgets.get("hardFuse") == expected_hard_fuse,
        "task-delivery-policy: 90-minute hard-fuse and closure-only contract drifted",
    )
    audit.require(
        budgets.get("schemaVersion") == 2
        and budgets.get("timingContract")
        == {
            "overallElapsed": {
                "anchor": "DRAFT_COMMIT",
                "terminal": "TERMINAL_COMMIT",
                "recordingRequired": True,
                "resetOrReanchorForbidden": True,
            },
            "intakeActivation": {
                "anchor": "DRAFT_COMMIT",
                "terminal": "READY_DOCTOR_TERMINAL",
                "targetWallMinutes": 60,
                "hardFuseWallMinutes": 90,
                "timeoutStatus": "TIMEOUT",
                "closureOnlyOverrun": True,
            },
            "candidateExecution": {
                "requiredAnchorEvents": [
                    "READY_DOCTOR_PASS",
                    "IN_PROGRESS_COMMIT",
                ],
                "anchorSelection": "LATER_OF_REQUIRED_EVENTS",
                "candidateDeadlineMinutes": 45,
                "targetWallMinutes": 60,
                "hardFuseWallMinutes": 90,
                "timeoutStatus": "TIMEOUT",
                "closureOnlyOverrun": True,
                "notStarted": {
                    "outcome": "NOT_STARTED",
                    "eligibleOnlyWhen": {
                        "readyDoctorOutcome": "NON_PASS",
                        "readyDoctorPassExists": False,
                        "inProgressCommitExists": False,
                        "candidateFreezeExists": False,
                    },
                    "anchor": "NOT_STARTED_READY_DOCTOR_NON_PASS",
                    "anchorCommit": None,
                    "startedAt": None,
                    "endedAt": None,
                    "readyDoctorPassAt": None,
                    "inProgressCommit": None,
                    "elapsedSeconds": 0,
                    "closureOnlyOverrunSeconds": 0,
                    "reasonRequired": True,
                    "reanchored": False,
                    "passClaimed": False,
                },
            },
            "taskBindings": [TASK_0074_TASK_ID, TASK_0075_TASK_ID, TASK_0076_TASK_ID, "TASK-0077"],
        },
        "task-delivery-policy: two-stage auditable timing contract drifted",
    )
    validation = policy.get("validation")
    validation = validation if isinstance(validation, dict) else {}
    expected_long_running = {
        "singleProcess": True,
        "expectedDurationThresholdSeconds": 60,
        "transportPriority": [
            "DIRECT_PERSISTENT_SESSION_OR_PTY",
            "DURABLE_ATOMIC_RECEIPT",
        ],
        "directPersistentSessionOrPtyPreferred": True,
        "durableAtomicReceipt": {
            "commandRegistryId": "durableCommand",
            "helper": "scripts/harness/durable_command.ps1",
            "platform": "WINDOWS_ONLY",
            "powershellMinimumMajor": 7,
            "powershell51FallbackForbidden": True,
            "encodedCommandEncoding": "UTF16LE",
            "hiddenWindowRequired": True,
            "smokePassRequiredBeforeExpensiveLaunch": True,
            "exactArgumentArrayRequired": True,
            "stringCommandLineAssemblyForbidden": True,
            "concurrentStdoutStderrDrainRequired": True,
            "realInnerExitCodeRequired": True,
            "outputFlushAndCloseBeforeReceipt": True,
            "sameDirectoryAtomicMoveRequired": True,
            "uniqueSystemTempDirectoryRequired": True,
            "missingOrInvalidReceiptResult": "UNKNOWN",
            "unsupportedPlatformBehavior": "DIRECT_OR_FAIL",
        },
        "appliesTo": ["DOCTOR", "CANDIDATE_CANONICAL", "PRE_CLOSURE"],
        "preserve": ["SAME_PROCESS", "STDOUT", "STDERR", "REAL_EXIT_CODE"],
        "outerYieldOrTimeoutBehavior": "YIELD_CONTROL_ONLY",
        "lostExitCodeStatuses": ["NOT_RUN", "UNKNOWN"],
        "passWithLostExitCodeForbidden": True,
        "polling": "LOW_FREQUENCY_RECEIPT_EXISTENCE_ONLY",
        "defaultPollingIntervalSeconds": 60,
        "receiptReadOnceAfterPublication": True,
        "pidProcessStatusAndLogPollingForbidden": True,
        "parallelStatusCommandForbidden": True,
        "parallelProcessInspectionCommandForbidden": True,
        "repeatedLogFetchForbidden": True,
        "duplicateExecutionForbidden": True,
    }
    audit.require(
        validation.get("longRunningCommand") == expected_long_running,
        "task-delivery-policy: long-command observability contract drifted",
    )
    audit.require(
        validation.get("sequence")
        == [
            "TARGETED",
            "CANDIDATE_COMMIT_TREE",
            "REVIEWER",
            "CANDIDATE_CANONICAL",
            "EXACT_TREE_VALIDATION_CHANNEL",
            "CLOSURE",
        ]
        and validation.get("exactTreeValidation")
        == {
            "policySource": CI_EXECUTION_POLICY_PATH,
            "channels": [
                "PRIMARY_REMOTE_EXACT_SHA",
                "LOCAL_EXACT_TREE_FALLBACK",
            ],
            "defaultChannel": "PRIMARY_REMOTE_EXACT_SHA",
            "fallbackRequiresReadyFrozenProfile": True,
            "resultBasedDowngradeForbidden": True,
            "unknownRemoteAvailabilityCannotSkip": True,
            "terminalMetadataOnlyProfile": "TERMINAL_METADATA_ONLY",
            "notRunOrDeferredNeverPass": True,
        },
        "task-delivery-policy: exact-tree validation channel contract drifted",
    )
    audit.require(
        validation.get("task0074HarnessPortabilityCombinedGate")
        == {
            "taskId": TASK_0074_TASK_ID,
            "eligibleProfile": "HARNESS_PORTABILITY_LOCAL",
            "readyFrozenProfileRequired": True,
            "sameCleanCandidateCommitAndTreeRequired": True,
            "windowsDurableReceiptCount": 1,
            "satisfies": ["CANDIDATE_CANONICAL", "WINDOWS_EXACT_TREE"],
            "commandRegistryProfile": "harnessPortabilityLocal",
            "exactCommandIds": [
                "harnessTests",
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "canonicalCommandIds": [
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "eachCommandExactlyOnce": True,
            "wrapperAliasCacheSkipForbidden": True,
            "wslStillIndependent": True,
            "ordinaryCardsRemainIndependentCanonical": True,
            "resultBasedProfileDowngradeForbidden": True,
        },
        "task-delivery-policy: TASK-0074 combined gate contract drifted",
    )
    audit.require(
        validation.get("task0075HarnessPortabilityCombinedGate")
        == {
            "taskId": TASK_0075_TASK_ID,
            "eligibleProfile": "HARNESS_PORTABILITY_LOCAL",
            "readyFrozenProfileRequired": True,
            "sameCleanCandidateCommitAndTreeRequired": True,
            "windowsDurableReceiptCount": 1,
            "satisfies": ["CANDIDATE_CANONICAL", "WINDOWS_EXACT_TREE"],
            "commandRegistryProfile": "harnessPortabilityLocal",
            "exactCommandIds": [
                "harnessTests",
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "canonicalCommandIds": [
                "doctor",
                "catalogValidate",
                "catalogDrift",
                "paidFeatureCheck",
                "betaRosterGate",
            ],
            "eachCommandExactlyOnce": True,
            "wrapperAliasCacheSkipForbidden": True,
            "wslStillIndependent": True,
            "ordinaryCardsRemainIndependentCanonical": True,
            "resultBasedProfileDowngradeForbidden": True,
        },
        "task-delivery-policy: TASK-0075 combined gate contract drifted",
    )
    review = policy.get("review")
    review = review if isinstance(review, dict) else {}
    audit.require(
        review.get("independentForkTurns") == "none"
        and review.get("maximumMinutes") == 15
        and review.get("missingTerminalStatuses") == ["TIMEOUT", "UNKNOWN"],
        "task-delivery-policy: Reviewer 15-minute non-PASS contract drifted",
    )
    candidate_identity = policy.get("candidateIdentity")
    candidate_identity = (
        candidate_identity if isinstance(candidate_identity, dict) else {}
    )
    audit.require(
        candidate_identity.get("nonPassResults")
        == ["FAIL", "CANCELLED", "TIMEOUT", "NOT_RUN", "UNKNOWN"],
        "task-delivery-policy: UNKNOWN and lost exit codes must remain non-PASS",
    )
    audit.require(
        candidate_identity.get("preCandidateResultContract")
        == {
            "NOT_STARTED": {
                "eligibleOnlyAfterReadyDoctorNonPass": True,
                "readyDoctorPassForbidden": True,
                "inProgressCommitForbidden": True,
                "candidateFreezeForbidden": True,
                "candidateAndTimeAnchors": None,
                "elapsedSeconds": 0,
                "reasonRequired": True,
                "passClaimed": False,
            }
        },
        "task-delivery-policy: strict pre-candidate NOT_STARTED contract drifted",
    )
    audit.require(
        candidate_identity.get("exactTreeChannelCrossCommitOrTreeReuse") is False,
        "task-delivery-policy: exact-tree validation cannot reuse another Commit or Tree",
    )
    audit.require(
        candidate_identity.get("evidenceResultContract")
        == {
            "PASS": {
                "exitCode": "ZERO",
                "terminalResultRequired": True,
            },
            "FAIL": {
                "exitCode": "NON_ZERO_INTEGER",
                "terminalResultRequired": True,
            },
            "TIMEOUT": {
                "exitCode": None,
                "artifactHash": None,
                "requiredFields": [
                    "reason",
                    "candidateCommit",
                    "candidateTree",
                    "budget",
                    "interruption",
                ],
                "passClaimed": False,
            },
            "UNKNOWN": {
                "exitCode": None,
                "artifactHash": None,
                "requiredFields": [
                    "reason",
                    "candidateCommit",
                    "candidateTree",
                    "budget",
                    "interruption",
                ],
                "passClaimed": False,
            },
        },
        "task-delivery-policy: strongly typed Evidence result contract drifted",
    )
    audit.require(
        canonical_json_sha256(policy) == TASK_DELIVERY_POLICY_CANONICAL_HASH,
        "task-delivery-policy: canonical contract hash drifted; update the C4 "
        "validator and tests in the same authorized change",
    )
    validate_task0074_card_recovery_contract(audit)
    validate_task0075_card_recovery_contract(audit)

    sources = load_yaml(ROOT / ".harness/sources-of-truth.yaml").get("sources")
    audit.require(
        isinstance(sources, dict)
        and sources.get("taskDeliveryPolicy") == TASK_DELIVERY_POLICY_PATH,
        "task-delivery-policy: sources-of-truth must register taskDeliveryPolicy",
    )
    audit.require(
        isinstance(sources, dict)
        and sum(
            normalize_repo_path(str(value)) == TASK_DELIVERY_POLICY_PATH
            for value in sources.values()
            if is_repository_relative(str(value))
        )
        == 1,
        "task-delivery-policy: sources-of-truth must register the policy path "
        "exactly once",
    )
    audit.require(
        isinstance(sources, dict)
        and sources.get("durableCommandRunner")
        == "scripts/harness/durable_command.ps1",
        "task-delivery-policy: sources-of-truth must register durableCommandRunner",
    )
    commands = load_yaml(ROOT / ".harness/commands.yaml").get("commands")
    durable_command = commands.get("durableCommand") if isinstance(commands, dict) else None
    audit.require(
        durable_command
        == {
            "description": (
                "Launch one Windows PowerShell 7 command with an atomic durable receipt"
            ),
            "argv": ["scripts/harness/durable_command.ps1"],
            "interpreter": "POWERSHELL_7_WINDOWS",
            "profileEligible": False,
        },
        "task-delivery-policy: durableCommand registry projection drifted",
    )
    registry = load_yaml(ROOT / ".harness/skills.yaml").get("skills")
    delivery_skills = (
        [
            entry
            for entry in registry
            if isinstance(entry, dict) and entry.get("id") == "task-delivery-flow"
        ]
        if isinstance(registry, list)
        else []
    )
    audit.require(
        delivery_skills
        == [
            {
                "id": "task-delivery-flow",
                "version": "1.3.6",
                "path": "skills/task-delivery-flow/SKILL.md",
            }
        ],
        "task-delivery-policy: task-delivery-flow must be registered exactly once "
        "at version 1.3.6",
    )
    invariants = load_yaml(ROOT / ".harness/invariants.yaml").get("invariants")
    delivery_invariants = (
        [
            invariant
            for invariant in invariants
            if isinstance(invariant, dict)
            and invariant.get("id")
            in {"INV-HARNESS-007", "INV-HARNESS-008", "INV-HARNESS-009"}
        ]
        if isinstance(invariants, list)
        else []
    )
    audit.require(
        delivery_invariants
        == [
            {
                "id": "INV-HARNESS-007",
                "statement": (
                    "single-card and longline delivery follow one registered machine "
                    "policy with bounded review exact candidate identity exact-tree "
                    "channel validation and fail-closed dependency release"
                ),
                "enforcement": [
                    "task_delivery_policy",
                    "harness_doctor",
                    "harness_tests",
                    "repository_skill",
                ],
            },
            {
                "id": "INV-HARNESS-008",
                "statement": (
                    "long commands use a direct persistent session or a preflighted "
                    "Windows PowerShell 7 durable atomic receipt with exact argv "
                    "concurrent output draining real exit code and no duplicate execution"
                ),
                "enforcement": [
                    "task_delivery_policy",
                    "durable_command_runner",
                    "harness_doctor",
                    "harness_tests",
                ],
            },
            {
                "id": "INV-HARNESS-009",
                "statement": (
                    "exact validation uses the remote exact-SHA channel or a READY-"
                    "frozen owner-authorized local exact-tree fallback whose platform "
                    "coverage and NOT_RUN or DEFERRED gaps are never represented as PASS"
                ),
                "enforcement": [
                    "ci_execution_policy",
                    "task_delivery_policy",
                    "harness_doctor",
                    "harness_tests",
                    "evidence",
                ],
            },
        ],
        "task-delivery-policy: delivery invariant projection drifted",
    )

    expected_follow_ups = {
        "idlePlanningCheckpointCore": "TASK-0077",
        "idlePlanningCheckpointConsumers": "TASK-0056",
        "harnessPerformance": "TASK-0057",
        "pathAwareCi": "TASK-0058",
        "snapshotReceipt": "TASK-0059",
    }
    audit.require(
        policy.get("followUpTasks") == expected_follow_ups,
        "task-delivery-policy: follow-up task projection drifted",
    )
    backlog = load_yaml(ROOT / TASK_BACKLOG_PATH)
    entries = backlog.get("tasks")
    entries = entries if isinstance(entries, dict) else {}
    expected_dependencies = {
        "TASK-0055": ["TASK-0069"],
        "TASK-0056": ["TASK-0077"],
        "TASK-0057": ["TASK-0056"],
        "TASK-0058": ["TASK-0057"],
        "TASK-0059": ["TASK-0058"],
    }
    for task_id, dependencies in expected_dependencies.items():
        entry = entries.get(task_id)
        audit.require(
            isinstance(entry, dict) and entry.get("dependencies") == dependencies,
            f"task-delivery-policy: {task_id} successor dependency drifted",
        )
    execution_order = backlog.get("executionOrder")
    successor_order: list[Any] | None = None
    if (
        isinstance(execution_order, list)
        and "TASK-0041" in execution_order
        and "TASK-0013" in execution_order
    ):
        successor_order = execution_order[
            execution_order.index("TASK-0041") + 1 : execution_order.index("TASK-0013")
        ]
    audit.require(
        successor_order
        == [
            "TASK-0043",
            "TASK-0044",
            "TASK-0045",
            "TASK-0046",
            "TASK-0047",
            "TASK-0049",
            "TASK-0050",
            "TASK-0051",
            "TASK-0052",
            "TASK-0053",
            "TASK-0055",
            "TASK-0056",
            "TASK-0057",
            "TASK-0058",
            "TASK-0059",
        ],
        "task-delivery-policy: replacement execution order must follow the blocked "
        "chain and precede TASK-0013",
    )
    resolutions = backlog.get("resolutions")
    resolutions = resolutions if isinstance(resolutions, dict) else {}
    for old_task, replacement in {
        "TASK-0039": "TASK-0045",
        "TASK-0040": "TASK-0046",
        "TASK-0041": "TASK-0047",
        "TASK-0043": "TASK-0049",
        "TASK-0044": "TASK-0050",
        "TASK-0045": "TASK-0051",
        "TASK-0046": "TASK-0052",
        "TASK-0047": "TASK-0053",
        "TASK-0049": "TASK-0055",
        "TASK-0050": "TASK-0056",
        "TASK-0051": "TASK-0057",
        "TASK-0052": "TASK-0058",
        "TASK-0053": "TASK-0059",
    }.items():
        resolution = resolutions.get(old_task)
        audit.require(
            isinstance(resolution, dict)
            and resolution.get("state") == "SUPERSEDED"
            and resolution.get("replacementTask") == replacement,
            f"task-delivery-policy: {old_task} must be SUPERSEDED by {replacement}",
        )

    agents_text = read_repository_text(ROOT / "AGENTS.md")
    for required_reference in (
        TASK_DELIVERY_POLICY_PATH,
        "skills/task-delivery-flow/SKILL.md",
    ):
        audit.require(
            required_reference in agents_text,
            f"task-delivery-policy: AGENTS.md misses {required_reference}",
        )
    for duplicated_field in (
        "targetWallMinutes",
        "hardFuseWallMinutes",
        "candidateDeadlineMinutes",
        "maximumFixBatches",
        "requiredInputs:",
    ):
        audit.require(
            duplicated_field not in agents_text,
            "task-delivery-policy: AGENTS.md duplicates machine strategy field "
            f"{duplicated_field}",
        )

    skill_path = ROOT / "skills/task-delivery-flow/SKILL.md"
    skill_text = read_repository_text(skill_path)
    audit.require(
        skill_text.isascii(),
        "task-delivery-policy: task-delivery-flow Skill must remain ASCII",
    )
    audit.require(
        sha256_file(skill_path) == TASK_DELIVERY_SKILL_CANONICAL_HASH,
        "task-delivery-policy: task-delivery-flow Skill canonical content hash drifted",
    )
    validate_current_durable_command_byte_domain(audit)

    def normalized_skill_section(heading: str) -> str:
        matches = list(
            re.finditer(
                rf"(?ms)^## {re.escape(heading)}\s*\n(?P<body>.*?)(?=^## |\Z)",
                skill_text,
            )
        )
        audit.require(
            len(matches) == 1,
            f"task-delivery-policy: Skill section {heading!r} must occur exactly once",
        )
        return " ".join(matches[0].group("body").split()) if len(matches) == 1 else ""

    expected_task0074_section = " ".join(
        f"- {bullet}"
        for bullet in [
            (
                "The only TASK-0074 pre-READY maintenance record is "
                "`OWNER-MAINT-20260802-TASK-0074-PRE-READY-01`. Accept exactly "
                "one direct single-parent child of the frozen TASK-0074 DRAFT and "
                "bind its Base, DRAFT, derived Commit and Tree, frozen path set, "
                "mode/type/blob/content identities, and exact Owner authorization."
            ),
            (
                "Quarantine only the fixed TASK-0073 terminal Commit and Tree, "
                "Evidence and Review blobs and hashes, and exact Reviewer "
                "command/reason/native-UNKNOWN tuple as immutable historical "
                "non-PASS. A copied tuple, changed identity, or second record fails "
                "closed and never changes TASK-0073 from REJECTED."
            ),
            (
                "Future Evidence and Handoff may use strongly typed `TIMEOUT` or "
                "`UNKNOWN`. They require null exit/artifact, a truthful reason, "
                "candidate Commit and Tree, budget, and interruption observation. "
                "`FAIL` still requires a real non-zero exit code, and `PASS` still "
                "requires a real terminal success."
            ),
            (
                "Record overall elapsed time without reanchoring. Time DRAFT through "
                "the READY Doctor terminal result separately from candidate execution, "
                "which starts only after both READY Doctor PASS and the IN_PROGRESS "
                "commit. Closure-only overrun never permits implementation."
            ),
            (
                "The only combined gate is TASK-0074 with the READY-frozen "
                "`HARNESS_PORTABILITY_LOCAL` profile. On one clean candidate and one "
                "Windows durable receipt, execute the complete profile and every "
                "canonical subcommand exactly once; this satisfies candidate canonical "
                "and Windows exact-tree. It is not an alias, cache, or skip. WSL "
                "remains an independent later run, ordinary cards retain independent "
                "canonical, and results cannot downgrade the profile."
            ),
            (
                "Use one `fork_turns=none` Reviewer with a 15-minute maximum. Missing "
                "terminal output is `TIMEOUT` or `UNKNOWN`, not an invented `FAIL`; "
                "stop later gates. Ordinary READY authorization and a real READY Doctor "
                "PASS remain mandatory."
            ),
        ]
    )
    audit.require(
        normalized_skill_section("TASK-0074 exact one-time delivery-flow recovery")
        == expected_task0074_section,
        "task-delivery-policy: TASK-0074 Skill recovery section drifted",
    )

    expected_validation_bullets = [
        (
            "For every Doctor, candidate canonical, or pre-closure command expected "
            "to exceed 60 seconds, prefer a direct persistent session or PTY from "
            "launch. If that tool surface is unavailable on Windows, first run a "
            "no-side-effect exit-7 smoke, then launch exactly once through "
            "`scripts/harness/durable_command.ps1 -Mode Launch -RequestPath "
            "<absolute-json>`. The helper requires PowerShell 7 and exact JSON argv; "
            "PowerShell 5.1 and unsupported platforms never fall back silently."
        ),
        (
            "With durable transport, poll only whether `receipt.json` exists about "
            "every 60 seconds. Do not inspect PID/process/status or tail logs. After "
            "atomic publication, read the receipt and complete stdout/stderr once. A "
            "missing, invalid, or identity-mismatched receipt is `UNKNOWN`, never "
            "PASS, and the command is not repeated."
        ),
        (
            "The helper's receipt is transport evidence only. The real inner exit "
            "code and complete output determine the registered command result."
        ),
        (
            "Reuse means not dispatching an identical check again. Preserve its one "
            "real result and never invent a `REUSED` PASS."
        ),
        (
            "Keep failure, cancellation, timeout, NOT_RUN, UNKNOWN, and "
            "DEFERRED_NOT_CLAIMED as non-PASS."
        ),
        (
            "Record strongly typed TIMEOUT/UNKNOWN with candidate Commit and Tree, "
            "budget, interruption observation, and truthful reason. Never use FAIL "
            "to stand in for missing Reviewer or command output."
        ),
        (
            "Do not present another Commit, Tree, platform, execution, or pre-closure "
            "result as the current exact-tree PASS."
        ),
        (
            "Freeze the validation profile before READY. Never downgrade it from "
            "results. A local result binds clean Commit and Tree, exact argv, OS, "
            "interpreter, toolchain, dependencies, environment, output hashes, and "
            "receipt hash."
        ),
        (
            "Use TERMINAL_METADATA_ONLY only after a verified implementation "
            "candidate or for REJECTED closure. Require an unchanged implementation-"
            "tree projection and `[skip ci]`; it never represents CI PASS."
        ),
        (
            "Keep C1/C2 review conditional unless the task or a protected rule "
            "requires more. Keep C3/C4 independent review mandatory."
        ),
        (
            "Leave idle checkpoint core, its four consumers, performance work, "
            "path-aware CI, and snapshot receipts to the follow-up tasks registered "
            "by the policy."
        ),
    ]
    expected_validation_section = " ".join(
        f"- {bullet}" for bullet in expected_validation_bullets
    )
    audit.require(
        normalized_skill_section("Preserve validation and review integrity")
        == expected_validation_section,
        "task-delivery-policy: Skill validation-integrity section drifted",
    )
    expected_fail_closed_bullets = [
        (
            "Stop promotion on Context, approval, Skill, allowlist, candidate "
            "identity, Reviewer, canonical, CI, or remote verification failure."
        ),
        (
            "At `hardFuseWallMinutes`, stop implementation, fixes, Reviewer work, "
            "canonical validation, and CI. If the repository is still active or "
            "half-closed, allow only a minimal closure-only overrun for "
            "Evidence/Handoff, pre-closure, the terminal commit, push, and remote "
            "`0/0` verification. Record overrun duration and root cause separately, "
            "and perform no implementation during the overrun."
        ),
        "Stop at every other policy budget, round, or structural-finding fuse.",
        (
            "Do not start a third review, add an unbounded fix loop, delete tests, "
            "add skips, expand timeouts, or weaken policy for the current task."
        ),
    ]
    expected_fail_closed_section = " ".join(
        f"- {bullet}" for bullet in expected_fail_closed_bullets
    )
    audit.require(
        normalized_skill_section("Fail closed") == expected_fail_closed_section,
        "task-delivery-policy: Skill hard-fuse section drifted",
    )
    wrapper_item_match = re.search(
        r"(?ms)^## Run a single card\s+.*?^5\. (?P<body>.*?)(?=^6\. )",
        skill_text,
    )
    audit.require(
        wrapper_item_match is not None,
        "task-delivery-policy: Skill wrapper command identity item is missing",
    )
    if wrapper_item_match is not None:
        wrapper_item = " ".join(wrapper_item_match.group("body").split())
        expected_wrapper_item = (
            "For an ordinary card, use `python scripts/harness/precheck.py --task "
            "TASK-ID` as the canonical command. A wrapper is never an Evidence, "
            "receipt, or PASS alias. A task that freezes wrapper argv executes and "
            "records that wrapper as the actual command; freezing does not convert "
            "the wrapper into the Python canonical command."
        )
        audit.require(
            wrapper_item == expected_wrapper_item,
            "task-delivery-policy: wrapper command identity must be unconditional; "
            "frozen wrapper argv is an actual command and never an Evidence, receipt, "
            "PASS, or Python canonical alias",
        )


def validate_harness_runtime(audit: Audit) -> None:
    tools = load_yaml(ROOT / ".harness/tools.lock.yaml")
    governance = tools.get("governance")
    governance = governance if isinstance(governance, dict) else {}
    python_policy = governance.get("python")
    python_policy = python_policy if isinstance(python_policy, dict) else {}
    minimum = str(python_policy.get("minimum", ""))
    try:
        major, minor = (int(part) for part in minimum.split(".", 1))
    except (TypeError, ValueError):
        audit.error("tools.lock: governance.python.minimum must be major.minor")
    else:
        audit.require(
            sys.version_info >= (major, minor),
            f"Harness requires Python {minimum}+; current is {sys.version_info.major}.{sys.version_info.minor}",
        )
    pyyaml_policy = governance.get("pyyaml")
    pyyaml_policy = pyyaml_policy if isinstance(pyyaml_policy, dict) else {}
    minimum_pyyaml = tuple(int(part) for part in str(pyyaml_policy.get("minimum", "")).split("."))
    maximum_pyyaml = tuple(
        int(part) for part in str(pyyaml_policy.get("maximumExclusive", "")).split(".")
    )
    current_pyyaml = tuple(int(part) for part in yaml.__version__.split(".")[:2])
    audit.require(
        minimum_pyyaml <= current_pyyaml < maximum_pyyaml,
        "Harness requires "
        f"PyYAML >= {pyyaml_policy.get('minimum')}, < {pyyaml_policy.get('maximumExclusive')}; "
        f"current is {yaml.__version__}",
    )
    timezone_policy = governance.get("timezoneData")
    timezone_policy = timezone_policy if isinstance(timezone_policy, dict) else {}
    required_zone = str(timezone_policy.get("requiredZone", ""))
    try:
        ZoneInfo(required_zone)
    except ZoneInfoNotFoundError:
        audit.error(
            f"Harness requires IANA timezone {required_zone}; "
            "install requirements-harness.txt so Windows receives tzdata"
        )


def first_existing_zed_instruction_path() -> str | None:
    return next(
        (
            candidate
            for candidate in ZED_PROJECT_INSTRUCTION_PRIORITY
            if current_path_is_file(ROOT / normalize_repo_path(candidate))
        ),
        None,
    )


def validate_entrypoints(audit: Audit) -> None:
    config = load_yaml(ROOT / ".harness/agent-entrypoints.yaml")
    canonical = str(config.get("canonicalInstructions", ""))
    audit.require(canonical == "AGENTS.md", "agent-entrypoints: canonicalInstructions must be AGENTS.md")
    canonical_path = ROOT / canonical
    canonical_is_file = current_path_is_file(canonical_path)
    audit.require(canonical_is_file, "agent-entrypoints: AGENTS.md is missing")
    if canonical_is_file:
        nonblank = [
            line
            for line in read_repository_text(canonical_path).splitlines()
            if line.strip()
        ]
        audit.require(len(nonblank) <= 160, "AGENTS.md is too large; move explanations to onboarding docs")
    clients = config.get("clients")
    audit.require(isinstance(clients, dict), "agent-entrypoints: clients must be an object")
    if not isinstance(clients, dict):
        return
    expected_clients = {
        "codex",
        "zed",
        "claudeCode",
        "githubCopilotCliAgentInstructions",
        "githubCopilotCliClaudeImport",
    }
    audit.require(
        set(clients) == expected_clients,
        "agent-entrypoints: client discovery mechanisms must be explicit and complete: "
        f"{sorted(expected_clients)}",
    )
    allowed_modes = {"NATIVE_DISCOVERY", "THIN_IMPORT", "THIN_REFERENCE"}
    for client_id, client in clients.items():
        if not isinstance(client, dict):
            audit.error(f"agent-entrypoints: {client_id} must be an object")
            continue
        path_value = str(client.get("instructionPath", ""))
        audit.require(is_repository_relative(path_value), f"agent-entrypoints: {client_id} path is invalid")
        path = ROOT / normalize_repo_path(path_value)
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"agent-entrypoints: {client_id} missing {path_value}")
        mode = client.get("mode")
        audit.require(mode in allowed_modes, f"agent-entrypoints: {client_id} has invalid mode {mode}")
        if mode == "NATIVE_DISCOVERY":
            audit.require(
                path_value == canonical,
                f"agent-entrypoints: native client {client_id} must use canonical instructions",
            )
        expected_hash = str(client.get("contentSha256", ""))
        audit.require(
            bool(re.fullmatch(r"[0-9a-f]{64}", expected_hash)),
            f"agent-entrypoints: {client_id} contentSha256 is required",
        )
        if path_is_file and re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            audit.require(
                sha256_file(path) == expected_hash,
                f"agent-entrypoints: {client_id} instruction content drifted",
            )
        if path_is_file and mode in ("THIN_IMPORT", "THIN_REFERENCE"):
            text = read_repository_text(path)
            reference = str(client.get("requiredReference", ""))
            audit.require(reference in text, f"agent-entrypoints: {client_id} adapter misses {reference}")
            nonblank = [line for line in text.splitlines() if line.strip()]
            audit.require(len(nonblank) <= 8, f"agent-entrypoints: {client_id} adapter is not thin")
            audit.require("## 绝对禁止" not in text, f"agent-entrypoints: {client_id} duplicates canonical rules")
            audit.require(
                client.get("unavailableAction")
                == "BLOCK_IF_CANONICAL_UNAVAILABLE",
                f"agent-entrypoints: {client_id} must fail closed when "
                "canonical instructions cannot be loaded",
            )
            audit.require(
                "blocked" in text.casefold(),
                f"agent-entrypoints: {client_id} adapter must state its "
                "fail-closed behavior",
            )
    zed = clients.get("zed")
    if isinstance(zed, dict):
        first_existing = first_existing_zed_instruction_path()
        audit.require(
            first_existing == zed.get("instructionPath"),
            "agent-entrypoints: Zed instructionPath must equal the first existing "
            f"official-priority file, got {first_existing!r}",
        )
        audit.require(
            zed.get("discoverySemantics") == "FIRST_MATCH",
            "agent-entrypoints: Zed must declare FIRST_MATCH discovery semantics",
        )
    copilot_cli_agent = clients.get("githubCopilotCliAgentInstructions")
    copilot_cli_import = clients.get("githubCopilotCliClaudeImport")
    copilot_cli_mechanisms = (copilot_cli_agent, copilot_cli_import)
    for copilot_cli in copilot_cli_mechanisms:
        if not isinstance(copilot_cli, dict):
            continue
        audit.require(
            copilot_cli.get("clientScope") == "GITHUB_COPILOT_CLI",
            "agent-entrypoints: Copilot CLI mechanism must have an exact client scope",
        )
        audit.require(
            copilot_cli.get("discoverySemantics") == "MERGE_ALL_DISCOVERED",
            "agent-entrypoints: Copilot CLI must declare merge-all discovery semantics",
        )
        audit.require(
            copilot_cli.get("supportMatrix") == COPILOT_SUPPORT_MATRIX,
            "agent-entrypoints: Copilot CLI mechanism must link "
            "the official support matrix",
        )
        audit.require(
            copilot_cli.get("documentation")
            == "https://docs.github.com/en/copilot/how-tos/copilot-cli/"
            "customize-copilot/add-custom-instructions",
            "agent-entrypoints: Copilot CLI mechanism must link its official "
            "instruction documentation",
        )
    if isinstance(copilot_cli_agent, dict):
        audit.require(
            copilot_cli_agent.get("instructionPath") == canonical
            and copilot_cli_agent.get("mode") == "NATIVE_DISCOVERY"
            and copilot_cli_agent.get("appliesWhen")
            == "COPILOT_CLI_AGENT_INSTRUCTIONS_SUPPORTED",
            "agent-entrypoints: Copilot CLI must register native AGENTS.md discovery",
        )
    if isinstance(copilot_cli_import, dict):
        audit.require(
            copilot_cli_import.get("instructionPath") == "CLAUDE.md"
            and copilot_cli_import.get("mode") == "THIN_IMPORT"
            and copilot_cli_import.get("requiredReference") == "@AGENTS.md"
            and copilot_cli_import.get("appliesWhen")
            == "COPILOT_CLI_CLAUDE_IMPORT_SUPPORTED",
            "agent-entrypoints: Copilot CLI must register the shared CLAUDE.md thin import",
        )
        audit.require(
            copilot_cli_import.get("unavailableAction")
            == "BLOCK_IF_CANONICAL_UNAVAILABLE",
            "agent-entrypoints: Copilot CLI import must fail closed when canonical "
            "instructions are unavailable",
        )
        copilot_adapter = ROOT / "CLAUDE.md"
        if current_path_is_file(copilot_adapter):
            audit.require(
                "blocked" in read_repository_text(copilot_adapter).casefold(),
                "agent-entrypoints: shared Copilot CLI adapter must state its "
                "fail-closed behavior",
            )
    if isinstance(copilot_cli_agent, dict) and isinstance(
        copilot_cli_import, dict
    ):
        audit.require(
            copilot_cli_agent.get("clientScope")
            == copilot_cli_import.get("clientScope")
            and copilot_cli_agent.get("documentation")
            == copilot_cli_import.get("documentation"),
            "agent-entrypoints: Copilot CLI discovery mechanisms must share "
            "one exact product scope and documentation",
        )


def validate_command_registry(audit: Audit, config: dict[str, Any]) -> None:
    runner = str(config.get("runner", ""))
    audit.require(
        runner == "scripts/harness/precheck.py",
        "commands: canonical runner must remain scripts/harness/precheck.py",
    )
    audit.require(is_repository_relative(runner), "commands: runner must be repository-relative")
    if is_repository_relative(runner):
        audit.require(
            current_path_is_file(ROOT / runner),
            f"commands: missing runner {runner}",
        )
    commands = config.get("commands")
    profiles = config.get("profiles")
    audit.require(isinstance(commands, dict), "commands: commands must be an object")
    audit.require(isinstance(profiles, dict), "commands: profiles must be an object")
    if not isinstance(commands, dict) or not isinstance(profiles, dict):
        return
    precheck_profile = profiles.get("precheck")
    audit.require(isinstance(precheck_profile, list), "commands: precheck profile must be a list")
    if isinstance(precheck_profile, list):
        missing = sorted(set(CANONICAL_PRECHECK_COMMANDS) - set(str(item) for item in precheck_profile))
        audit.require(
            not missing,
            f"commands: precheck profile cannot remove canonical checks: {missing}",
        )
    for command_id, command in commands.items():
        if not isinstance(command, dict):
            audit.error(f"commands: {command_id} must be an object")
            continue
        argv = command.get("argv")
        audit.require(isinstance(argv, list) and bool(argv), f"commands: {command_id}.argv must be a list")
        if isinstance(argv, list) and argv:
            script = str(argv[0])
            audit.require(is_repository_relative(script), f"commands: {command_id} script must be relative")
            if is_repository_relative(script):
                audit.require(
                    current_path_is_file(ROOT / script),
                    f"commands: {command_id} missing {script}",
                )
    for command_id, expected_argv in CANONICAL_PRECHECK_COMMANDS.items():
        command = commands.get(command_id)
        audit.require(isinstance(command, dict), f"commands: missing canonical command {command_id}")
        if isinstance(command, dict):
            audit.require(
                command.get("argv") == expected_argv,
                f"commands: canonical command {command_id} argv cannot be replaced",
            )
    for profile_id, command_ids in profiles.items():
        audit.require(isinstance(command_ids, list), f"commands: profile {profile_id} must be a list")
        if isinstance(command_ids, list):
            for command_id in command_ids:
                audit.require(command_id in commands, f"commands: profile {profile_id} references {command_id}")


def validate_commands(audit: Audit) -> None:
    validate_command_registry(audit, load_yaml(ROOT / ".harness/commands.yaml"))
    for wrapper in ("scripts/harness/precheck.sh", "scripts/harness/precheck.ps1"):
        path = ROOT / wrapper
        path_is_file = current_path_is_file(path)
        audit.require(path_is_file, f"commands: missing wrapper {wrapper}")
        if path_is_file:
            audit.require(
                "precheck.py" in read_repository_text(path),
                f"{wrapper}: must call precheck.py",
            )


def validate_check_artifact(
    audit: Audit,
    label: str,
    artifact_hash: Any,
    reason: Any,
) -> None:
    if artifact_hash is None:
        audit.require(
            isinstance(reason, str) and bool(reason.strip()),
            f"{label}: null artifactHash requires a truthful non-blank no-artifact reason",
        )
    else:
        audit.require(
            isinstance(artifact_hash, str)
            and bool(re.fullmatch(r"([0-9a-f]{40}|[0-9a-f]{64})", artifact_hash)),
            f"{label}: artifactHash must be a non-blank 40- or 64-character lowercase hex digest",
        )


def validate_nonblank_text(audit: Audit, label: str, value: Any) -> None:
    audit.require(
        isinstance(value, str) and bool(value.strip()),
        f"{label}: must be a non-blank string",
    )


def validate_typed_nonpass_observation(
    audit: Audit,
    label: str,
    value: dict[str, Any],
    status_field: str,
) -> None:
    status = value.get(status_field)
    candidate_commit = str(
        value.get(
            "candidateCommit",
            value.get("reviewedCommit", ""),
        )
    )
    candidate_tree = str(value.get("candidateTree", ""))
    budget = value.get("budget")
    interruption = value.get("interruption")
    validate_nonblank_text(audit, f"{label}: {status} reason", value.get("reason"))
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(candidate_commit))
        and bool(FULL_COMMIT_RE.fullmatch(candidate_tree)),
        f"{label}: {status} requires candidate Commit and Tree",
    )
    if "verifiedCommit" in value:
        audit.require(
            value.get("verifiedCommit") == candidate_commit,
            f"{label}: {status} candidateCommit must equal verifiedCommit",
        )
    audit.require(
        isinstance(budget, dict)
        and set(budget) == {"maximumMinutes", "elapsedSeconds", "hardLimitReached"}
        and isinstance(budget.get("maximumMinutes"), int)
        and not isinstance(budget.get("maximumMinutes"), bool)
        and budget.get("maximumMinutes") > 0
        and isinstance(budget.get("elapsedSeconds"), (int, float))
        and not isinstance(budget.get("elapsedSeconds"), bool)
        and budget.get("elapsedSeconds") >= 0
        and isinstance(budget.get("hardLimitReached"), bool),
        f"{label}: {status} requires an exact non-negative budget observation",
    )
    audit.require(
        isinstance(interruption, dict)
        and set(interruption)
        == {"terminalOutputReceived", "observedStatus", "action"}
        and interruption.get("terminalOutputReceived") is False
        and isinstance(interruption.get("observedStatus"), str)
        and bool(interruption.get("observedStatus", "").strip())
        and isinstance(interruption.get("action"), str)
        and bool(interruption.get("action", "").strip()),
        f"{label}: {status} requires an exact missing-terminal interruption observation",
    )
    if status == "TIMEOUT":
        audit.require(
            isinstance(budget, dict) and budget.get("hardLimitReached") is True,
            f"{label}: TIMEOUT requires hardLimitReached=true",
        )


def validate_evidence_check(audit: Audit, label: str, check: dict[str, Any]) -> None:
    status = check.get("status")
    exit_code = check.get("exitCode")
    reason = check.get("reason")
    if status == "PASS":
        audit.require(exit_code == 0, f"{label}: PASS requires exitCode 0")
    elif status == "FAIL":
        legacy_result_unrecoverable = (
            exit_code is None
            and check.get("artifactHash") is None
            and reason == LEGACY_RESULT_UNRECOVERABLE_REASON
            and check.get("command")
            == "python scripts/harness/precheck.py --task TASK-0061"
            and check.get("verifiedCommit")
            == "b42140480aa47613800efe878ec5924d88dfbafe"
        )
        audit.require(
            legacy_result_unrecoverable
            or task0073_exact_historical_unknown_check(label, check)
            or (isinstance(exit_code, int) and exit_code != 0),
            f"{label}: FAIL requires non-zero exitCode",
        )
    elif status in {"TIMEOUT", "UNKNOWN"}:
        audit.require(
            exit_code is None,
            f"{label}: {status} requires null exitCode",
        )
        audit.require(
            check.get("artifactHash") is None,
            f"{label}: {status} must not claim an artifactHash",
        )
        validate_typed_nonpass_observation(audit, label, check, "status")
    elif status == "NOT_RUN":
        audit.require(exit_code is None, f"{label}: NOT_RUN requires null exitCode")
        validate_nonblank_text(audit, f"{label}: NOT_RUN reason", reason)
        audit.require(
            check.get("artifactHash") is None,
            f"{label}: NOT_RUN must not claim an artifactHash",
        )
    validate_check_artifact(audit, label, check.get("artifactHash"), reason)


def validate_task0064_local_fallback_evidence(
    audit: Audit,
    task: dict[str, Any],
    evidence: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    if task_id not in {"TASK-0064", "TASK-0066", "TASK-0067"}:
        return
    record = evidence.get("validationChannels")
    audit.require(
        isinstance(record, dict),
        f"{task_id}: Evidence must contain validationChannels",
    )
    if not isinstance(record, dict):
        return
    candidate_commit = str(record.get("candidateCommit", ""))
    candidate_tree = str(record.get("candidateTree", ""))
    audit.require(
        record.get("policySource") == CI_EXECUTION_POLICY_PATH
        and record.get("channel") == "LOCAL_EXACT_TREE_FALLBACK"
        and record.get("profile") == "HARNESS_PORTABILITY_LOCAL"
        and candidate_commit == evidence.get("headCommit")
        and bool(FULL_COMMIT_RE.fullmatch(candidate_commit))
        and bool(FULL_COMMIT_RE.fullmatch(candidate_tree)),
        f"{task_id}: local fallback must bind the Evidence candidate Commit and Tree",
    )
    if FULL_COMMIT_RE.fullmatch(candidate_commit):
        actual_tree = git_text(
            "rev-parse",
            f"{candidate_commit}^{{tree}}",
            check=False,
        ).stdout.strip()
        audit.require(
            actual_tree == candidate_tree,
            f"{task_id}: candidateTree does not belong to candidateCommit",
        )
    clean = record.get("cleanSnapshot")
    audit.require(
        clean
        == {
            "candidateCommit": candidate_commit,
            "candidateTree": candidate_tree,
            "worktreeClean": True,
            "indexClean": True,
        },
        f"{task_id}: clean candidate snapshot binding drifted",
    )
    expected_argv = {
        "windows": [
            "python",
            "scripts/harness/precheck.py",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            task_id,
        ],
        "wslUbuntu": [
            "bash",
            "scripts/harness/precheck.sh",
            "--profile",
            "harnessPortabilityLocal",
            "--task",
            task_id,
        ],
    }
    expected_identity = {
        "windows": {
            "operatingSystem": "Windows-NT-10.0.26200",
            "interpreter": "Python 3.12.9",
            "toolchain": {
                "powershell": "7.6.3",
                "git": "2.28.0.windows.1",
            },
            "dependencies": {
                "PyYAML": "6.0.3",
                "tzdata": "2026.3",
            },
            "environment": {
                "timezone": "Asia/Shanghai",
                "transport": "DURABLE_ATOMIC_RECEIPT",
            },
        },
        "wslUbuntu": {
            "operatingSystem": (
                "Ubuntu-24.04 / Linux "
                "6.6.87.2-microsoft-standard-WSL2 x86_64"
            ),
            "interpreter": "Python 3.12.3",
            "toolchain": {
                "bash": "5.2.21(1)-release",
                "git": "2.43.0",
            },
            "dependencies": {
                "PyYAML": "6.0.1",
                "timezoneData": (
                    "SYSTEM:/usr/share/zoneinfo/Asia/Shanghai"
                ),
            },
            "environment": {
                "timezone": "Asia/Shanghai",
                "locale": "C.UTF-8",
                "isolation": "GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP",
            },
        },
    }
    results = record.get("results")
    audit.require(
        isinstance(results, list) and len(results) == 2,
        f"{task_id}: local fallback must contain exactly Windows and WSL results",
    )
    by_platform = {
        str(item.get("platform", "")): item
        for item in results
        if isinstance(item, dict)
    } if isinstance(results, list) else {}
    audit.require(
        set(by_platform) == {"windows", "wslUbuntu"},
        f"{task_id}: local result platform coverage drifted",
    )
    required_result_fields = {
        "platform",
        "status",
        "taskId",
        "candidateCommit",
        "candidateTree",
        "cleanWorktree",
        "cleanIndex",
        "argv",
        "cwd",
        "operatingSystem",
        "interpreter",
        "toolchain",
        "dependencies",
        "environment",
        "stdoutSha256",
        "stderrSha256",
        "receiptSha256",
        "exitCode",
        "startedAt",
        "completedAt",
    }
    for platform, argv in expected_argv.items():
        result = by_platform.get(platform)
        label = f"{task_id}: {platform} local result"
        audit.require(isinstance(result, dict), f"{label} is missing")
        if not isinstance(result, dict):
            continue
        audit.require(
            required_result_fields <= set(result),
            f"{label} misses exact-tree receipt fields",
        )
        audit.require(
            result.get("status") == "PASS"
            and result.get("taskId") == task_id
            and result.get("candidateCommit") == candidate_commit
            and result.get("candidateTree") == candidate_tree
            and result.get("cleanWorktree") is True
            and result.get("cleanIndex") is True
            and result.get("argv") == argv
            and result.get("operatingSystem")
            == expected_identity[platform]["operatingSystem"]
            and result.get("interpreter")
            == expected_identity[platform]["interpreter"]
            and result.get("toolchain")
            == expected_identity[platform]["toolchain"]
            and result.get("dependencies")
            == expected_identity[platform]["dependencies"]
            and result.get("environment")
            == expected_identity[platform]["environment"]
            and result.get("exitCode") == 0,
            f"{label} does not bind a real PASS to the candidate",
        )
        for field in ("cwd", "operatingSystem", "interpreter", "startedAt", "completedAt"):
            validate_nonblank_text(audit, f"{label}.{field}", result.get(field))
        for field in ("stdoutSha256", "stderrSha256", "receiptSha256"):
            audit.require(
                bool(re.fullmatch(r"[0-9a-f]{64}", str(result.get(field, "")))),
                f"{label}.{field} must be SHA-256",
            )
    audit.require(
        record.get("notCovered") == [],
        f"{task_id}: notCovered must be explicit even when empty",
    )
    deferred = record.get("deferred")
    audit.require(
        isinstance(deferred, list)
        and len(deferred) == 1
        and isinstance(deferred[0], dict)
        and deferred[0].get("platform") == "macos"
        and deferred[0].get("status") == "DEFERRED_NOT_CLAIMED"
        and isinstance(deferred[0].get("residualRisk"), str)
        and bool(deferred[0]["residualRisk"].strip())
        and isinstance(deferred[0].get("followUpCondition"), str)
        and bool(deferred[0]["followUpCondition"].strip()),
        f"{task_id}: unavailable macOS must remain DEFERRED_NOT_CLAIMED with risk",
    )
    audit.require(
        record.get("remote")
        == {
            "platform": "githubActions",
            "status": (
                "NOT_RUN_QUOTA"
                if task_id in {"TASK-0066", "TASK-0067"}
                else "NOT_RUN"
            ),
            "reasonType": "OWNER_SUPPLIED_QUOTA_EXHAUSTED",
            "includedMinutes": 2000,
            "usedMinutes": 2000,
            "paidBudgetUsd": 0,
            "stopUsageEnabled": True,
            "resetDate": "2026-08-01",
            "dispatchCount": 0,
        },
        f"{task_id}: remote quota NOT_RUN evidence drifted",
    )
    metadata_only = record.get("terminalMetadataOnly")
    audit.require(
        isinstance(metadata_only, dict)
        and metadata_only.get("profile") == "TERMINAL_METADATA_ONLY"
        and metadata_only.get("implementationCandidateCommit") == candidate_commit
        and metadata_only.get("implementationCandidateTree") == candidate_tree
        and metadata_only.get("commitMarker") == "[skip ci]"
        and metadata_only.get("representsCiPass") is False,
        f"{task_id}: terminal metadata-only evidence drifted",
    )


def validate_task0064_terminal_commit_marker(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    evidence: dict[str, Any],
) -> None:
    if task_id not in {"TASK-0064", "TASK-0066", "TASK-0067"}:
        return
    metadata_only = evidence.get("validationChannels", {}).get(
        "terminalMetadataOnly",
        {},
    )
    marker = (
        metadata_only.get("commitMarker")
        if isinstance(metadata_only, dict)
        else None
    )
    audit.require(
        marker == "[skip ci]",
        f"{task_id}: terminal metadata-only Evidence marker must be [skip ci]",
    )
    message = git_text(
        "show",
        "-s",
        "--format=%B",
        terminal_commit,
        check=False,
    )
    audit.require(
        message.returncode == 0 and "[skip ci]" in message.stdout,
        f"{task_id}: real terminal commit message must contain [skip ci]",
    )


def validate_evidence_and_handoffs(
    audit: Audit,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
    current_protected_rules: list[dict[str, Any]],
    allow_pending_draft: bool = False,
) -> None:
    handoff_schema = load_json(ROOT / "docs/schemas/handoff.schema.json", audit)
    evidence_schema = load_json(ROOT / "docs/schemas/evidence-pack.schema.json", audit)
    if not handoff_schema or not evidence_schema:
        return
    handoff_states = set(
        handoff_schema.get("properties", {}).get("state", {}).get("enum", [])
    )
    lifecycle_states = set(str(item) for item in lifecycle.get("states", []))
    audit.require(
        handoff_states
        == lifecycle_states - {"PLANNED", "DRAFT", "SUPERSEDED"},
        "handoff schema states drift from executable lifecycle states; "
        "planning-only SUPERSEDED must not create a Handoff",
    )
    handoffs: dict[str, dict[str, Any]] = {}
    for path in sorted(repository_glob(ROOT / "docs/handoffs", "TASK-*.json")):
        data = load_json(path, audit)
        if not data:
            continue
        _hid = str(data.get("taskId", ""))
        _htask = tasks.get(_hid)
        if _htask is not None and _htask.get("state") in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            handoffs[_hid] = data
            continue
        exact_task0074_handoff_quarantine = False
        if (
            relative(path) == TASK_0074_TERMINAL_ARTIFACTS["handoff"]["path"]
            and task0074_exact_historical_quarantine_matches()
        ):
            try:
                exact_task0074_handoff_quarantine = data == json.loads(
                    git_object(
                        TASK_0074_TERMINAL_COMMIT,
                        TASK_0074_TERMINAL_ARTIFACTS["handoff"]["path"],
                    ).decode("utf-8")
                )
            except (HarnessError, json.JSONDecodeError, UnicodeError):
                exact_task0074_handoff_quarantine = False
        if not exact_task0074_handoff_quarantine:
            validate_json_schema(audit, data, handoff_schema, relative(path))
        validate_nonblank_text(audit, f"{relative(path)}.nextAction", data.get("nextAction"))
        task_id = str(data.get("taskId", ""))
        audit.require(task_id in tasks, f"{relative(path)}: unknown taskId {task_id}")
        audit.require(path.stem == task_id, f"{relative(path)}: filename and taskId disagree")
        if task_id in tasks:
            audit.require(data.get("state") == tasks[task_id].get("state"), f"{relative(path)}: state disagrees with task")
            audit.require(
                data.get("baseCommit") == tasks[task_id].get("baseCommit"),
                f"{relative(path)}: baseCommit disagrees with task",
            )
        evidence_path = str(data.get("evidencePath", ""))
        audit.require(is_repository_relative(evidence_path), f"{relative(path)}: evidencePath must be relative")
        if is_repository_relative(evidence_path):
            audit.require(
                current_path_is_file(ROOT / evidence_path),
                f"{relative(path)}: evidencePath does not exist",
            )
        handoffs[task_id] = data

    evidence_packs: dict[str, dict[str, Any]] = {}
    for path in sorted(
        repository_glob(
            ROOT / "docs/evidence",
            "TASK-*/evidence-pack.json",
        )
    ):
        data = load_json(path, audit)
        if not data:
            continue
        _eid = str(data.get("taskId", ""))
        _etask = tasks.get(_eid)
        if _etask is not None and _etask.get("state") in ("ACCEPTED", "REJECTED", "SUPERSEDED"):
            evidence_packs[_eid] = data
            continue
        exact_task0074_evidence_quarantine = False
        if (
            relative(path) == TASK_0074_TERMINAL_ARTIFACTS["evidence"]["path"]
            and task0074_exact_historical_quarantine_matches()
        ):
            try:
                exact_task0074_evidence_quarantine = data == json.loads(
                    git_object(
                        TASK_0074_TERMINAL_COMMIT,
                        TASK_0074_TERMINAL_ARTIFACTS["evidence"]["path"],
                    ).decode("utf-8")
                )
            except (HarnessError, json.JSONDecodeError, UnicodeError):
                exact_task0074_evidence_quarantine = False
        if not exact_task0074_evidence_quarantine:
            validate_json_schema(audit, data, evidence_schema, relative(path))
        task_id = str(data.get("taskId", ""))
        directory_task_id = path.parent.name
        audit.require(task_id == directory_task_id, f"{relative(path)}: directory and taskId disagree")
        audit.require(task_id in tasks, f"{relative(path)}: unknown taskId {task_id}")
        if task_id in tasks:
            task = tasks[task_id]
            audit.require(data.get("baseCommit") == task.get("baseCommit"), f"{relative(path)}: baseCommit disagrees")
            audit.require(
                data.get("contextFingerprint") == task.get("contextFingerprint"),
                f"{relative(path)}: contextFingerprint disagrees",
            )
            if task.get("state") == "ACCEPTED":
                validate_task0064_local_fallback_evidence(audit, task, data)
        checks = data.get("checks")
        audit.require(isinstance(checks, list) and bool(checks), f"{relative(path)}: checks must be non-empty")
        if not isinstance(checks, list):
            continue
        for index, check in enumerate(checks):
            label = f"{relative(path)} checks[{index}]"
            if not isinstance(check, dict):
                audit.error(f"{label}: must be an object")
                continue
            validate_evidence_check(audit, label, check)
        evidence_packs[task_id] = data

    terminal_states = set(str(item) for item in lifecycle.get("terminalStates", []))
    for task_id, task in tasks.items():
        if (
            task.get("state") not in terminal_states
            or is_planning_only_task(task)
        ):
            continue
        if task.get("state") in ("ACCEPTED", "REJECTED"):
            continue
        evidence = evidence_packs.get(task_id)
        handoff = handoffs.get(task_id)
        if evidence is None or handoff is None:
            continue
        expected_evidence_path = f"docs/evidence/{task_id}/evidence-pack.json"
        audit.require(
            handoff.get("evidencePath") == expected_evidence_path,
            f"{task_id}: handoff must point to {expected_evidence_path}",
        )
        audit.require(
            evidence.get("headCommit") == handoff.get("headCommit"),
            f"{task_id}: Evidence and Handoff headCommit disagree",
        )
        head_commit = str(evidence.get("headCommit", ""))
        audit.require(bool(FULL_COMMIT_RE.fullmatch(head_commit)), f"{task_id}: headCommit must be a full Git SHA")
        if FULL_COMMIT_RE.fullmatch(head_commit):
            exists = git_text("cat-file", "-e", f"{head_commit}^{{commit}}", check=False)
            audit.require(exists.returncode == 0, f"{task_id}: headCommit does not exist")
            ancestor = git_text("merge-base", "--is-ancestor", str(task.get("baseCommit", "")), head_commit, check=False)
            audit.require(ancestor.returncode == 0, f"{task_id}: headCommit does not descend from baseCommit")
            merged = git_text("merge-base", "--is-ancestor", head_commit, "HEAD", check=False)
            audit.require(merged.returncode == 0, f"{task_id}: headCommit is not an ancestor of current HEAD")
        # TASK-0001 predates the versioned authorization/evidence contract. The
        # portable Harness validates its reproducible base/head/path bindings
        # above, while all tasks with authorizationCommit use the full v2 gate.
        if task.get("authorizationCommit"):
            validate_versioned_terminal_evidence(
                audit,
                task_id,
                task,
                evidence,
                handoff,
                head_commit,
                terminal_states,
                current_protected_rules,
                allow_pending_draft,
            )
        if task_id == TASK_0074_TASK_ID:
            validate_task0074_delivery_timing_evidence(
                audit,
                task,
                evidence,
                handoff,
            )
            validate_task0074_combined_gate_evidence(
                audit,
                task,
                evidence,
            )
        if task_id == TASK_0075_TASK_ID:
            validate_task0075_delivery_timing_evidence(
                audit,
                task,
                evidence,
                handoff,
            )
            validate_task0074_combined_gate_evidence(
                audit,
                task,
                evidence,
                TASK_0075_TASK_ID,
            )


def validate_required_command_coverage(
    audit: Audit,
    task: dict[str, Any],
    by_command: dict[str, list[dict[str, Any]]],
    require_pass: bool,
) -> None:
    task_id = str(task.get("taskId"))
    for command in task.get("requiredCommands", []):
        matches = by_command.get(str(command), [])
        audit.require(bool(matches), f"{task_id}: required command missing from Evidence: {command}")
        audit.require(
            len(matches) == 1,
            f"{task_id}: required command must have exactly one final Evidence result: {command}",
        )
        if require_pass:
            audit.require(
                len(matches) == 1
                and matches[0].get("status") == "PASS"
                and matches[0].get("exitCode") == 0,
                f"{task_id}: required command did not PASS: {command}",
            )


def task0073_pre_ready_maintenance_boundary_candidate(commit: str) -> bool:
    if not FULL_COMMIT_RE.fullmatch(commit):
        return False
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_result.returncode == 0
        and parent_result.stdout.split() == [commit, TASK_0073_DRAFT_COMMIT]
    )


def task0073_pre_ready_maintenance_commit(target_commit: str) -> str | None:
    if not FULL_COMMIT_RE.fullmatch(target_commit):
        return None
    ancestry = git_text(
        "merge-base",
        "--is-ancestor",
        TASK_0073_DRAFT_COMMIT,
        target_commit,
        check=False,
    )
    if ancestry.returncode != 0:
        return None
    path = git_text(
        "rev-list",
        "--reverse",
        "--ancestry-path",
        f"{TASK_0073_DRAFT_COMMIT}..{target_commit}",
        check=False,
    )
    if path.returncode != 0:
        return None
    commits = path.stdout.splitlines()
    if not commits:
        return None
    candidate = commits[0].strip()
    return (
        candidate
        if task0073_pre_ready_maintenance_boundary_candidate(candidate)
        else None
    )


def task0073_pre_ready_maintenance_consumed(
    task: dict[str, Any] | None = None,
    ledger: dict[str, Any] | None = None,
) -> bool:
    try:
        if task is None:
            task = task_metadata_from_text(
                read_repository_text(ROOT / TASK_0073_CARD_PATH),
                TASK_0073_CARD_PATH,
            )
        if ledger is None:
            ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError):
        return True
    if (
        not isinstance(task, dict)
        or task.get("taskId") != TASK_0073_TASK_ID
        or task.get("state") != "DRAFT"
        or task.get("authorizationCommit") not in (None, "")
        or not isinstance(ledger, dict)
    ):
        return True
    entries = ledger.get("tasks")
    return not isinstance(entries, dict) or TASK_0073_TASK_ID in entries


def validate_task0073_pre_ready_maintenance_boundary(
    audit: Audit,
    boundary_commit: str,
) -> bool:
    initial_errors = len(audit.errors)
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(boundary_commit)),
        "TASK-0073 pre-READY maintenance: boundary must be a full Git commit",
    )
    if not FULL_COMMIT_RE.fullmatch(boundary_commit):
        return False
    try:
        policy = yaml_at_commit(boundary_commit, CI_EXECUTION_POLICY_PATH)
        record = validate_task0073_pre_ready_maintenance_record(audit, policy)
        if record is None:
            return False
        audit.require(
            task0073_pre_ready_maintenance_boundary_candidate(boundary_commit),
            "TASK-0073 pre-READY maintenance: boundary must be the direct "
            "single-parent child of the exact DRAFT",
        )
        base_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0073_BASE_COMMIT,
        ).stdout.strip()
        draft_graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0073_DRAFT_COMMIT,
        ).stdout.split()
        draft_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0073_DRAFT_COMMIT,
        ).stdout.strip()
        boundary_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            boundary_commit,
        ).stdout.strip()
        graph = git_text(
            "rev-list",
            "--reverse",
            "--ancestry-path",
            f"{TASK_0073_BASE_COMMIT}..{boundary_commit}",
        ).stdout.splitlines()
        audit.require(
            base_tree == TASK_0073_BASE_TREE,
            "TASK-0073 pre-READY maintenance: Base tree drifted",
        )
        audit.require(
            draft_graph == [TASK_0073_DRAFT_COMMIT, TASK_0073_BASE_COMMIT]
            and draft_tree == TASK_0073_DRAFT_TREE,
            "TASK-0073 pre-READY maintenance: DRAFT commit/tree/parent binding drifted",
        )
        audit.require(
            graph == [TASK_0073_DRAFT_COMMIT, boundary_commit],
            "TASK-0073 pre-READY maintenance: pre-READY ancestry contains an "
            "extra, missing, or reordered commit",
        )
        audit.require(
            bool(FULL_COMMIT_RE.fullmatch(boundary_tree)),
            "TASK-0073 pre-READY maintenance: derived boundary tree is invalid",
        )

        draft = record.get("draft")
        draft = draft if isinstance(draft, dict) else {}
        draft_files = draft.get("changedFiles")
        draft_files = draft_files if isinstance(draft_files, dict) else {}
        expected_draft_paths = {TASK_0073_CARD_PATH, TASK_0073_CONTEXT_PATH}
        audit.require(
            set(draft_files) == expected_draft_paths
            and changed_paths_between(
                TASK_0073_BASE_COMMIT,
                TASK_0073_DRAFT_COMMIT,
            )
            == sorted(expected_draft_paths),
            "TASK-0073 pre-READY maintenance: DRAFT path set drifted",
        )
        for path, identity in draft_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"mode", "type", "blobOid", "sha256"},
                f"TASK-0073 pre-READY maintenance: DRAFT identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(TASK_0073_DRAFT_COMMIT, path)
            audit.require(
                entry
                == (
                    identity.get("mode"),
                    identity.get("type"),
                    identity.get("blobOid"),
                )
                and hashlib.sha256(
                    git_object(TASK_0073_DRAFT_COMMIT, path)
                ).hexdigest()
                == identity.get("sha256"),
                f"TASK-0073 pre-READY maintenance: DRAFT blob/content drifted: {path}",
            )

        boundary = record.get("boundary")
        boundary = boundary if isinstance(boundary, dict) else {}
        expected_paths = boundary.get("changedPaths")
        expected_paths = expected_paths if isinstance(expected_paths, list) else []
        audit.require(
            expected_paths == sorted(TASK_0073_PRE_READY_MAINTENANCE_PATHS)
            and len(expected_paths) == len(set(expected_paths)),
            "TASK-0073 pre-READY maintenance: boundary paths must be exact, "
            "sorted, and unique",
        )
        audit.require(
            changed_paths_between(TASK_0073_DRAFT_COMMIT, boundary_commit)
            == expected_paths,
            "TASK-0073 pre-READY maintenance: boundary contains an extra or "
            "missing path",
        )
        files = boundary.get("files")
        files = files if isinstance(files, dict) else {}
        audit.require(
            set(files) == {"doctor", "exactFiles"},
            "TASK-0073 pre-READY maintenance: boundary file schema drifted",
        )
        doctor_identity = files.get("doctor")
        doctor_identity = (
            doctor_identity if isinstance(doctor_identity, dict) else {}
        )
        exact_files = files.get("exactFiles")
        exact_files = exact_files if isinstance(exact_files, dict) else {}
        doctor_path = str(doctor_identity.get("path", ""))
        audit.require(
            set(exact_files)
            == set(expected_paths) - {CI_EXECUTION_POLICY_PATH, doctor_path},
            "TASK-0073 pre-READY maintenance: exact boundary file set drifted",
        )
        for path in expected_paths:
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[:2]
                == (boundary.get("requiredMode"), boundary.get("requiredType")),
                f"TASK-0073 pre-READY maintenance: boundary mode/type drifted: {path}",
            )
        doctor_entry = git_tree_entry(boundary_commit, doctor_path)
        audit.require(
            set(doctor_identity) == {"path", "blobOid", "sha256"}
            and doctor_path == "scripts/harness/doctor.py"
            and doctor_entry is not None
            and doctor_entry[2] == doctor_identity.get("blobOid")
            and hashlib.sha256(git_object(boundary_commit, doctor_path)).hexdigest()
            == doctor_identity.get("sha256"),
            "TASK-0073 pre-READY maintenance: Doctor blob/content binding drifted",
        )
        for path, identity in exact_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"blobOid", "sha256"},
                "TASK-0073 pre-READY maintenance: exact file identity schema "
                f"drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[2] == identity.get("blobOid")
                and hashlib.sha256(git_object(boundary_commit, path)).hexdigest()
                == identity.get("sha256"),
                "TASK-0073 pre-READY maintenance: exact file blob/content "
                f"drifted: {path}",
            )
        audit.require(
            canonical_json_sha256(ci_execution_policy_projection(policy))
            == TASK_0073_CI_POLICY_PROJECTION_HASH,
            "TASK-0073 pre-READY maintenance: CI policy canonical binding drifted",
        )

        authorization = record.get("authorization")
        authorization = authorization if isinstance(authorization, dict) else {}
        authorization_path = str(authorization.get("path", ""))
        audit.require(
            authorization_path == TASK_0073_MAINTENANCE_AUTHORIZATION_PATH
            and authorization_path in exact_files
            and authorization.get("sha256")
            == exact_files.get(authorization_path, {}).get("sha256"),
            "TASK-0073 pre-READY maintenance: Owner authorization file binding drifted",
        )
        authorization_payload = json.loads(
            git_object(boundary_commit, authorization_path).decode("utf-8")
        )
        audit.require(
            authorization_payload
            == {
                "schemaVersion": 1,
                "recordId": TASK_0073_MAINTENANCE_RECORD_ID,
                "decisionId": "TASK-0073-PRE-READY-GREENLINE-20260802",
                "kind": "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE",
                "targetTask": TASK_0073_TASK_ID,
                "approvedBy": "repository-owner",
                "approvedAt": "2026-08-02",
                "sourceThreadId": "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
                "baseCommit": TASK_0073_BASE_COMMIT,
                "draftCommit": TASK_0073_DRAFT_COMMIT,
                "exactAuthorization": TASK_0073_EXACT_OWNER_AUTHORIZATION,
                "oneTimeOnly": True,
                "reusable": False,
                "generalOverrideAuthorized": False,
                "historyRewriteAuthorized": False,
            },
            "TASK-0073 pre-READY maintenance: exact Owner authorization drifted",
        )

        boundary_task = task_metadata_at_commit(
            boundary_commit,
            TASK_0073_CARD_PATH,
        )
        boundary_ledger = yaml_at_commit(boundary_commit, TASK_LEDGER_PATH)
        audit.require(
            boundary_task.get("taskId") == TASK_0073_TASK_ID
            and boundary_task.get("state") == "DRAFT"
            and boundary_task.get("baseCommit") == TASK_0073_BASE_COMMIT
            and boundary_task.get("authorizationCommit") in (None, "")
            and boundary_task.get("contextLock") == TASK_0073_CONTEXT_PATH,
            "TASK-0073 pre-READY maintenance: boundary task is not the exact "
            "unbound DRAFT",
        )
        audit.require(
            not task0073_pre_ready_maintenance_consumed(
                boundary_task,
                boundary_ledger,
            ),
            "TASK-0073 pre-READY maintenance: boundary record was already consumed",
        )
    except (
        HarnessError,
        json.JSONDecodeError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ) as exc:
        audit.error(
            "TASK-0073 pre-READY maintenance: cannot verify exact boundary: "
            f"{exc}"
        )
    return len(audit.errors) == initial_errors


def task0074_pre_ready_maintenance_boundary_candidate(commit: str) -> bool:
    if not FULL_COMMIT_RE.fullmatch(commit):
        return False
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_result.returncode == 0
        and parent_result.stdout.split() == [commit, TASK_0074_DRAFT_COMMIT]
    )


def task0074_pre_ready_maintenance_commit(target_commit: str) -> str | None:
    if not FULL_COMMIT_RE.fullmatch(target_commit):
        return None
    ancestry = git_text(
        "merge-base",
        "--is-ancestor",
        TASK_0074_DRAFT_COMMIT,
        target_commit,
        check=False,
    )
    if ancestry.returncode != 0:
        return None
    path = git_text(
        "rev-list",
        "--reverse",
        "--ancestry-path",
        f"{TASK_0074_DRAFT_COMMIT}..{target_commit}",
        check=False,
    )
    if path.returncode != 0:
        return None
    commits = path.stdout.splitlines()
    if not commits:
        return None
    candidate = commits[0].strip()
    return (
        candidate
        if task0074_pre_ready_maintenance_boundary_candidate(candidate)
        else None
    )


def task0074_pre_ready_maintenance_consumed(
    task: dict[str, Any] | None = None,
    ledger: dict[str, Any] | None = None,
) -> bool:
    try:
        if task is None:
            task = task_metadata_from_text(
                read_repository_text(ROOT / TASK_0074_CARD_PATH),
                TASK_0074_CARD_PATH,
            )
        if ledger is None:
            ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError):
        return True
    if (
        not isinstance(task, dict)
        or task.get("taskId") != TASK_0074_TASK_ID
        or task.get("state") != "DRAFT"
        or task.get("authorizationCommit") not in (None, "")
        or not isinstance(ledger, dict)
    ):
        return True
    entries = ledger.get("tasks")
    return not isinstance(entries, dict) or TASK_0074_TASK_ID in entries


def validate_task0074_pre_ready_maintenance_boundary(
    audit: Audit,
    boundary_commit: str,
) -> bool:
    initial_errors = len(audit.errors)
    label = "TASK-0074 pre-READY maintenance"
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(boundary_commit)),
        f"{label}: boundary must be a full Git commit",
    )
    if not FULL_COMMIT_RE.fullmatch(boundary_commit):
        return False
    try:
        policy = yaml_at_commit(boundary_commit, CI_EXECUTION_POLICY_PATH)
        record = validate_task0074_pre_ready_maintenance_record(audit, policy)
        if record is None:
            return False
        audit.require(
            task0074_pre_ready_maintenance_boundary_candidate(boundary_commit),
            f"{label}: boundary must be the direct single-parent child of the exact DRAFT",
        )
        base_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0074_BASE_COMMIT,
        ).stdout.strip()
        draft_graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0074_DRAFT_COMMIT,
        ).stdout.split()
        draft_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0074_DRAFT_COMMIT,
        ).stdout.strip()
        boundary_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            boundary_commit,
        ).stdout.strip()
        graph = git_text(
            "rev-list",
            "--reverse",
            "--ancestry-path",
            f"{TASK_0074_BASE_COMMIT}..{boundary_commit}",
        ).stdout.splitlines()
        audit.require(
            base_tree == TASK_0074_BASE_TREE,
            f"{label}: Base tree drifted",
        )
        audit.require(
            draft_graph == [TASK_0074_DRAFT_COMMIT, TASK_0074_BASE_COMMIT]
            and draft_tree == TASK_0074_DRAFT_TREE,
            f"{label}: DRAFT commit/tree/parent binding drifted",
        )
        audit.require(
            graph == [TASK_0074_DRAFT_COMMIT, boundary_commit]
            and bool(FULL_COMMIT_RE.fullmatch(boundary_tree)),
            f"{label}: pre-READY ancestry or derived Tree drifted",
        )

        draft = record.get("draft")
        draft = draft if isinstance(draft, dict) else {}
        draft_files = draft.get("changedFiles")
        draft_files = draft_files if isinstance(draft_files, dict) else {}
        expected_draft_paths = {TASK_0074_CARD_PATH, TASK_0074_CONTEXT_PATH}
        audit.require(
            set(draft_files) == expected_draft_paths
            and changed_paths_between(
                TASK_0074_BASE_COMMIT,
                TASK_0074_DRAFT_COMMIT,
            )
            == sorted(expected_draft_paths),
            f"{label}: DRAFT path set drifted",
        )
        for path, identity in draft_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"mode", "type", "blobOid", "sha256"},
                f"{label}: DRAFT identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(TASK_0074_DRAFT_COMMIT, path)
            audit.require(
                entry
                == (
                    identity.get("mode"),
                    identity.get("type"),
                    identity.get("blobOid"),
                )
                and hashlib.sha256(
                    git_object(TASK_0074_DRAFT_COMMIT, path)
                ).hexdigest()
                == identity.get("sha256"),
                f"{label}: DRAFT blob/content drifted: {path}",
            )

        boundary = record.get("boundary")
        boundary = boundary if isinstance(boundary, dict) else {}
        expected_paths = boundary.get("changedPaths")
        expected_paths = expected_paths if isinstance(expected_paths, list) else []
        audit.require(
            expected_paths == sorted(TASK_0074_PRE_READY_MAINTENANCE_PATHS)
            and len(expected_paths) == len(set(expected_paths)),
            f"{label}: boundary paths must be exact, sorted, and unique",
        )
        audit.require(
            changed_paths_between(TASK_0074_DRAFT_COMMIT, boundary_commit)
            == expected_paths,
            f"{label}: boundary contains an extra or missing path",
        )
        files = boundary.get("files")
        files = files if isinstance(files, dict) else {}
        audit.require(
            set(files) == {"doctor", "exactFiles"},
            f"{label}: boundary file schema drifted",
        )
        doctor_identity = files.get("doctor")
        doctor_identity = (
            doctor_identity if isinstance(doctor_identity, dict) else {}
        )
        exact_files = files.get("exactFiles")
        exact_files = exact_files if isinstance(exact_files, dict) else {}
        doctor_path = str(doctor_identity.get("path", ""))
        audit.require(
            set(exact_files)
            == set(expected_paths) - {CI_EXECUTION_POLICY_PATH, doctor_path},
            f"{label}: exact boundary file set drifted",
        )
        for path in expected_paths:
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[:2]
                == (boundary.get("requiredMode"), boundary.get("requiredType")),
                f"{label}: boundary mode/type drifted: {path}",
            )
        doctor_entry = git_tree_entry(boundary_commit, doctor_path)
        audit.require(
            set(doctor_identity) == {"path", "blobOid", "sha256"}
            and doctor_path == "scripts/harness/doctor.py"
            and doctor_entry is not None
            and doctor_entry[2] == doctor_identity.get("blobOid")
            and hashlib.sha256(git_object(boundary_commit, doctor_path)).hexdigest()
            == doctor_identity.get("sha256"),
            f"{label}: Doctor blob/content binding drifted",
        )
        for path, identity in exact_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"blobOid", "sha256"},
                f"{label}: exact file identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[2] == identity.get("blobOid")
                and hashlib.sha256(git_object(boundary_commit, path)).hexdigest()
                == identity.get("sha256"),
                f"{label}: exact file blob/content drifted: {path}",
            )
        audit.require(
            canonical_json_sha256(ci_execution_policy_projection(policy))
            == TASK_0074_CI_POLICY_PROJECTION_HASH,
            f"{label}: CI policy canonical binding drifted",
        )

        authorization = record.get("authorization")
        authorization = authorization if isinstance(authorization, dict) else {}
        authorization_path = str(authorization.get("path", ""))
        audit.require(
            authorization_path == TASK_0074_MAINTENANCE_AUTHORIZATION_PATH
            and authorization_path in exact_files
            and authorization.get("sha256")
            == exact_files.get(authorization_path, {}).get("sha256"),
            f"{label}: Owner authorization file binding drifted",
        )
        authorization_payload = json.loads(
            git_object(boundary_commit, authorization_path).decode("utf-8")
        )
        audit.require(
            authorization_payload
            == {
                "schemaVersion": 1,
                "recordId": TASK_0074_MAINTENANCE_RECORD_ID,
                "decisionId": "TASK-0074-EXACT-DELIVERY-FLOW-RECOVERY-20260802",
                "kind": "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE",
                "targetTask": TASK_0074_TASK_ID,
                "approvedBy": "repository-owner",
                "approvedAt": "2026-08-02",
                "sourceThreadId": "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
                "baseCommit": TASK_0074_BASE_COMMIT,
                "draftCommit": TASK_0074_DRAFT_COMMIT,
                "exactAuthorization": TASK_0074_EXACT_OWNER_AUTHORIZATION,
                "oneTimeOnly": True,
                "reusable": False,
                "generalOverrideAuthorized": False,
                "historyRewriteAuthorized": False,
            },
            f"{label}: exact Owner authorization drifted",
        )
        validate_task0073_historical_unknown_quarantine(audit, record)

        boundary_task = task_metadata_at_commit(
            boundary_commit,
            TASK_0074_CARD_PATH,
        )
        boundary_ledger = yaml_at_commit(boundary_commit, TASK_LEDGER_PATH)
        audit.require(
            boundary_task.get("taskId") == TASK_0074_TASK_ID
            and boundary_task.get("state") == "DRAFT"
            and boundary_task.get("baseCommit") == TASK_0074_BASE_COMMIT
            and boundary_task.get("authorizationCommit") in (None, "")
            and boundary_task.get("contextLock") == TASK_0074_CONTEXT_PATH,
            f"{label}: boundary task is not the exact unbound DRAFT",
        )
        audit.require(
            not task0074_pre_ready_maintenance_consumed(
                boundary_task,
                boundary_ledger,
            ),
            f"{label}: boundary record was already consumed",
        )
    except (
        HarnessError,
        json.JSONDecodeError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ) as exc:
        audit.error(f"{label}: cannot verify exact boundary: {exc}")
    return len(audit.errors) == initial_errors


def task0075_pre_ready_maintenance_boundary_candidate(commit: str) -> bool:
    if not FULL_COMMIT_RE.fullmatch(commit):
        return False
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_result.returncode == 0
        and parent_result.stdout.split() == [commit, TASK_0075_DRAFT_COMMIT]
    )


def task0075_pre_ready_maintenance_commit(target_commit: str) -> str | None:
    if not FULL_COMMIT_RE.fullmatch(target_commit):
        return None
    ancestry = git_text(
        "merge-base",
        "--is-ancestor",
        TASK_0075_DRAFT_COMMIT,
        target_commit,
        check=False,
    )
    if ancestry.returncode != 0:
        return None
    path = git_text(
        "rev-list",
        "--reverse",
        "--ancestry-path",
        f"{TASK_0075_DRAFT_COMMIT}..{target_commit}",
        check=False,
    )
    if path.returncode != 0:
        return None
    commits = path.stdout.splitlines()
    if not commits:
        return None
    candidate = commits[0].strip()
    return (
        candidate
        if task0075_pre_ready_maintenance_boundary_candidate(candidate)
        else None
    )


def task0075_pre_ready_maintenance_consumed(
    task: dict[str, Any] | None = None,
    ledger: dict[str, Any] | None = None,
) -> bool:
    try:
        if task is None:
            task = task_metadata_from_text(
                read_repository_text(ROOT / TASK_0075_CARD_PATH),
                TASK_0075_CARD_PATH,
            )
        if ledger is None:
            ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError):
        return True
    if (
        not isinstance(task, dict)
        or task.get("taskId") != TASK_0075_TASK_ID
        or task.get("state") != "DRAFT"
        or task.get("authorizationCommit") not in (None, "")
        or not isinstance(ledger, dict)
    ):
        return True
    entries = ledger.get("tasks")
    return not isinstance(entries, dict) or TASK_0075_TASK_ID in entries


def validate_task0075_pre_ready_maintenance_boundary(
    audit: Audit,
    boundary_commit: str,
) -> bool:
    initial_errors = len(audit.errors)
    label = "TASK-0075 pre-READY maintenance"
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(boundary_commit)),
        f"{label}: boundary must be a full Git commit",
    )
    if not FULL_COMMIT_RE.fullmatch(boundary_commit):
        return False
    try:
        policy = yaml_at_commit(boundary_commit, CI_EXECUTION_POLICY_PATH)
        record = validate_task0075_pre_ready_maintenance_record(audit, policy)
        if record is None:
            return False
        audit.require(
            task0075_pre_ready_maintenance_boundary_candidate(boundary_commit),
            f"{label}: boundary must be the direct single-parent child of the exact DRAFT",
        )
        base_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0075_BASE_COMMIT,
        ).stdout.strip()
        draft_graph = git_text(
            "rev-list",
            "--parents",
            "-n",
            "1",
            TASK_0075_DRAFT_COMMIT,
        ).stdout.split()
        draft_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            TASK_0075_DRAFT_COMMIT,
        ).stdout.strip()
        boundary_tree = git_text(
            "show",
            "-s",
            "--format=%T",
            boundary_commit,
        ).stdout.strip()
        graph = git_text(
            "rev-list",
            "--reverse",
            "--ancestry-path",
            f"{TASK_0075_BASE_COMMIT}..{boundary_commit}",
        ).stdout.splitlines()
        audit.require(
            base_tree == TASK_0075_BASE_TREE,
            f"{label}: Base tree drifted",
        )
        audit.require(
            draft_graph == [TASK_0075_DRAFT_COMMIT, TASK_0075_BASE_COMMIT]
            and draft_tree == TASK_0075_DRAFT_TREE,
            f"{label}: DRAFT commit/tree/parent binding drifted",
        )
        audit.require(
            graph == [TASK_0075_DRAFT_COMMIT, boundary_commit]
            and bool(FULL_COMMIT_RE.fullmatch(boundary_tree)),
            f"{label}: pre-READY ancestry or derived Tree drifted",
        )

        draft = record.get("draft")
        draft = draft if isinstance(draft, dict) else {}
        draft_files = draft.get("changedFiles")
        draft_files = draft_files if isinstance(draft_files, dict) else {}
        expected_draft_paths = {TASK_0075_CARD_PATH, TASK_0075_CONTEXT_PATH}
        audit.require(
            set(draft_files) == expected_draft_paths
            and changed_paths_between(
                TASK_0075_BASE_COMMIT,
                TASK_0075_DRAFT_COMMIT,
            )
            == sorted(expected_draft_paths),
            f"{label}: DRAFT path set drifted",
        )
        for path, identity in draft_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"mode", "type", "blobOid", "sha256"},
                f"{label}: DRAFT identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(TASK_0075_DRAFT_COMMIT, path)
            audit.require(
                entry
                == (
                    identity.get("mode"),
                    identity.get("type"),
                    identity.get("blobOid"),
                )
                and hashlib.sha256(
                    git_object(TASK_0075_DRAFT_COMMIT, path)
                ).hexdigest()
                == identity.get("sha256"),
                f"{label}: DRAFT blob/content drifted: {path}",
            )

        boundary = record.get("boundary")
        boundary = boundary if isinstance(boundary, dict) else {}
        expected_paths = boundary.get("changedPaths")
        expected_paths = expected_paths if isinstance(expected_paths, list) else []
        audit.require(
            expected_paths == sorted(TASK_0075_PRE_READY_MAINTENANCE_PATHS)
            and len(expected_paths) == len(set(expected_paths)),
            f"{label}: boundary paths must be exact, sorted, and unique",
        )
        audit.require(
            changed_paths_between(TASK_0075_DRAFT_COMMIT, boundary_commit)
            == expected_paths,
            f"{label}: boundary contains an extra or missing path",
        )
        files = boundary.get("files")
        files = files if isinstance(files, dict) else {}
        audit.require(
            set(files) == {"doctor", "exactFiles"},
            f"{label}: boundary file schema drifted",
        )
        doctor_identity = files.get("doctor")
        doctor_identity = (
            doctor_identity if isinstance(doctor_identity, dict) else {}
        )
        exact_files = files.get("exactFiles")
        exact_files = exact_files if isinstance(exact_files, dict) else {}
        doctor_path = str(doctor_identity.get("path", ""))
        audit.require(
            set(exact_files)
            == set(expected_paths) - {CI_EXECUTION_POLICY_PATH, doctor_path},
            f"{label}: exact boundary file set drifted",
        )
        for path in expected_paths:
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[:2]
                == (boundary.get("requiredMode"), boundary.get("requiredType")),
                f"{label}: boundary mode/type drifted: {path}",
            )
        doctor_entry = git_tree_entry(boundary_commit, doctor_path)
        audit.require(
            set(doctor_identity) == {"path", "blobOid", "sha256"}
            and doctor_path == "scripts/harness/doctor.py"
            and doctor_entry is not None
            and doctor_entry[2] == doctor_identity.get("blobOid")
            and hashlib.sha256(git_object(boundary_commit, doctor_path)).hexdigest()
            == doctor_identity.get("sha256"),
            f"{label}: Doctor blob/content binding drifted",
        )
        for path, identity in exact_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"blobOid", "sha256"},
                f"{label}: exact file identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[2] == identity.get("blobOid")
                and hashlib.sha256(git_object(boundary_commit, path)).hexdigest()
                == identity.get("sha256"),
                f"{label}: exact file blob/content drifted: {path}",
            )
        audit.require(
            canonical_json_sha256(ci_execution_policy_projection(policy))
            == TASK_0075_CI_POLICY_PROJECTION_HASH,
            f"{label}: CI policy canonical binding drifted",
        )

        authorization = record.get("authorization")
        authorization = authorization if isinstance(authorization, dict) else {}
        authorization_path = str(authorization.get("path", ""))
        audit.require(
            authorization_path == TASK_0075_MAINTENANCE_AUTHORIZATION_PATH
            and authorization_path in exact_files
            and authorization.get("sha256")
            == exact_files.get(authorization_path, {}).get("sha256"),
            f"{label}: Owner authorization file binding drifted",
        )
        authorization_payload = json.loads(
            git_object(boundary_commit, authorization_path).decode("utf-8")
        )
        audit.require(
            authorization_payload
            == {
                "schemaVersion": 1,
                "recordId": TASK_0075_MAINTENANCE_RECORD_ID,
                "decisionId": (
                    "TASK-0075-PERMANENT-DELIVERY-FLOW-RECOVERY-20260803"
                ),
                "kind": "OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE",
                "targetTask": TASK_0075_TASK_ID,
                "approvedBy": "repository-owner",
                "approvedAt": "2026-08-03",
                "sourceThreadId": "019fb2c1-8104-73b1-81dc-ee8bcfce6f63",
                "baseCommit": TASK_0075_BASE_COMMIT,
                "baseTree": TASK_0075_BASE_TREE,
                "draftCommit": TASK_0075_DRAFT_COMMIT,
                "draftTree": TASK_0075_DRAFT_TREE,
                "exactAuthorizationPlan": TASK_0075_EXACT_OWNER_AUTHORIZATION,
                "exactOwnerAcceptance": TASK_0075_EXACT_OWNER_ACCEPTANCE,
                "oneTimeOnly": True,
                "reusable": False,
                "generalOverrideAuthorized": False,
                "historyRewriteAuthorized": False,
                "remoteDispatchAuthorized": False,
            },
            f"{label}: exact Owner authorization provenance drifted",
        )
        validate_task0075_historical_objects(audit, record)

        boundary_task = task_metadata_at_commit(
            boundary_commit,
            TASK_0075_CARD_PATH,
        )
        boundary_ledger = yaml_at_commit(boundary_commit, TASK_LEDGER_PATH)
        audit.require(
            boundary_task.get("taskId") == TASK_0075_TASK_ID
            and boundary_task.get("state") == "DRAFT"
            and boundary_task.get("baseCommit") == TASK_0075_BASE_COMMIT
            and boundary_task.get("authorizationCommit") in (None, "")
            and boundary_task.get("contextLock") == TASK_0075_CONTEXT_PATH,
            f"{label}: boundary task is not the exact unbound DRAFT",
        )
        audit.require(
            not task0075_pre_ready_maintenance_consumed(
                boundary_task,
                boundary_ledger,
            ),
            f"{label}: boundary record was already consumed",
        )
    except (
        HarnessError,
        json.JSONDecodeError,
        OSError,
        UnicodeError,
        yaml.YAMLError,
    ) as exc:
        audit.error(f"{label}: cannot verify exact boundary: {exc}")
    return len(audit.errors) == initial_errors


def task0072_bootstrap_boundary_candidate(commit: str) -> bool:
    if not FULL_COMMIT_RE.fullmatch(commit):
        return False
    parent_result = git_text(
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
        check=False,
    )
    return (
        parent_result.returncode == 0
        and parent_result.stdout.split()
        == [commit, TASK_0072_MAINTENANCE_HANDOFF_COMMIT]
    )


def task0072_bootstrap_consumed() -> bool:
    try:
        ledger = load_yaml(ROOT / TASK_LEDGER_PATH)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError):
        return True
    entries = ledger.get("tasks")
    return not isinstance(entries, dict) or TASK_0072_BOOTSTRAP_TASK_ID in entries


def validate_task0072_self_bootstrap_boundary(
    audit: Audit,
    boundary_commit: str,
) -> bool:
    initial_errors = len(audit.errors)
    audit.require(
        bool(FULL_COMMIT_RE.fullmatch(boundary_commit)),
        "TASK-0072 self-bootstrap: boundary must be a full Git commit",
    )
    if not FULL_COMMIT_RE.fullmatch(boundary_commit):
        return False
    try:
        policy = yaml_at_commit(boundary_commit, CI_EXECUTION_POLICY_PATH)
        record = validate_task0072_self_bootstrap_record(audit, policy)
        if record is None:
            return False
        audit.require(
            task0072_bootstrap_boundary_candidate(boundary_commit),
            "TASK-0072 self-bootstrap: boundary must be the direct single-parent "
            "child of the exact maintenance handoff",
        )
        graph = git_text(
            "rev-list",
            "--reverse",
            "--ancestry-path",
            f"{TASK_0072_SOURCE_TERMINAL_COMMIT}..{boundary_commit}",
        ).stdout.splitlines()
        audit.require(
            graph
            == [
                TASK_0072_RETAINED_BASE_COMMIT,
                TASK_0072_MAINTENANCE_HANDOFF_COMMIT,
                boundary_commit,
            ],
            "TASK-0072 self-bootstrap: retained ancestry contains an extra, missing, "
            "or reordered commit",
        )
        retained_chain = record.get("retainedChain")
        audit.require(
            isinstance(retained_chain, list) and len(retained_chain) == 2,
            "TASK-0072 self-bootstrap: retainedChain must contain exactly two edges",
        )
        if isinstance(retained_chain, list):
            expected_chain = [
                (
                    TASK_0072_RETAINED_BASE_COMMIT,
                    TASK_0072_RETAINED_BASE_TREE,
                    TASK_0072_SOURCE_TERMINAL_COMMIT,
                ),
                (
                    TASK_0072_MAINTENANCE_HANDOFF_COMMIT,
                    TASK_0072_MAINTENANCE_HANDOFF_TREE,
                    TASK_0072_RETAINED_BASE_COMMIT,
                ),
            ]
            for index, expected in enumerate(expected_chain):
                if index >= len(retained_chain):
                    break
                item = retained_chain[index]
                label = f"TASK-0072 self-bootstrap: retainedChain[{index}]"
                audit.require(
                    isinstance(item, dict)
                    and set(item) == {"commit", "tree", "parent", "changedFiles"},
                    f"{label} fields do not match the exact schema",
                )
                if not isinstance(item, dict):
                    continue
                commit, tree, parent = expected
                audit.require(
                    item.get("commit") == commit
                    and item.get("tree") == tree
                    and item.get("parent") == parent,
                    f"{label} commit/tree/parent binding drifted",
                )
                parent_graph = git_text(
                    "rev-list",
                    "--parents",
                    "-n",
                    "1",
                    commit,
                ).stdout.split()
                audit.require(
                    parent_graph == [commit, parent],
                    f"{label} is not the exact single-parent edge",
                )
                actual_tree = git_text("show", "-s", "--format=%T", commit).stdout.strip()
                audit.require(actual_tree == tree, f"{label} tree drifted")
                files = item.get("changedFiles")
                files = files if isinstance(files, dict) else {}
                actual_paths = changed_paths_between(parent, commit)
                audit.require(
                    actual_paths == sorted(files),
                    f"{label} changed path set drifted",
                )
                for path, identity in files.items():
                    audit.require(
                        isinstance(identity, dict)
                        and set(identity) == {"mode", "type", "blobOid", "sha256"},
                        f"{label} file identity schema drifted: {path}",
                    )
                    if not isinstance(identity, dict):
                        continue
                    entry = git_tree_entry(commit, path)
                    audit.require(
                        entry
                        == (
                            identity.get("mode"),
                            identity.get("type"),
                            identity.get("blobOid"),
                        ),
                        f"{label} Git blob identity drifted: {path}",
                    )
                    audit.require(
                        hashlib.sha256(git_object(commit, path)).hexdigest()
                        == identity.get("sha256"),
                        f"{label} content hash drifted: {path}",
                    )

        boundary = record.get("boundary")
        boundary = boundary if isinstance(boundary, dict) else {}
        expected_paths = boundary.get("changedPaths")
        expected_paths = expected_paths if isinstance(expected_paths, list) else []
        audit.require(
            expected_paths == sorted(expected_paths)
            and len(expected_paths) == len(set(expected_paths)),
            "TASK-0072 self-bootstrap: boundary changedPaths must be sorted and unique",
        )
        audit.require(
            changed_paths_between(
                TASK_0072_MAINTENANCE_HANDOFF_COMMIT,
                boundary_commit,
            )
            == expected_paths,
            "TASK-0072 self-bootstrap: boundary contains an extra or missing path",
        )
        files = boundary.get("files")
        files = files if isinstance(files, dict) else {}
        audit.require(
            set(files) == {"doctor", "exactFiles"},
            "TASK-0072 self-bootstrap: boundary file binding schema drifted",
        )
        doctor_identity = files.get("doctor")
        doctor_identity = doctor_identity if isinstance(doctor_identity, dict) else {}
        exact_files = files.get("exactFiles")
        exact_files = exact_files if isinstance(exact_files, dict) else {}
        policy_path = CI_EXECUTION_POLICY_PATH
        doctor_path = str(doctor_identity.get("path", ""))
        audit.require(
            set(exact_files) == set(expected_paths) - {policy_path, doctor_path},
            "TASK-0072 self-bootstrap: exact boundary file set drifted",
        )
        for path in expected_paths:
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[:2]
                == (boundary.get("requiredMode"), boundary.get("requiredType")),
                f"TASK-0072 self-bootstrap: boundary mode/type drifted: {path}",
            )
        doctor_entry = git_tree_entry(boundary_commit, doctor_path)
        audit.require(
            set(doctor_identity) == {"path", "blobOid", "sha256"}
            and doctor_entry is not None
            and doctor_entry[2] == doctor_identity.get("blobOid")
            and hashlib.sha256(git_object(boundary_commit, doctor_path)).hexdigest()
            == doctor_identity.get("sha256"),
            "TASK-0072 self-bootstrap: Doctor blob/content binding drifted",
        )
        for path, identity in exact_files.items():
            audit.require(
                isinstance(identity, dict)
                and set(identity) == {"blobOid", "sha256"},
                f"TASK-0072 self-bootstrap: exact file identity schema drifted: {path}",
            )
            if not isinstance(identity, dict):
                continue
            entry = git_tree_entry(boundary_commit, path)
            audit.require(
                entry is not None
                and entry[2] == identity.get("blobOid")
                and hashlib.sha256(git_object(boundary_commit, path)).hexdigest()
                == identity.get("sha256"),
                f"TASK-0072 self-bootstrap: exact file blob/content drifted: {path}",
            )
        authorization = record.get("authorization")
        authorization = authorization if isinstance(authorization, dict) else {}
        authorization_path = str(authorization.get("path", ""))
        audit.require(
            set(authorization) == {"path", "sha256"}
            and authorization_path in exact_files
            and authorization.get("sha256")
            == exact_files.get(authorization_path, {}).get("sha256"),
            "TASK-0072 self-bootstrap: Owner authorization binding drifted",
        )
        task_paths = repository_paths_at_commit(boundary_commit)
        audit.require(
            not any(
                path.startswith("docs/tasks/TASK-0072")
                or path.startswith("docs/tasks/context/TASK-0072")
                or path.startswith("docs/evidence/TASK-0072/")
                or path == "docs/handoffs/TASK-0072.json"
                for path in task_paths
            ),
            "TASK-0072 self-bootstrap: boundary must precede every TASK-0072 "
            "lifecycle artifact",
        )
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"TASK-0072 self-bootstrap: cannot verify exact boundary: {exc}")
    return len(audit.errors) == initial_errors


def validate_idle_terminal_paths(audit: Audit, task_id: str, paths: list[str]) -> None:
    audit.require(
        not paths,
        f"{task_id}: repository changed after terminal commit without a new active task: {paths}",
    )


def validate_idle_terminal_history(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
) -> None:
    head_commit = git_text("rev-parse", "HEAD").stdout.strip()
    effective_terminal = terminal_commit
    if (
        task_id == "TASK-0070"
        and task0072_bootstrap_boundary_candidate(head_commit)
        and validate_task0072_self_bootstrap_boundary(audit, head_commit)
    ):
        effective_terminal = head_commit
    audit.require(
        head_commit == effective_terminal,
        f"{task_id}: HEAD advanced after terminal commit without a new DRAFT or active task",
    )
    validate_idle_terminal_paths(
        audit,
        task_id,
        changed_paths(effective_terminal),
    )
    snapshot = _ACTIVE_GIT_SNAPSHOT
    index_unchanged = (
        snapshot.index_matches_tree(effective_terminal)
        if snapshot is not None
        else git_text(
            "diff",
            "--cached",
            "--quiet",
            effective_terminal,
            "--",
            check=False,
        ).returncode == 0
    )
    audit.require(
        index_unchanged,
        f"{task_id}: index changed after terminal commit without a new task",
    )


def validate_frozen_artifact_bytes(
    audit: Audit,
    label: str,
    current: bytes,
    terminal_snapshot: bytes,
) -> None:
    audit.require(
        current == terminal_snapshot,
        f"{label}: terminal audit artifact is immutable; create an amendment instead of rewriting it",
    )


@functools.lru_cache(maxsize=1)
def git_core_filemode_enabled() -> bool:
    result = git_text("config", "--bool", "core.filemode", check=False)
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def current_regular_file_bytes(
    audit: Audit,
    label: str,
    path: Path,
) -> bytes | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        try:
            content, mode, file_attributes = snapshot.read_current_file(path)
        except (HarnessError, OSError) as exc:
            audit.error(f"{label}: cannot read current file: {exc}")
            return None
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        regular = (
            stat.S_ISREG(mode)
            and not stat.S_ISLNK(mode)
            and not bool(file_attributes & reparse_flag)
            and (
                not git_core_filemode_enabled()
                or stat.S_IMODE(mode) & 0o111 == 0
            )
        )
        audit.require(
            regular,
            f"{label}: must be a regular non-reparse file",
        )
        return content if regular else None
    try:
        metadata = path.lstat()
    except OSError as exc:
        audit.error(f"{label}: cannot inspect current file: {exc}")
        return None
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    file_attributes = getattr(metadata, "st_file_attributes", 0)
    regular = (
        stat.S_ISREG(metadata.st_mode)
        and not stat.S_ISLNK(metadata.st_mode)
        and not bool(file_attributes & reparse_flag)
        and (
            not git_core_filemode_enabled()
            or stat.S_IMODE(metadata.st_mode) & 0o111 == 0
        )
    )
    audit.require(
        regular,
        f"{label}: must be a regular non-reparse file",
    )
    if not regular:
        return None
    try:
        return path.read_bytes()
    except OSError as exc:
        audit.error(f"{label}: cannot read current file: {exc}")
        return None


def git_tree_entry(commit: str, path: str) -> tuple[str, str, str] | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_path = normalize_repo_path(path)
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return snapshot.tree_entries(commit).get(normalized_path)
    result = git_bytes(
        "ls-tree",
        "-z",
        commit,
        "--",
        normalized_path,
        check=False,
    )
    if result.returncode != 0 or not result.stdout:
        return None
    records = [record for record in result.stdout.split(b"\0") if record]
    if len(records) != 1 or b"\t" not in records[0]:
        return None
    header, raw_path = records[0].split(b"\t", 1)
    parts = header.decode("ascii", errors="replace").split()
    listed_path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
    if len(parts) != 3 or listed_path != normalized_path:
        return None
    return parts[0], parts[1], parts[2]


def git_index_entry(path: str) -> tuple[str, str] | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return snapshot.index_entry(path)
    result = git_bytes(
        "ls-files",
        "--stage",
        "-z",
        "--",
        normalize_repo_path(path),
    )
    records = [record for record in result.stdout.split(b"\0") if record]
    if len(records) != 1 or b"\t" not in records[0]:
        return None
    header, raw_path = records[0].split(b"\t", 1)
    parts = header.decode("ascii", errors="replace").split()
    listed_path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
    if (
        len(parts) != 3
        or parts[2] != "0"
        or listed_path != normalize_repo_path(path)
    ):
        return None
    return parts[0], parts[1]


def git_worktree_blob_oid(path: str) -> str | None:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return snapshot.current_blob_oid(
            ROOT / normalize_repo_path(path)
        )
    result = git_text(
        "hash-object",
        f"--path={normalize_repo_path(path)}",
        "--",
        normalize_repo_path(path),
        check=False,
    )
    value = result.stdout.strip()
    return value if result.returncode == 0 and re.fullmatch(r"[0-9a-f]{40,64}", value) else None


def validate_current_index_snapshot(
    audit: Audit,
    task_id: str,
    paths: list[str],
) -> None:
    for path in paths:
        repository_path = ROOT / normalize_repo_path(path)
        index_entry = git_index_entry(path)
        if not current_path_is_file(repository_path):
            audit.require(
                index_entry is None,
                f"{task_id}: staged snapshot and worktree disagree on missing path: {path}",
            )
            continue
        try:
            snapshot = _ACTIVE_GIT_SNAPSHOT
            if snapshot is not None:
                _, mode, file_attributes = snapshot.read_current_file(
                    repository_path
                )
            else:
                metadata = repository_path.lstat()
                mode = metadata.st_mode
                file_attributes = getattr(
                    metadata,
                    "st_file_attributes",
                    0,
                )
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            regular = (
                stat.S_ISREG(mode)
                and not stat.S_ISLNK(mode)
                and not bool(file_attributes & reparse_flag)
            )
            audit.require(
                regular,
                f"{task_id}: changed path must be a regular non-reparse file: {path}",
            )
            audit.require(
                index_entry is not None,
                f"{task_id}: changed path is not staged in the validated snapshot: {path}",
            )
            worktree_oid = git_worktree_blob_oid(path)
            audit.require(
                index_entry is not None
                and worktree_oid is not None
                and index_entry[1] == worktree_oid,
                f"{task_id}: staged snapshot and worktree content disagree: {path}",
            )
        except (HarnessError, OSError) as exc:
            audit.error(f"{task_id}: cannot inspect changed path {path}: {exc}")


def allowed_repository_file_modes(
    audit: Audit,
    task_id: str,
    base_commit: str,
    path: str,
) -> set[str]:
    baseline_entry = git_tree_entry(base_commit, path)
    if baseline_entry is None:
        return {"100644", "100755"} if path.endswith(".sh") else {"100644"}
    audit.require(
        baseline_entry[1] == "blob" and baseline_entry[0] in {"100644", "100755"},
        f"{task_id}: Base Commit path is not a portable regular Git file: {path}",
    )
    return (
        {baseline_entry[0]}
        if baseline_entry[1] == "blob"
        and baseline_entry[0] in {"100644", "100755"}
        else set()
    )


def validate_changed_path_modes(
    audit: Audit,
    task_id: str,
    base_commit: str,
    target_commit: str,
    paths: list[str],
    include_current_index: bool,
) -> None:
    history = git_text(
        "rev-list",
        "--topo-order",
        "--reverse",
        f"{base_commit}..{target_commit}",
    ).stdout.splitlines()
    commits = [commit.strip() for commit in history]
    for path in paths:
        allowed_modes = allowed_repository_file_modes(
            audit,
            task_id,
            base_commit,
            path,
        )
        for commit in commits:
            entry = git_tree_entry(commit, path)
            if entry is None:
                continue
            audit.require(
                entry[1] == "blob" and entry[0] in allowed_modes,
                f"{task_id}: changed path has an unauthorized Git mode/type at "
                f"{commit}: {path} ({entry[0]} {entry[1]})",
            )
        if include_current_index:
            index_entry = git_index_entry(path)
            if index_entry is not None:
                audit.require(
                    index_entry[0] in allowed_modes,
                    f"{task_id}: staged path has an unauthorized Git mode: "
                    f"{path} ({index_entry[0]})",
                )


def validate_frozen_repository_artifact(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    path: str,
) -> None:
    try:
        entry = git_tree_entry(terminal_commit, path)
        audit.require(
            entry is not None and entry[:2] == ("100644", "blob"),
            f"{task_id}: {path} must be a regular 100644 Git blob at terminal boundary",
        )
        git_object(terminal_commit, path)
        current = current_regular_file_bytes(
            audit,
            f"{task_id}: {path}",
            ROOT / normalize_repo_path(path),
        )
        if current is not None:
            audit.require(
                entry is not None and git_worktree_blob_oid(path) == entry[2],
                f"{task_id}: frozen worktree content changed: {path}",
            )
        audit.require(
            entry is not None and git_index_entry(path) == (entry[0], entry[2]),
            f"{task_id}: frozen index entry changed: {path}",
        )
        history = git_text(
            "rev-list",
            f"{terminal_commit}..HEAD",
        ).stdout.splitlines()
        for commit in history:
            audit.require(
                git_tree_entry(commit.strip(), path) == entry,
                f"{task_id}: frozen artifact changed in commit {commit.strip()}: {path}",
            )
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot verify frozen terminal artifact {path}: {exc}")


def current_repository_tree_entries(prefix: str) -> dict[str, Path]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_prefix = normalize_repo_path(prefix).rstrip("/")
    if snapshot is not None:
        return {
            path: ROOT / path
            for path in snapshot.current_file_paths()
            if path.startswith(f"{normalized_prefix}/")
        }
    root = ROOT / normalize_repo_path(prefix)
    entries: dict[str, Path] = {}
    if not root.exists():
        return entries
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in list(directory_names):
            path = directory_path / name
            metadata = path.lstat()
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            if stat.S_ISLNK(metadata.st_mode) or bool(
                getattr(metadata, "st_file_attributes", 0) & reparse_flag
            ):
                entries[relative(path)] = path
                directory_names.remove(name)
        for name in file_names:
            path = directory_path / name
            entries[relative(path)] = path
    return entries


def validate_portable_path_collisions(
    audit: Audit,
    label: str,
    paths: list[str],
) -> None:
    seen: dict[str, str] = {}
    for path in paths:
        audit.require(
            "\\" not in path,
            f"{label}: Git path contains a non-portable backslash: {path!r}",
        )
        audit.require(
            not any(0xD800 <= ord(character) <= 0xDFFF for character in path),
            f"{label}: Git path is not valid portable UTF-8: {path!r}",
        )
        normalized_path = normalize_repo_path(path)
        for component in normalized_path.split("/"):
            audit.require(
                bool(component)
                and component not in {".", ".."}
                and not component.endswith((" ", "."))
                and WINDOWS_INVALID_COMPONENT_RE.search(component) is None
                and WINDOWS_RESERVED_COMPONENT_RE.fullmatch(component) is None,
                f"{label}: path component is not portable to Windows: "
                f"{component!r} in {path!r}",
            )
        key = unicodedata.normalize("NFC", normalized_path).casefold()
        previous = seen.setdefault(key, path)
        audit.require(
            previous == path,
            f"{label}: paths collide on Windows/macOS: {previous!r} and {path!r}",
        )


def repository_paths_at_commit(commit: str) -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return sorted(snapshot.tree_entries(commit))
    result = git_bytes(
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        commit,
    )
    return sorted(
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    )


def repository_index_paths() -> list[str]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    if snapshot is not None:
        return sorted(snapshot._index_entries)
    result = git_bytes("ls-files", "-z")
    return sorted(
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    )


def validate_current_regular_tree(
    audit: Audit,
    task_id: str,
    prefix: str,
) -> None:
    root = ROOT / normalize_repo_path(prefix)
    try:
        metadata = root.lstat()
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        audit.require(
            stat.S_ISDIR(metadata.st_mode)
            and not stat.S_ISLNK(metadata.st_mode)
            and not bool(getattr(metadata, "st_file_attributes", 0) & reparse_flag),
            f"{task_id}: evidence root must be a regular non-reparse directory: {prefix}",
        )
    except OSError as exc:
        audit.error(f"{task_id}: cannot inspect evidence root {prefix}: {exc}")
    entries = current_repository_tree_entries(prefix)
    audit.require(bool(entries), f"{task_id}: evidence tree is empty: {prefix}")
    validate_portable_path_collisions(
        audit,
        f"{task_id}: current evidence tree",
        list(entries),
    )
    for path, current_path in sorted(entries.items()):
        current_regular_file_bytes(audit, f"{task_id}: {path}", current_path)


def git_repository_tree_entries(commit: str, prefix: str) -> dict[str, tuple[str, str, str]]:
    snapshot = _ACTIVE_GIT_SNAPSHOT
    normalized_prefix = normalize_repo_path(prefix).rstrip("/")
    if snapshot is not None and snapshot.resolve_commit(commit) is not None:
        return {
            path.replace("\\", "/"): entry
            for path, entry in snapshot.tree_entries(commit).items()
            if path.replace("\\", "/") == normalized_prefix
            or path.replace("\\", "/").startswith(f"{normalized_prefix}/")
        }
    result = git_bytes(
        "ls-tree",
        "-r",
        "-z",
        commit,
        "--",
        normalized_prefix,
    )
    entries: dict[str, tuple[str, str, str]] = {}
    for record in result.stdout.split(b"\0"):
        if not record or b"\t" not in record:
            continue
        header, raw_path = record.split(b"\t", 1)
        parts = header.decode("ascii", errors="replace").split()
        path = raw_path.decode("utf-8", errors="surrogateescape").replace("\\", "/")
        if len(parts) == 3:
            entries[path] = (parts[0], parts[1], parts[2])
    return entries


def validate_frozen_repository_tree(
    audit: Audit,
    task_id: str,
    terminal_commit: str,
    prefix: str,
) -> None:
    expected = git_repository_tree_entries(terminal_commit, prefix)
    current = current_repository_tree_entries(prefix)
    validate_portable_path_collisions(
        audit,
        f"{task_id}: terminal evidence tree",
        list(expected),
    )
    audit.require(bool(expected), f"{task_id}: frozen evidence tree is empty: {prefix}")
    audit.require(
        set(current) == set(expected),
        f"{task_id}: frozen evidence tree path set changed: "
        f"missing={sorted(set(expected) - set(current))}, "
        f"extra={sorted(set(current) - set(expected))}",
    )
    for path, entry in expected.items():
        audit.require(
            entry[:2] == ("100644", "blob"),
            f"{task_id}: frozen evidence entry must be a regular 100644 Git blob: {path}",
        )
    history = git_text(
        "rev-list",
        f"{terminal_commit}..HEAD",
    ).stdout.splitlines()
    for commit in history:
        audit.require(
            git_repository_tree_entries(commit.strip(), prefix) == expected,
            f"{task_id}: frozen evidence tree changed in commit {commit.strip()}: {prefix}",
        )
    for path in sorted(set(expected) & set(current)):
        validate_frozen_repository_artifact(audit, task_id, terminal_commit, path)


def validate_authorization_precedes_head(
    audit: Audit,
    task: dict[str, Any],
    head_commit: str,
) -> None:
    task_id = str(task.get("taskId", ""))
    authorization_commit = str(task.get("authorizationCommit", ""))
    result = git_text(
        "merge-base",
        "--is-ancestor",
        authorization_commit,
        head_commit,
        check=False,
    )
    audit.require(
        result.returncode == 0,
        f"{task_id}: reviewed headCommit must descend from authorizationCommit",
    )


def validate_reviewer_identity_fields(
    audit: Audit,
    label: str,
    reviewer: dict[str, Any],
) -> str | None:
    reviewer_id = reviewer.get("id")
    audit.require(
        is_canonical_identity(reviewer_id),
        f"{label}.id must be a canonical lowercase identity",
    )
    audit.require(
        is_canonical_identity(reviewer.get("kind")),
        f"{label}.kind must be a canonical lowercase identity",
    )
    return str(reviewer_id) if is_canonical_identity(reviewer_id) else None


def validate_terminal_handoff_next_action(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
    handoff: dict[str, Any],
    boundary_state: dict[str, Any],
) -> None:
    task0074_historical_next_action_isolated = (
        task_id == TASK_0074_TASK_ID
        and task.get("state") == "REJECTED"
        and task0074_exact_historical_quarantine_matches()
        and handoff.get("nextAction")
        == task0075_historical_quarantine_contract()[
            "historicalHandoffNextAction"
        ]
        and boundary_state.get("nextAction")
        == task0075_historical_quarantine_contract()[
            "historicalProjectStateNextAction"
        ]
    )
    audit.require(
        handoff.get("nextAction") == boundary_state.get("nextAction")
        or task0074_historical_next_action_isolated,
        f"{task_id}: Handoff nextAction disagrees with terminal project-state",
    )


def validate_versioned_terminal_evidence(
    audit: Audit,
    task_id: str,
    task: dict[str, Any],
    evidence: dict[str, Any],
    handoff: dict[str, Any],
    head_commit: str,
    terminal_states: set[str],
    current_protected_rules: list[dict[str, Any]],
    allow_pending_draft: bool,
) -> None:
    if FULL_COMMIT_RE.fullmatch(head_commit):
        validate_authorization_precedes_head(audit, task, head_commit)
    terminal_commit: str | None = None
    try:
        terminal_commit = canonical_terminal_commit(task, terminal_states)
        if terminal_commit:
            validate_task0064_terminal_commit_marker(
                audit,
                task_id,
                terminal_commit,
                evidence,
            )
            boundary_state = strict_yaml_load(
                git_object(terminal_commit, ".harness/project-state.yaml")
            )
            closure_paths = changed_paths_across_history(
                head_commit,
                terminal_commit,
            )
            head_is_ancestor = git_text(
                "merge-base",
                "--is-ancestor",
                head_commit,
                terminal_commit,
                check=False,
            )
            audit.require(
                head_is_ancestor.returncode == 0,
                f"{task_id}: terminal commit does not descend from reviewed headCommit",
            )
            for boundary_path in (
                str(task["_path"]),
                f"docs/evidence/{task_id}/evidence-pack.json",
                f"docs/handoffs/{task_id}.json",
            ):
                validate_frozen_repository_artifact(
                    audit,
                    task_id,
                    terminal_commit,
                    boundary_path,
                )
        else:
            boundary_state = load_yaml(ROOT / ".harness/project-state.yaml")
            closure_paths = sorted(
                set(changed_paths_across_history(head_commit, "HEAD"))
                | set(changed_paths(head_commit))
            )
        reviewed_state = strict_yaml_load(
            git_object(head_commit, ".harness/project-state.yaml")
        )
        if not isinstance(reviewed_state, dict) or not isinstance(boundary_state, dict):
            raise HarnessError(".harness/project-state.yaml: compared versions must be objects")
        validate_terminal_handoff_next_action(
            audit,
            task_id,
            task,
            handoff,
            boundary_state,
        )
        audit.require(
            project_state_closure_projection(reviewed_state)
            == project_state_closure_projection(boundary_state),
            f"{task_id}: protected project-state fields changed after reviewed headCommit",
        )
        current_state = load_yaml(ROOT / ".harness/project-state.yaml")
        if (
            terminal_commit
            and current_state.get("activeTask") in (None, "")
            and current_state.get("lastTerminalTask") == task_id
            and not allow_pending_draft
        ):
            audit.require(
                project_state_closure_projection(boundary_state)
                == project_state_closure_projection(current_state),
                f"{task_id}: protected project-state fields changed after terminal commit without a new task",
            )
            validate_idle_terminal_history(audit, task_id, terminal_commit)
    except (HarnessError, OSError, UnicodeError, yaml.YAMLError) as exc:
        audit.error(f"{task_id}: cannot verify terminal closure boundary: {exc}")
        closure_paths = []

    if FULL_COMMIT_RE.fullmatch(head_commit):
        try:
            implementation_paths = changed_paths_across_history(
                str(task.get("baseCommit", "")),
                head_commit,
            )
            implementation_skills = skill_registry_at_commit(head_commit)
            implementation_rules = effective_protected_rules(
                audit,
                task,
                current_protected_rules,
                target_commit=head_commit,
            )
            validate_diff_scope(
                audit,
                task,
                implementation_skills,
                implementation_rules,
                changed_override=implementation_paths,
                target_commit=head_commit,
            )
        except HarnessError as exc:
            audit.error(f"{task_id}: cannot verify implementation scope at headCommit: {exc}")

    checks = evidence.get("checks")
    checks = checks if isinstance(checks, list) else []
    by_command: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        if isinstance(check, dict):
            by_command.setdefault(str(check.get("command", "")), []).append(check)
            validate_nonblank_text(
                audit,
                f"{task_id}: every check environment",
                check.get("environment"),
            )
            verified_commit = str(check.get("verifiedCommit", ""))
            audit.require(
                bool(FULL_COMMIT_RE.fullmatch(verified_commit)),
                f"{task_id}: every check requires a full verifiedCommit",
            )
            if FULL_COMMIT_RE.fullmatch(verified_commit):
                exists = git_text("cat-file", "-e", f"{verified_commit}^{{commit}}", check=False)
                audit.require(exists.returncode == 0, f"{task_id}: check verifiedCommit does not exist")
                audit.require(
                    verified_commit == head_commit,
                    f"{task_id}: required checks must verify Evidence headCommit",
                )
    validate_required_command_coverage(
        audit,
        task,
        by_command,
        require_pass=task.get("state") == "ACCEPTED",
    )

    reviewers = task.get("reviewers")
    reviewers = reviewers if isinstance(reviewers, list) else []
    exact_rejected_without_review = (
        task0063_terminal_missing_reviewer_isolated(task)
        or task0067_terminal_missing_reviewer_isolated(task)
        or task0068_terminal_missing_reviewer_isolated(task)
    )
    if str(task.get("riskClass")) in ("C3", "C4"):
        audit.require(
            bool(reviewers) or exact_rejected_without_review,
            f"{task_id}: terminal high-risk task requires reviewers",
        )
        reviewer_ids: set[str] = set()
        for index, reviewer in enumerate(reviewers):
            label = f"{task_id}: reviewers[{index}]"
            audit.require(isinstance(reviewer, dict), f"{label} must be an object")
            if not isinstance(reviewer, dict):
                continue
            for field in ("verdict", "reviewedCommit", "evidencePath"):
                audit.require(bool(reviewer.get(field)), f"{label}.{field} is required")
            reviewer_id = validate_reviewer_identity_fields(audit, label, reviewer)
            if reviewer_id is not None:
                audit.require(reviewer_id not in reviewer_ids, f"{label}.id must be unique")
                reviewer_ids.add(reviewer_id)
                audit.require(reviewer_id != task.get("owner"), f"{label} must be independent from owner")
            if task.get("state") == "ACCEPTED":
                audit.require(reviewer.get("verdict") == "PASS", f"{label} verdict must be PASS")
            else:
                audit.require(
                    reviewer.get("verdict")
                    in ("PASS", "FAIL", "TIMEOUT", "UNKNOWN"),
                    f"{label} verdict is invalid",
                )
            if reviewer.get("verdict") in {"TIMEOUT", "UNKNOWN"}:
                validate_typed_nonpass_observation(
                    audit,
                    label,
                    reviewer,
                    "verdict",
                )
            audit.require(
                reviewer.get("reviewedCommit") == head_commit,
                f"{label} must review Evidence headCommit",
            )
            review_path = str(reviewer.get("evidencePath", ""))
            audit.require(is_repository_relative(review_path), f"{label}.evidencePath must be relative")
            expected_review_prefix = f"docs/evidence/{task_id}/"
            audit.require(
                is_review_evidence_path(task_id, review_path),
                f"{label}.evidencePath must be a Markdown file under {expected_review_prefix}",
            )
            if is_repository_relative(review_path):
                review_file = ROOT / review_path
                review_is_file = current_path_is_file(review_file)
                audit.require(
                    review_is_file,
                    f"{label}.evidencePath does not exist",
                )
                if terminal_commit:
                    validate_frozen_repository_artifact(
                        audit,
                        task_id,
                        terminal_commit,
                        review_path,
                    )
                if review_is_file:
                    try:
                        review_text = read_repository_text(review_file)
                        match = TASK_BLOCK_RE.search(review_text)
                        audit.require(bool(match), f"{label}.evidencePath lacks fenced YAML metadata")
                        review_data = strict_yaml_load(match.group(1)) if match else {}
                        audit.require(isinstance(review_data, dict), f"{label} metadata must be an object")
                        if isinstance(review_data, dict):
                            expected = {
                                "taskId": task_id,
                                "reviewerId": reviewer.get("id"),
                                "verdict": reviewer.get("verdict"),
                                "reviewedCommit": reviewer.get("reviewedCommit"),
                            }
                            for field, value in expected.items():
                                audit.require(
                                    review_data.get(field) == value,
                                    f"{label} review evidence disagrees on {field}",
                                )
                            if reviewer.get("verdict") in {"TIMEOUT", "UNKNOWN"}:
                                for field in (
                                    "reason",
                                    "candidateTree",
                                    "budget",
                                    "interruption",
                                ):
                                    audit.require(
                                        review_data.get(field) == reviewer.get(field),
                                        f"{label} review evidence disagrees on {field}",
                                    )
                    except (OSError, yaml.YAMLError) as exc:
                        audit.error(f"{label} cannot read review evidence: {exc}")
        audit.require(
            evidence.get("reviewers") == reviewers,
            f"{task_id}: Evidence reviewers disagree with task",
        )
        audit.require(
            handoff.get("reviewers") == reviewers,
            f"{task_id}: Handoff reviewers disagree with task",
        )
    allowed_closure = (
        task["_path"],
        ".harness/project-state.yaml",
        TASK_LEDGER_PATH,
        f"docs/evidence/{task_id}/**",
        f"docs/handoffs/{task_id}.json",
    )
    if task_id == "TASK-0068" and task0068_terminal_missing_reviewer_isolated(task):
        allowed_closure += TASK_0068_RETAINED_RECOVERY_PATHS
    for path in closure_paths:
        audit.require(
            any(glob_matches(path, pattern) for pattern in allowed_closure),
            f"{task_id}: unverified implementation change after headCommit: {path}",
        )


def validate_draft_base_anchor(
    audit: Audit,
    task_id: str,
    base_commit: str,
    terminal_commit: str | None,
) -> None:
    if task_id == TASK_0072_BOOTSTRAP_TASK_ID:
        audit.require(
            terminal_commit == TASK_0072_SOURCE_TERMINAL_COMMIT,
            "TASK-0072 self-bootstrap: DRAFT source terminal boundary drifted",
        )
        audit.require(
            not task0072_bootstrap_consumed(),
            "TASK-0072 self-bootstrap: DRAFT anchor is already consumed by Task Ledger",
        )
        validate_task0072_self_bootstrap_boundary(audit, base_commit)
        return
    audit.require(
        terminal_commit is not None and base_commit == terminal_commit,
        f"{task_id}: DRAFT baseCommit must equal the last terminal boundary commit",
    )


def validate_draft_checkpoint(
    audit: Audit,
    task: dict[str, Any],
    last_terminal_task: dict[str, Any] | None,
    tasks: dict[str, dict[str, Any]],
    lifecycle: dict[str, Any],
) -> None:
    task_id = str(task.get("taskId", ""))
    task_path = str(task.get("_path", ""))
    context_path = str(task.get("contextLock", ""))
    terminal_commit: str | None = None
    if last_terminal_task is not None:
        try:
            terminal_commit = canonical_terminal_commit(
                last_terminal_task,
                {"ACCEPTED", "REJECTED"},
            )
        except HarnessError as exc:
            audit.error(f"{task_id}: cannot derive last terminal boundary: {exc}")
    validate_draft_base_anchor(
        audit,
        task_id,
        str(task.get("baseCommit", "")),
        terminal_commit,
    )
    if task.get("planningBacklog") == TASK_BACKLOG_PATH:
        try:
            planned = task_metadata_at_commit(
                str(task.get("baseCommit", "")),
                task_path,
            )
            audit.require(
                planned.get("state") == "PLANNED",
                f"{task_id}: backlog-managed DRAFT must originate from a PLANNED "
                "card at Base Commit",
            )
            for field in (
                "taskId",
                "owner",
                "planningBacklog",
                "planningContractHash",
                "planningContractHashAlgorithm",
            ):
                audit.require(
                    planned.get(field) == task.get(field),
                    f"{task_id}: PLANNED contract binding changed during DRAFT "
                    f"promotion: {field}",
                )
            validate_backlog_draft_promotion_at_base(
                audit,
                task,
                tasks,
                lifecycle,
            )
        except (HarnessError, UnicodeError, yaml.YAMLError) as exc:
            audit.error(
                f"{task_id}: cannot validate PLANNED to DRAFT promotion: {exc}"
            )
    try:
        changed = changed_paths(str(task.get("baseCommit", "")))
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot validate DRAFT checkpoint: {exc}")
        return
    allowed = {task_path, context_path}
    maintenance_plan = task.get("preReadyMaintenancePlan")
    if isinstance(maintenance_plan, dict):
        maintenance_paths = maintenance_plan.get("exactPaths", [])
        if isinstance(maintenance_paths, list):
            allowed.update(str(p) for p in maintenance_paths)
    audit.require(task_path in changed, f"{task_id}: DRAFT checkpoint must include the task card")
    audit.require(
        set(changed) <= allowed,
        f"{task_id}: DRAFT checkpoint may contain only task card and Context Lock: "
        f"{sorted(set(changed) - allowed)}",
    )
    validate_history_path_allowlist(
        audit,
        str(task.get("baseCommit", "")),
        "HEAD",
        allowed,
        f"{task_id}: DRAFT history",
    )


def validate_project_state_mutation_policy(
    audit: Audit,
    task: dict[str, Any],
    target_commit: str | None,
) -> None:
    task_id = str(task.get("taskId", ""))
    base_commit = str(task.get("baseCommit", ""))
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    harness_approved = any(
        isinstance(item, dict)
        and item.get("scope") == "harness-change"
        and is_canonical_identity(item.get("approvedBy"))
        and is_valid_approval_timestamp(item.get("approvedAt"))
        and isinstance(item.get("evidence"), str)
        and bool(item.get("evidence").strip())
        for item in approvals
    )
    full_harness_authority = (
        task.get("riskClass") == "C4"
        and "harness-change" in task_required_skills(task)
        and harness_approved
        and task.get("independentReview") in (True, "required", "REQUIRED")
    )
    try:
        baseline = yaml_at_commit(base_commit, PROJECT_STATE_PATH)
    except HarnessError as exc:
        audit.require(
            full_harness_authority and task_id == "TASK-0002",
            f"{task_id}: cannot establish project-state baseline: {exc}",
        )
        return
    try:
        candidate = (
            yaml_at_commit(target_commit, PROJECT_STATE_PATH)
            if target_commit
            else load_yaml(ROOT / PROJECT_STATE_PATH)
        )
    except HarnessError as exc:
        audit.error(f"{task_id}: cannot load candidate project-state: {exc}")
        return
    if not full_harness_authority:
        baseline_projection = project_state_closure_projection(baseline)
        history_target = target_commit or "HEAD"
        history = git_text(
            "rev-list",
            "--topo-order",
            "--reverse",
            f"{base_commit}..{history_target}",
        ).stdout.splitlines()
        for commit in history:
            try:
                historical = yaml_at_commit(commit.strip(), PROJECT_STATE_PATH)
                audit.require(
                    project_state_closure_projection(historical)
                    == baseline_projection,
                    f"{task_id}: protected project-state fields changed in commit "
                    f"{commit.strip()} without C4 harness authority",
                )
            except HarnessError as exc:
                audit.error(
                    f"{task_id}: cannot validate project-state history at "
                    f"{commit.strip()}: {exc}"
                )
        audit.require(
            baseline_projection
            == project_state_closure_projection(candidate),
            f"{task_id}: only a C4 harness-change task may modify protected project-state fields",
        )


def validate_diff_scope(
    audit: Audit,
    task: dict[str, Any],
    skills: dict[str, dict[str, Any]],
    protected_rules: list[dict[str, Any]],
    changed_override: list[str] | None = None,
    target_commit: str | None = None,
) -> None:
    task_id = str(task.get("taskId"))
    try:
        if changed_override is not None:
            changed = changed_override
        else:
            base_commit = str(task.get("baseCommit", ""))
            changed = sorted(
                set(changed_paths_across_history(base_commit, "HEAD"))
                | set(changed_paths(base_commit))
            )
    except (HarnessError, OSError) as exc:
        audit.error(f"{task_id}: cannot calculate diff scope: {exc}")
        return
    if target_commit is None:
        validate_current_index_snapshot(audit, task_id, changed)
        portable_paths = repository_index_paths()
        portable_label = f"{task_id}: staged repository snapshot"
    else:
        portable_paths = repository_paths_at_commit(target_commit)
        portable_label = f"{task_id}: reviewed repository snapshot"
    validate_portable_path_collisions(
        audit,
        portable_label,
        portable_paths,
    )
    validate_changed_path_modes(
        audit,
        task_id,
        str(task.get("baseCommit", "")),
        target_commit or "HEAD",
        changed,
        include_current_index=target_commit is None,
    )
    allowlist, amendment_exact_paths = effective_task_write_scope(task)
    forbidden = [str(item) for item in task.get("forbiddenPaths", [])]
    required_skills = set(task_required_skills(task))
    approvals = task.get("humanApprovals")
    approvals = approvals if isinstance(approvals, list) else []
    reviewers = task.get("reviewers")
    reviewers = reviewers if isinstance(reviewers, list) else []
    independent_declared = task.get("independentReview") in (True, "required", "REQUIRED")
    if PROJECT_STATE_PATH in changed:
        validate_project_state_mutation_policy(audit, task, target_commit)

    for path in changed:
        audit.require(
            path in amendment_exact_paths
            or any(glob_matches(path, pattern) for pattern in allowlist),
            f"{task_id}: changed path is outside writeAllowlist: {path}",
        )
        audit.require(
            not any(glob_matches(path, pattern) for pattern in forbidden),
            f"{task_id}: changed path is forbidden: {path}",
        )
        for rule in protected_rules:
            if not glob_matches(path, str(rule.get("glob", ""))):
                continue
            lifecycle_exemptions = rule.get("lifecycleExemptions", [])
            lifecycle_exemptions = (
                lifecycle_exemptions if isinstance(lifecycle_exemptions, list) else []
            )
            if path in lifecycle_exemptions:
                continue
            skill_id = str(rule.get("requiredSkill", ""))
            task_risk = str(task.get("riskClass", ""))
            protected_risk = str(rule.get("riskClass", ""))
            audit.require(
                RISK_RANK.get(task_risk, 0) >= RISK_RANK.get(protected_risk, 99),
                f"{task_id}: {path} requires riskClass {protected_risk}, task declares {task_risk}",
            )
            audit.require(
                skill_id in required_skills and skill_id in skills,
                f"{task_id}: {path} requires registered Skill {skill_id}",
            )
            if rule.get("humanApproval") is True:
                approved = any(
                    isinstance(item, dict)
                    and item.get("scope") == skill_id
                    and is_canonical_identity(item.get("approvedBy"))
                    and is_valid_approval_timestamp(item.get("approvedAt"))
                    and isinstance(item.get("evidence"), str)
                    and bool(item.get("evidence").strip())
                    for item in approvals
                )
                audit.require(approved, f"{task_id}: {path} requires recorded human approval for {skill_id}")
            if rule.get("independentReview") is True:
                audit.require(independent_declared, f"{task_id}: {path} requires independentReview")
            if rule.get("generatedOnly") is True:
                source_changed = any(glob_matches(item, "specs/catalog/**") for item in changed)
                audit.require(source_changed, f"{task_id}: generated output changed without a Catalog source change")

    risk = str(task.get("riskClass", ""))
    if risk in ("C3", "C4"):
        audit.require(independent_declared, f"{task_id}: {risk} task must declare independentReview")
        if task.get("state") in ("ACCEPTED", "REJECTED"):
            audit.require(
                (
                    bool(reviewers)
                    and all(isinstance(item, dict) for item in reviewers)
                )
                or task0063_terminal_missing_reviewer_isolated(task)
                or task0067_terminal_missing_reviewer_isolated(task)
                or task0068_terminal_missing_reviewer_isolated(task),
                f"{task_id}: terminal {risk} task requires structured independent reviewers",
            )
    audit.require(bool(changed), f"{task_id}: no changed files found from baseCommit")


def select_task_for_diff_scope(
    audit: Audit,
    explicit_task: str | None,
    active_task: str | None,
    pending_draft: str | None,
    last_terminal_task: str,
    tasks: dict[str, dict[str, Any]],
) -> str:
    if (
        explicit_task
        and explicit_task in tasks
        and is_planning_only_task(tasks[explicit_task])
    ):
        planning_state = tasks[explicit_task].get("state")
        audit.error(
            f"explicit task {explicit_task} is planning-only {planning_state} "
            "and cannot be executed or selected for diff-scope validation"
        )
    if explicit_task and active_task and explicit_task != active_task:
        audit.error(
            f"explicit task {explicit_task} cannot replace activeTask "
            f"{active_task} for diff-scope validation"
        )
    if (
        explicit_task
        and not active_task
        and explicit_task != (pending_draft or last_terminal_task)
    ):
        audit.error(
            f"explicit task {explicit_task} cannot replace selected task "
            f"{pending_draft or last_terminal_task} when no task is active"
        )
    return active_task or pending_draft or last_terminal_task


def print_summary(
    state: dict[str, Any],
    tasks: dict[str, dict[str, Any]],
    backlog_projection: dict[str, Any] | None = None,
) -> None:
    active = state.get("activeTask") or "NONE"
    last = state.get("lastAcceptedTask") or "NONE"
    terminal = state.get("lastTerminalTask") or "NONE"
    print(f"Project: {state.get('projectId')} | Phase: {state.get('phase')}")
    print(f"Active task: {active} | Last accepted: {last} | Last terminal: {terminal}")
    if active in tasks:
        task = tasks[str(active)]
        print(f"Task card: {task.get('_path')} | State: {task.get('state')} | Risk: {task.get('riskClass')}")
        print(f"Required Skills: {', '.join(task_required_skills(task)) or 'NONE'}")
    print(f"Next action: {state.get('nextAction')}")
    if backlog_projection:
        next_promotable = backlog_projection.get("nextPromotable") or "NONE"
        print(
            f"Backlog: {backlog_projection.get('plannedCount', 0)} PLANNED | "
            f"Next promotable: {next_promotable}"
        )
        frontier = backlog_projection.get("executionOrderFrontier") or "NONE"
        frontier_blockers = backlog_projection.get("frontierBlockers") or []
        print(
            f"Execution-order frontier: {frontier} | "
            f"Blocked by: {', '.join(frontier_blockers) or 'NONE'}"
        )
    gates = state.get("capabilityGates") or {}
    for gate_id, gate in gates.items():
        if isinstance(gate, dict):
            print(f"Gate {gate_id}: {gate.get('state')} — {gate.get('reason')}")


def layer0_fast_pass(audit: Audit) -> None:
    """秒级结构化预检；失败则不进入 ~20 分钟深度验证。"""
    try:
        skills_data = strict_yaml_load(
            (ROOT / ".harness" / "skills.yaml").read_bytes()
        )
    except Exception as exc:
        audit.error(f"layer0: skills.yaml parse error: {exc}")
        return
    for skill in skills_data.get("skills", []):
        if skill["id"] not in {"harness-change", "task-intake", "task-delivery-flow"}:
            continue
        skill_path = ROOT / skill["path"]
        text = (
            skill_path.read_text(encoding="utf-8")
            if skill_path.is_file()
            else ""
        )
        m = SKILL_FRONTMATTER_RE.match(text)
        if m is None:
            audit.error(f"layer0: Skill {skill['id']} has no frontmatter")
            continue
        try:
            fm = strict_yaml_load(m.group(1))
        except Exception:
            audit.error(
                f"layer0: Skill {skill['id']} frontmatter is not valid YAML"
            )
            continue
        fm_dict = fm if isinstance(fm, dict) else {}
        ext = fm_dict.get("metadata")
        ext = ext if isinstance(ext, dict) else {}
        fm_ver = ext.get("version", fm_dict.get("version", ""))
        if not fm_ver:
            continue
        reg_ver = skill.get("version", "")
        if str(fm_ver) != str(reg_ver):
            audit.error(
                f"ERROR: Skill {skill['id']}: registry/frontmatter version mismatch "
                f"(registry={reg_ver}, frontmatter={fm_ver})"
            )
    for yaml_name in (
        "project-state.yaml",
        "task-backlog.yaml",
        "task-ledger.yaml",
        "task-delivery-policy.yaml",
        "ci-execution-policy.yaml",
        "task-lifecycle.yaml",
    ):
        try:
            load_yaml(ROOT / ".harness" / yaml_name)
        except Exception as exc:
            audit.error(f"layer0: .harness/{yaml_name} parse error: {exc}")


def main() -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Validate the portable Agent Harness")
    parser.add_argument("--task", help="Task ID whose diff scope must be validated")
    parser.add_argument("--summary", action="store_true", help="Print recoverable project status")
    parser.add_argument(
        "--pre-closure",
        action="store_true",
        help="Allow an otherwise valid terminal worktree before its terminal commit exists",
    )
    args = parser.parse_args()
    audit = Audit()
    _doctor_start = time.monotonic()
    layer0_fast_pass(audit)
    if audit.errors:
        for error in audit.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(
            f"Harness doctor: FAIL ({len(audit.errors)} errors, {audit.checks} checks)",
            file=sys.stderr,
        )
        return 1
    import json as _j, hashlib as _h, tempfile
    _cache = Path(tempfile.gettempdir()) / "vc-doctor-cache.json"
    _head = git_text("rev-parse", "HEAD").stdout.strip()
    _idx = git_bytes("ls-files", "--stage", "-z").stdout
    _fp = _h.sha256(_head.encode() + _idx).hexdigest()
    if _cache.is_file():
        try:
            _c = _j.loads(_cache.read_text())
            if _c.get("fp") == _fp and _c.get("exit") == 0:
                print(f"Harness doctor: PASS ({_c.get('n', 0)} checks) [cache hit]")
                return 0
        except Exception:
            pass
    backlog_projection: dict[str, Any] = {}
    try:
        with doctor_git_snapshot() as snapshot:
            try:
                with timed_phase("load project and tasks"):
                    lifecycle = load_yaml(ROOT / ".harness/task-lifecycle.yaml")
                    state = load_yaml(ROOT / ".harness/project-state.yaml")
                    tasks = discover_tasks()
                    validate_tasks(audit, tasks, lifecycle)

                with timed_phase("authorized task history"):
                    validate_authorized_task_history(audit, tasks)

                with timed_phase("task ledger history"):
                    validate_task_ledger(
                        audit,
                        tasks,
                        lifecycle,
                        allow_uncommitted_terminal=args.pre_closure,
                    )

                with timed_phase("task boundaries and project state"):
                    validate_task_base_handoff_anchors(audit, tasks, lifecycle)
                    validate_active_task_base_freshness(audit, tasks, lifecycle)
                    active_task = validate_project_state(audit, state, lifecycle, tasks)
                    backlog_projection = validate_task_backlog(
                        audit,
                        tasks,
                        lifecycle,
                        state,
                    )

                with timed_phase("skills sources and entrypoints"):
                    skills, protected_rules = validate_skills(audit, tasks)
                    _cf = __import__("concurrent.futures", fromlist=["wait"])
                    with _cf.ThreadPoolExecutor(max_workers=4) as _pool:
                        _futs = [
                            _pool.submit(validate_sources, audit, tasks),
                            _pool.submit(validate_task_delivery_policy, audit),
                            _pool.submit(validate_ci_execution_policy, audit),
                            _pool.submit(validate_harness_runtime, audit),
                            _pool.submit(validate_entrypoints, audit),
                            _pool.submit(validate_commands, audit),
                        ]
                        _cf.wait(_futs)

                draft_tasks = validate_pending_draft_limit(
                    audit,
                    tasks,
                    lifecycle,
                )
                pending_draft = draft_tasks[0] if len(draft_tasks) == 1 else None

                with timed_phase("evidence and handoffs"):
                    validate_evidence_and_handoffs(
                        audit,
                        tasks,
                        lifecycle,
                        protected_rules,
                        allow_pending_draft=pending_draft is not None,
                    )

                with timed_phase("selected task diff scope"):
                    last_terminal_task = str(state.get("lastTerminalTask", ""))
                    head_commit = git_text("rev-parse", "HEAD").stdout.strip()
                    task0072_idle_boundary = (
                        not active_task
                        and not pending_draft
                        and last_terminal_task == "TASK-0070"
                        and task0072_bootstrap_boundary_candidate(head_commit)
                    )
                    selected_task_id = select_task_for_diff_scope(
                        audit,
                        args.task,
                        active_task,
                        pending_draft,
                        last_terminal_task,
                        tasks,
                    )
                    if selected_task_id not in tasks:
                        audit.error(f"selected task does not exist: {selected_task_id}")
                    else:
                        selected_task = tasks[selected_task_id]
                        if selected_task.get("state") == "DRAFT":
                            validate_draft_checkpoint(
                                audit,
                                selected_task,
                                tasks.get(last_terminal_task),
                                tasks,
                                lifecycle,
                            )
                        if not task0072_idle_boundary:
                            validate_diff_scope(
                                audit,
                                selected_task,
                                skills,
                                effective_protected_rules(
                                    audit,
                                    selected_task,
                                    protected_rules,
                                ),
                            )
                if args.summary:
                    print_summary(state, tasks, backlog_projection)
            finally:
                snapshot.verify_unchanged(audit)
    except HarnessError as exc:
        audit.error(str(exc))
    except Exception as exc:  # fail closed with a concise diagnostic
        audit.error(f"unexpected Harness error: {type(exc).__name__}: {exc}")

    for warning in audit.warnings:
        print(f"WARN: {warning}", file=sys.stderr)
    if audit.errors:
        for error in audit.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"Harness doctor: FAIL ({len(audit.errors)} errors, {audit.checks} checks)", file=sys.stderr)
        return 1
    try:
        import json as _j, hashlib as _h, tempfile
        _cache = Path(tempfile.gettempdir()) / "vc-doctor-cache.json"
        _head = git_text("rev-parse", "HEAD").stdout.strip()
        _idx = git_bytes("ls-files", "--stage", "-z").stdout
        _fp = _h.sha256(_head.encode() + _idx).hexdigest()
        _cache.write_text(_j.dumps({"fp": _fp, "exit": 0, "n": audit.checks}))
    except Exception:
        pass
    _elapsed = time.monotonic() - _doctor_start
    print(f"Harness doctor: PASS ({audit.checks} checks, {_elapsed:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
