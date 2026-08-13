# TASK-0193：P0 owner-context/RLS 继承实现独立接纳

```yaml
taskId: TASK-0193
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 9a9c77caeb65a3f44eb9aa77368b20f87b4ec5cf
authorizationCommit: c5b379d503b0cda9e126b990512e2344b10a8528
contextFingerprint: 75d2a34582387b48dad5ec9809ff2d7abd5cfaa5ad47b489d63a752c70b0dadc
contextLock: docs/tasks/context/TASK-0193.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0193_P0_OWNER_CONTEXT_RLS_INHERITED_ADOPTION
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-14 批准 TASK-0193 的 C4 范围：对 TASK-0191 窗口内已验证、当前树中
    机器绑定的 P0 owner-context/RLS 继承实现做独立接纳（授权 + 同一候选 SHA 全量
    复验 + C4 独立复核）。授权、manifest 机器绑定与全量复验必须一次成卡原子完成，
    拆卡会留下实现已存在但未获正式授权的悬置状态。
inheritedStateManifest:
  algorithm: SHA256_MANIFEST_V1
  preImplementationBaseline: 3c7fd0b5b306325d51464053e7b3382044c3dd4b
  rejectedTerminal: 2abc531bde888d7f9689d199fb8b092b3341b226
  rejectedTerminalTree: d60e437be565221344e67d59cc182b08328aff84
  adoptionBase: 9a9c77caeb65a3f44eb9aa77368b20f87b4ec5cf
  adoptionBaseTree: 7e2dd00183e2838c2799dc0ed3f2ce8169eb5c29
  implementationCommit: bfc6a62d53eb55c22dc257216b1db8592f50c667
  fixCommit: 8f08bb1d197c2787d91080aa33684a8444b8b7b0
  scopeAmendmentCommit: 26689494cfe560cd1b388d2a1a6c44adadb1e8d2
  windowDiffPathCount: 78
  governanceExclusionCount: 8
  inheritedPathCount: 70
  orderedPathSetSha256: b9f027776723d4c5803d1e02991c9669ee37a23756b8ea430936142626b16615
  manifestSha256: d19579012582dd565648fbd899499c3a8e52597fe18280c4ef90c407bdf4629a
  manifestCanonicalization: >-
    entries=[{blob:<40hex>, mode:"100644", path:<posix>}...] sorted by path (codepoint);
    canonical=json.dumps({algorithm:SHA256_MANIFEST_V1, baseCommit:<adoptionBase>,
    paths:entries}, ensure_ascii=False, sort_keys=True, separators=(",",":"));
    manifestSha256=sha256(canonical utf-8).hex(); orderedPathSetSha256=sha256(concat
    of sorted path each followed by LF).utf-8).hex()
  governanceExcludedPaths:
    - .harness/project-state.yaml
    - .harness/task-backlog.yaml
    - .harness/task-ledger.yaml
    - docs/evidence/TASK-0191/evidence-pack.json
    - docs/evidence/TASK-0191/review-r1.md
    - docs/handoffs/TASK-0191.json
    - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
    - docs/tasks/context/TASK-0191.context-lock.yaml
  paths:
    - {path: infra/db/tests/00_owner_binding_secret_seed.sql, mode: "100644", blob: 5f8493983834c2a207141be6fbf5ac2181c9a1c2}
    - {path: infra/db/tests/01_cross_user_read_denied.sql, mode: "100644", blob: 6b8c7e2d8d72eefac7b839a3ec5f4fd6cd54e25d}
    - {path: infra/db/tests/04_stale_worker_fence_denied.sql, mode: "100644", blob: 94a63df0b8c717214c0b6c47ceece9900965752e}
    - {path: infra/db/tests/06_authorization_snapshot_isolation.sql, mode: "100644", blob: f115b171bb53b70638d25ccffa9187b3f50b3938}
    - {path: infra/db/tests/07_claim_binds_context.sql, mode: "100644", blob: 673066ba728bdf63328ca7925d068476d488e898}
    - {path: infra/db/tests/08_expired_lease_zero_write.sql, mode: "100644", blob: dd7b27d842836b5a37c874a936b06855b63f42ea}
    - {path: infra/db/tests/09_wrong_token_zero_write.sql, mode: "100644", blob: e0d54192ff18ed0ab29b1f63ffcb7a6184993b8f}
    - {path: infra/db/tests/10_stale_fence_zero_write.sql, mode: "100644", blob: 4332c7e4f968b41a5a544ee300ff2babdfeace60}
    - {path: infra/db/tests/12_coordinator_reads_only_metadata.sql, mode: "100644", blob: b9de56d275d7e365a9a1977f73a7c66e5d0a697b}
    - {path: infra/db/tests/13_idempotent_receive_same_generation_id.sql, mode: "100644", blob: b2278f915adcef7262f35070f1410d01277cd23e}
    - {path: infra/db/tests/14_idempotent_receive_no_duplicate_message.sql, mode: "100644", blob: 4afce8a205f1eac5773a3bc70f0bc5662570cc33}
    - {path: infra/db/tests/15_cross_owner_generation_reference_denied.sql, mode: "100644", blob: d6504ce4a46b90faececd8365d4cc463a9160d4d}
    - {path: infra/db/tests/16_atomic_finalize_commits_all.sql, mode: "100644", blob: d891a3616a5a1f491d8f89c8ac591b263182ec62}
    - {path: infra/db/tests/17_fault_injection_rolls_back_all.sql, mode: "100644", blob: 05f54bc31ec6524e90a6e95a17a0535ca19ce265}
    - {path: infra/db/tests/18_provider_eos_cannot_complete.sql, mode: "100644", blob: 8dab9b34c5a8b20935dfc5f19885e7a0088e1ac6}
    - {path: infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql, mode: "100644", blob: 7d7f4c76f1f5d7671af163698633fbddd062996c}
    - {path: infra/db/tests/20_resume_resumed_contiguous_cursor.sql, mode: "100644", blob: d7558a1fa7a9adb31f3b70c626e394b2cf5a6841}
    - {path: infra/db/tests/21_resume_gap_expired_window.sql, mode: "100644", blob: 39f8b03775a8bccc28b117704680b5bf1ca7afca}
    - {path: infra/db/tests/22_resume_reset_required_epoch.sql, mode: "100644", blob: 2c1f504cfc0d098620692a7233720860afc3ae3e}
    - {path: infra/db/tests/23_resume_terminal_snapshot.sql, mode: "100644", blob: 20b11bacf8caa4d41e305aac3ed86d1b3a4e0733}
    - {path: infra/db/tests/24_resume_not_found_or_forbidden.sql, mode: "100644", blob: cf28f8fc809b4a40bc87f4e2bf658b56b0c2121f}
    - {path: infra/db/tests/25_realtime_event_rls_owner_isolation.sql, mode: "100644", blob: a850d0b93ef0dd3aa1e17ac6752ed5f32acfc9e7}
    - {path: infra/db/tests/26_relationship_active_limit_enforced.sql, mode: "100644", blob: 7e2730d367f19cc5b9198d1f74f228b0aecfd826}
    - {path: infra/db/tests/28_relationship_not_found_or_forbidden.sql, mode: "100644", blob: c7c2596e01cd09bd868a3a4c20d81d0231b5fa8a}
    - {path: infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql, mode: "100644", blob: 8b8bbe7661cfdd814228e2ded138da94d7cbc1ed}
    - {path: infra/db/tests/30_generation_cancel.sql, mode: "100644", blob: ceb3e93d476ac1c4943d1eec3f0b0cd4cf8bccab}
    - {path: infra/db/tests/31_message_history_pagination.sql, mode: "100644", blob: de05863f1d25facc6784504c3d5a1c82c20644e8}
    - {path: infra/db/tests/32_memory_confirmation_path_only.sql, mode: "100644", blob: 3ee7db43d9f8b4d6124a7f64071da3fb9ddcca35}
    - {path: infra/db/tests/33_memory_cross_isolation_fail_closed.sql, mode: "100644", blob: d4de1470bbfaf250d33b5306e441edfea371d4c3}
    - {path: infra/db/tests/34_memory_lifecycle_evidence_scope.sql, mode: "100644", blob: b362dd7287832825c44b1cb6f3a560597173f343}
    - {path: infra/db/tests/35_memory_edit_evidence.sql, mode: "100644", blob: 1f77da12a74f2d85db052f20181040f912e4b213}
    - {path: infra/db/tests/36_memory_idempotency.sql, mode: "100644", blob: b418cd2f129999f1350698eb5380aebf525d76cb}
    - {path: infra/db/tests/37_memory_recall_scope_budget.sql, mode: "100644", blob: e0daf57dce146d82a819a77668ec81ff27d16877}
    - {path: infra/db/tests/38_memory_recall_tombstone_determinism.sql, mode: "100644", blob: 3354143e791ad9b1db0cf1b2d3dc2c7897c8e443}
    - {path: infra/db/tests/40_provider_attempt_rls.sql, mode: "100644", blob: 4aba9830574346a011f9072a220b4adae0a2f42f}
    - {path: infra/db/tests/41_generation_terminal_transitions.sql, mode: "100644", blob: c3817b992f5a5ef0e21be7e3eeb2fe3779ea7720}
    - {path: infra/db/tests/42_terminal_event_atomic.sql, mode: "100644", blob: 329372fd2de6f8c6349320069c2d2694ebd36910}
    - {path: infra/db/tests/43_candidate_and_quota_release.sql, mode: "100644", blob: 9c4ce7cd9432af6f7983f604c16495dda855b60c}
    - {path: infra/db/tests/44_finalize_finalize_concurrent.sql, mode: "100644", blob: 4716e3a32202e8926363c1a9464d2fe8a39215c7}
    - {path: infra/db/tests/45_finalize_cancel_concurrent.sql, mode: "100644", blob: d67639a6aaf48fbbf7062e311c9f84915e1b7c5d}
    - {path: infra/db/tests/46_finalize_terminalize_concurrent.sql, mode: "100644", blob: 1a83b7e4fedac65c6dc727649a5883d61035498e}
    - {path: infra/db/tests/47_candidate_terminal_toctou.sql, mode: "100644", blob: 875b38d9139e29b31f3649175d926729dcaf13f2}
    - {path: infra/db/tests/49_realtime_seq_concurrent.sql, mode: "100644", blob: 53fca902d73f9ad63b9a89d755620b3f9fb74473}
    - {path: infra/db/tests/50_realtime_event_catalog.sql, mode: "100644", blob: 73cd341576358397443270244a37b43d186b9a2c}
    - {path: infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql, mode: "100644", blob: af301c57e1f6b129c6a031e92299c6fbd026dd26}
    - {path: infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql, mode: "100644", blob: 27e9677e95cb83c0ca1276c85788457494f045bf}
    - {path: infra/db/tests/54_sd_owner_mismatch_fail_closed.sql, mode: "100644", blob: 80bafc9314b6c4d063ff76d9fa85403bdfd41740}
    - {path: infra/db/tests/57_search_path_public_create_fail_closed.sql, mode: "100644", blob: 85facd704d3dd4ff99ff2ec4c8a070bc2bf9d153}
    - {path: infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql, mode: "100644", blob: 577005c4b515fbe79729f6f79386e77399b2b55c}
    - {path: infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql, mode: "100644", blob: cb8e9ff6baf5c57fda4dce43f98fb2bb2716b7a6}
    - {path: infra/db/tests/63_worker_runtime_role_claim_complete.sql, mode: "100644", blob: 4b6ba2aa1a5754a02f704849eb143c485a7af0a9}
    - {path: infra/db/tests/64_worker_coordinator_cross_session_recovery.sql, mode: "100644", blob: 19f636fe18bf46cf8315fe278512e9d821b7061d}
    - {path: infra/db/tests/65_generation_intake_workitem_promotion.sql, mode: "100644", blob: 76d4a61d672c64e6caa24b6403215a8ccf3ebf16}
    - {path: infra/db/tests/66_generation_zero_llm_completed_chain.sql, mode: "100644", blob: a613dce75b2412b7bdc8e71bf2f7e0c23085cab3}
    - {path: infra/db/tests/67_generation_external_attempt_completed_chain.sql, mode: "100644", blob: 7e6f4f32c10b87db5b25ab325dc4751108897a32}
    - {path: infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql, mode: "100644", blob: 2ccfb590b069c70338938d7ca87001d90b96e37e}
    - {path: infra/db/tests/69_owner_guc_direct_set_fail_closed.sql, mode: "100644", blob: 315ff0a7e491398fdbe49dc3945b016d0c984c8e}
    - {path: infra/db/tests/70_owner_forged_binding_denied.sql, mode: "100644", blob: c648e2ee2340b75844a3a983f770a28f34558d41}
    - {path: infra/db/tests/71_begin_job_context_permission_denied.sql, mode: "100644", blob: f215ca5b8119682dce3afbea9c7d3a720dbfdd1e}
    - {path: infra/db/tests/72_owner_binding_replay_and_legit_path.sql, mode: "100644", blob: ab2d2b4ce54f57a57838de433623ea93d0a9cacd}
    - {path: infra/db/tests/73_owner_secret_table_invisible_to_runtime_roles.sql, mode: "100644", blob: 62e4f8b44f3272eb3cefe08bd2ac72ede233d28f}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java, mode: "100644", blob: 05aa41e066c35109793776671c9d6368e6c32b45}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrap.java, mode: "100644", blob: bbb3ded72b8fc60b968c7d3153efc8c4e28fd0e1}
    - {path: service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java, mode: "100644", blob: fefa6ee1f2fc85a9da58d3ebe0f27780a2701aac}
    - {path: service/apps/runtime/src/main/resources/application.yaml, mode: "100644", blob: 41167decb36e6b510646b236ff0d6be47f4dee9f}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java, mode: "100644", blob: adc9fbc8371337ebcaa5eb2b0775e312e050ee13}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrapTest.java, mode: "100644", blob: 22d21c63abe244e6f0ae49c100cc8d5b706ced2c}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java, mode: "100644", blob: bb374b08df426ba003b51dcb11b9ff9f6884e21d}
    - {path: service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java, mode: "100644", blob: c3fd0dc38f0500aa43b6a1bb48975f4fe4eef090}
    - {path: service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql, mode: "100644", blob: 55f1ef47f47fd28a32b0b11d4782541b0baa3f29}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/decisions/0004-identity-session-boundary.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/evidence/TASK-0191/evidence-pack.json
  - docs/evidence/TASK-0191/review-r1.md
  - docs/handoffs/TASK-0191.json
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/evidence/TASK-0192/evidence-pack.json
  - docs/evidence/TASK-0192/review-r1.md
  - docs/handoffs/TASK-0192.json
  - scripts/harness/doctor.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - service/platform/persistence/src/main/resources/db/migration/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/**
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
writeAllowlist:
  - infra/db/tests/00_owner_binding_secret_seed.sql
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/26_relationship_active_limit_enforced.sql
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/31_message_history_pagination.sql
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_idempotency.sql
  - infra/db/tests/37_memory_recall_scope_budget.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/57_search_path_public_create_fail_closed.sql
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - infra/db/tests/64_worker_coordinator_cross_session_recovery.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - infra/db/tests/67_generation_external_attempt_completed_chain.sql
  - infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql
  - infra/db/tests/69_owner_guc_direct_set_fail_closed.sql
  - infra/db/tests/70_owner_forged_binding_denied.sql
  - infra/db/tests/71_begin_job_context_permission_denied.sql
  - infra/db/tests/72_owner_binding_replay_and_legit_path.sql
  - infra/db/tests/73_owner_secret_table_invisible_to_runtime_roles.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrap.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/OwnerBindingSecretBootstrapTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0193/**
  - docs/handoffs/TASK-0193.json
forbiddenPaths:
  - .github/**
  - ci/**
  - frontend/**
  - infra/db/run-rls-tests.sh
  - scripts/harness/**
  - skills/**
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
  - service/apps/runtime/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V19__admin_seed_concurrency_guard.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/evidence/TASK-0184/**
  - docs/evidence/TASK-0189/**
  - docs/evidence/TASK-0190/**
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/handoffs/TASK-0184.json
  - docs/handoffs/TASK-0189.json
  - docs/handoffs/TASK-0190.json
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/evidence/TASK-0191/evidence-pack.json
  - docs/handoffs/TASK-0191.json
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/evidence/TASK-0192/evidence-pack.json
  - docs/handoffs/TASK-0192.json
  - scripts/harness/doctor.py
requiredInvariants:
  - INV-TENANT-001
  - INV-WORKER-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: inherited-state-adoption
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 明确批准 TASK-0193 的 C4 范围：baseCommit 必须为 9a9c77caeb65a3f4
      4eb9aa77368b20f87b4ec5cf（TASK-0192 ACCEPTED 终态）；绑定原实现前基线 3c7fd0b5b3
      06325d51464053e7b3382044c3dd4b、TASK-0191 REJECTED 终态 2abc531bde888d7f9689d199fb8b09
      2b3341b226、实现提交 bfc6a62d53eb55c22dc257216b1db8592f50c667、后续修复提交 8f08bb1d1
      97c2787d91080aa33684a8444b8b7b0、scope amendment 26689494cfe560cd1b388d2a1a6c44adadb1
      e8d2；manifest 确定规则 = 3c7fd0b..2abc531 diff 恰 78 路径、精确排除 8 个 TASK-0191
      治理路径后恰 70 个业务/迁移/测试路径、逐项绑定当前 Base 的 path/mode/blob 与有序
      path-set hash、manifest hash 和实现树，任一不匹配失败关闭；writeAllowlist 逐项列出 70
      个精确路径（不用 glob）+ 本卡治理路径；TASK-0191/0192 历史、Context、Evidence、
      Handoff 与治理文件 forbidden；不修改 V1-V26 migration，只允许继承的 V27；不创建
      pre-READY maintenance boundary，若 READY Doctor 因新 blocker 非 PASS 暂停并一次性
      上报；最多一次复核修正且只能修改已冻结的 70 个路径；四条验收命令冻结绑定同一真实
      候选 SHA 与真实退出码，不得复用 TASK-0191 旧 PASS；C4 独立 Reviewer 必须审查实际继
      承实现范围 3c7fd0b..2abc531 并重跑四条验收命令；完整 discover 未运行时保持 NOT_RUN；
      在冻结范围内自主完成 DRAFT/READY/IN_PROGRESS/验证/独立复核/终态闭环，仅在 manifest
      非精确 70、路径扩展、修改治理策略或既有 migration、验收命令非 PASS、Reviewer P0/P1、
      推送合并等不可逆操作时暂停合并为一次提问。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 批准确立 protected-path **/db/migration/** 的 C4 database-migration
      人工批准：本卡不修改任何 V1-V26 migration，仅接纳继承的 V27 owner-context 密码学
      绑定迁移（只读核验 + 必要时在唯一允许的复核修正批次内修复 V27 自身缺陷）；TASK-0191
      2026-08-13 的 database-migration 安全边界批准（域分离四元绑定、GUC transaction-local、
      current_owner_id 每调用重校验、begin_job_context 双 REVOKE、秘密表零权限）继续有效。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0193
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（前一合法终态：TASK-0192 ACCEPTED `9a9c77c`）。本卡是
> inherited-state adoption/verification task：TASK-0191 因治理范围错误以 REJECTED 闭合，
> 其业务实现仍在当前树中；本卡对该继承实现做明确授权、同一候选 SHA 全量复验与独立复核，
> **不是重新实现**。TASK-0191 保持 REJECTED，本卡接纳的对象是当前树中机器绑定的继承实现。

## 继承 manifest 确定规则（Owner 冻结，失败关闭）

1. 原实现窗口 = `3c7fd0b5b306325d51464053e7b3382044c3dd4b`（TASK-0190 ACCEPTED 终态，
  TASK-0191 baseCommit）→ `2abc531bde888d7f9689d199fb8b092b3341b226`（TASK-0191 REJECTED
  终态，tree `d60e437be565221344e67d59cc182b08328aff84`）。
2. `git diff --name-only 3c7fd0b 2abc531` 总路径数必须恰为 **78**。
3. 精确排除 8 个 TASK-0191 治理路径（`inheritedStateManifest.governanceExcludedPaths`）。
4. 排除后必须恰为 **70** 个业务、迁移和测试路径（61 个 `infra/db/tests/*.sql` + 8 个
  service 路径 + 1 个 V27 migration）。
5. 对 70 路径逐项绑定当前 Base `9a9c77c` 中的 path、mode（全部 `100644`）、blob SHA，
  并绑定有序 path-set hash、manifest hash 与实现树（见 `inheritedStateManifest`；
  canonicalization 规则逐字记录于该字段）。
6. 任一路径、数量、mode、blob、来源提交或树不匹配时失败关闭，不得自行调整规则继续。
7. 附加完整性事实（已验证并纳入验收）：70 路径在 `2abc531` 与 `9a9c77c` 的 blob 逐项
  一致（继承实现未被后续任务改动）；`2668949`（amendment）→ `bfc6a62`（实现）→
  `8f08bb1`（修复）单父链成立。

## 任务性质与验证内容

- **授权**：Owner 2026-08-14 批准对继承实现的正式接纳；本卡 writeAllowlist 覆盖 70 个
  继承路径（预期零修改；仅为唯一允许的复核修正批次保留写权限）。
- **manifest 核验**：按上述规则从 Git 重新计算并逐项比对 `inheritedStateManifest`；
  任何漂移立即失败关闭。
- **全量复验**（四条冻结命令，同一真实候选 SHA，真实退出码，不复用 TASK-0191 旧 PASS）：
  canonical precheck、Maven runtime 全量、RLS 全套、`git diff --check`。
- **安全复验矩阵**（由 RLS/mvn 测试实证，Reviewer 独立核对覆盖）：直接 SET owner GUC 失败
  关闭（69）；伪造 proof/binding 失败（70）；proof 跨 owner、跨事务、跨 backend 重放失败 +
  合法 OwnerContext 路径成功 + 跨租户 RLS 仍隔离（72）；runtime 角色不能读 secret table（73）；
  proof helper 不形成 minting oracle（V27 双 REVOKE + 73 审计）；`begin_job_context` 对 PUBLIC
  与 runtime 角色无权限（71）；secret 缺失、过短、不一致启动失败 + 日志/异常不泄漏
  secret/proof（OwnerBindingSecretBootstrapTest、OwnerContextTest）。

## 范围内

- manifest 核验、四条验收命令执行、C4 独立复核与本卡治理路径（card/context/evidence/
  handoff/project-state/ledger）。
- 唯一允许的复核修正批次（`maximumFixBatches: 1`）：仅当四条命令或 Reviewer 发现缺陷时，
  且只能修改 `inheritedStateManifest.paths` 冻结的 70 个路径。

## 明确范围外

- 不重新实现、不重构继承实现；不修改 V1-V26 migration、历史任务制品与治理真源。
- 不创建 pre-READY maintenance boundary；READY Doctor 因新 blocker 非 PASS 时暂停并
  一次性上报 Owner。
- 不修改 TASK-0191/0192 历史与其终态结论（TASK-0191 保持 REJECTED）。
- 不推送、不合并、不 rebase、不 reset、不改写历史。

## 状态机和失败行为

- manifest 任一项不匹配（数量≠78/8/70、mode/blob/树/来源提交漂移）→ 立即失败关闭并
  上报，不自行调整规则。
- 任一验收命令非 PASS → 记录真实退出码，进入至多一次复核修正（仅 70 路径内）后重跑；
  仍非 PASS 或超出批次 → REJECTED/暂停上报。
- Reviewer P0/P1 → 停止并合并为一次 Owner 提问。
- 完整 harness unittest discover 因 34 分钟 CI 预算风险未运行时，Evidence 保持 `NOT_RUN`，
  不得表述为 PASS 或「CI 完全兼容」。

## 验收标准

1. manifest 机器核验通过：78/8/70、逐路径 mode/blob、path-set hash、manifest hash、实现树
   与绑定提交全部精确匹配；70 路径 blob 在 Base 与继承终态一致。
2. 四条 `requiredCommands` 以同一真实候选 SHA 真实 PASS（真实退出码记录于 Evidence）；
   canonical precheck 含 licenseCheck 全绿。
3. C4 独立 Reviewer 审查实际继承实现范围 `3c7fd0b..2abc531`（非仅本卡治理 diff），独立
   核对 manifest/blob/tree 并重跑四条验收命令，裁决无 P0/P1。
4. diff 仅含 writeAllowlist 路径；V1-V26、TASK-0191/0192 历史制品零修改；TASK-0191 仍为
   REJECTED；Evidence/Handoff/project-state nextAction 逐字一致；Ledger 追加 TASK-0193。
5. 完整 unittest discover 未运行时如实 NOT_RUN；保持未推送、未合并。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准（四条命令绑定同一真实候选 SHA）。

## Evidence Pack

输出到 `docs/evidence/TASK-0193/`（含 `inherited-manifest.json`、`review-r1.md`），并生成
`docs/handoffs/TASK-0193.json`。
