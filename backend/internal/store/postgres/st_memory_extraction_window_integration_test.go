//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func extractionWindowFixture(t *testing.T, users ...stsource.Message) (*Store, map[string]stsource.Snapshot, STBinding, JobClaim, EngineOperation, []EngineExtractionMessage) {
	t.Helper()
	s, snapshots := engineSampleStore(t)
	ctx := context.Background()
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "extraction-window", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	assistantAt := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	user := stsource.Message{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "对，每周都去。", Eligible: true, Settled: true}
	if len(users) > 0 {
		user = users[0]
	}
	snapshots[sourceChat] = stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/window.jsonl", Messages: []stsource.Message{
		{MessageID: "20000000-0000-0000-0000-000000000099", CandidateID: "30000000-0000-0000-0000-000000000099", Revision: 1, Role: "assistant", Text: "你说的是每周三游泳？", Eligible: true, Settled: true, SourceTimestamp: &assistantAt},
		user,
	}}
	if _, err = s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim count=%d: %v", len(jobs), err)
	}
	op, err := s.PrepareEngineOperation(ctx, jobs[0])
	if err != nil {
		t.Fatal(err)
	}
	window, err := s.ReadEngineExtractionWindow(ctx, jobs[0], op)
	if err != nil || len(window) != 2 || window[0].Role != "assistant" || window[1].ID != op.SourceKey {
		t.Fatalf("window length=%d: %v", len(window), err)
	}
	if window[0].TimestampFallback == nil || *window[0].TimestampFallback || window[0].Timestamp != assistantAt.Format(time.RFC3339Nano) ||
		window[1].TimestampFallback == nil || *window[1].TimestampFallback != (user.SourceTimestamp == nil) {
		t.Fatal("window did not distinguish a real source clock from a missing one")
	}
	// Retries must send the same bookkeeping time, even without a source clock.
	op.Timestamp = op.Timestamp.Add(time.Hour)
	replay, err := s.ReadEngineExtractionWindow(ctx, jobs[0], op)
	if err != nil || !reflect.DeepEqual(window, replay) {
		t.Fatalf("unstable window replay: %v", err)
	}
	return s, snapshots, binding, jobs[0], op, window
}

func nextExtractionWindow(t *testing.T, s *Store, snapshots map[string]stsource.Snapshot, prior JobClaim, users ...stsource.Message) (JobClaim, EngineOperation, []EngineExtractionMessage) {
	t.Helper()
	ctx := context.Background()
	if err := s.CompleteJob(ctx, 1, prior.JobID, prior.Token, prior.Fence, "DONE", ""); err != nil {
		t.Fatal(err)
	}
	snapshot := snapshots[sourceChat]
	snapshot.Revision++
	user := stsource.Message{
		MessageID: "20000000-0000-0000-0000-000000000098", CandidateID: "30000000-0000-0000-0000-000000000098",
		Revision: 1, Role: "user", Text: "另外，我周四去买书。", Eligible: true, Settled: true,
	}
	if len(users) > 0 {
		user = users[0]
	}
	snapshot.Messages = append(snapshot.Messages, user)
	snapshots[sourceChat] = snapshot
	if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("second claim count=%d: %v", len(jobs), err)
	}
	job := jobs[0]
	op, err := s.PrepareEngineOperation(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	window, err := s.ReadEngineExtractionWindow(ctx, job, op)
	if err != nil {
		t.Fatal(err)
	}
	return job, op, window
}

func windowRecord(id, content string, dependencies ...string) EngineRecord {
	return EngineRecord{ID: id, Content: content, Version: 1, SourceMessageIDs: dependencies,
		Metadata: map[string]any{"vcDependencies": dependencies, "vcPrimarySourceId": dependencies[len(dependencies)-1]}}
}

func windowProposal(t *testing.T, window []EngineExtractionMessage, records ...EngineRecord) json.RawMessage {
	t.Helper()
	proposal := EngineProposal{Records: records, Targets: []EngineTarget{}, Dependencies: []string{}}
	for _, message := range window {
		proposal.ContextDependencies = append(proposal.ContextDependencies, message.ID)
	}
	for _, record := range records {
		for _, id := range record.SourceMessageIDs {
			if !slices.Contains(proposal.Dependencies, id) {
				proposal.Dependencies = append(proposal.Dependencies, id)
			}
		}
	}
	raw, err := json.Marshal(proposal)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestExtractionWindowLegacyProposalKeepsSingleUserEvidence(t *testing.T) {
	s, _, _, job, op, _ := extractionWindowFixture(t)
	// This proposal was persisted before window extraction existed. New
	// context must not be silently added to its exact dependency set.
	raw, err := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: "legacy-record", Content: "合成旧事实", Version: 1, SourceMessageIDs: []string{op.SourceKey}}}, Dependencies: []string{op.SourceKey}})
	if err != nil {
		t.Fatal(err)
	}
	refs, err := s.ValidateEngineProposal(context.Background(), job, op, raw)
	if err != nil || !reflect.DeepEqual(refs, []string{op.SourceRef}) {
		t.Fatalf("legacy proposal changed dependencies: count=%d err=%v", len(refs), err)
	}
}

func TestExtractionWindowAssistantEvidenceInvalidates(t *testing.T) {
	for _, change := range []string{"edit", "delete", "candidate"} {
		t.Run(change, func(t *testing.T) {
			s, snapshots, binding, job, op, window := extractionWindowFixture(t)
			ctx := context.Background()
			raw := windowProposal(t, window,
				windowRecord("window-record", "用户每周三游泳。", window[0].ID, op.SourceKey),
				windowRecord("standalone-record", "独立用户事实。", op.SourceKey))
			if err := s.PublishEngineProposal(ctx, job, op, raw); err != nil {
				t.Fatal(err)
			}
			var evidence int
			if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
				return tx.QueryRow(ctx, `SELECT count(*) FROM vc.go_memorycore_projection(1,$1) m CROSS JOIN LATERAL vc.list_memory_evidence(1,m.memory_id) e WHERE m.record_id='window-record'`, binding.RelationshipID).Scan(&evidence)
			}); err != nil || evidence != 2 {
				t.Fatalf("support evidence count=%d: %v", evidence, err)
			}
			snapshot := snapshots[sourceChat]
			snapshot.Revision++
			switch change {
			case "edit":
				snapshot.Messages[0].Revision++
				snapshot.Messages[0].Text = "你说的是周四？"
			case "delete":
				snapshot.Messages = snapshot.Messages[1:]
			case "candidate":
				snapshot.Messages[0].CandidateID = "30000000-0000-0000-0000-000000000098"
			}
			snapshots[sourceChat] = snapshot
			if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
				t.Fatal(err)
			}
			if ids, err := s.engineAllowed(ctx, 1, binding.RelationshipID, binding.ConversationID); err != nil || !slices.Equal(ids, []string{"standalone-record"}) {
				t.Fatalf("assistant evidence affected the wrong records: ids=%v err=%v", ids, err)
			}
			if _, err := s.ValidateEngineProposal(ctx, job, op, raw); err == nil {
				t.Fatal("changed assistant evidence accepted on replay")
			}
		})
	}
}

func TestExtractionWindowAssistantChangesDuringModelRejectPublication(t *testing.T) {
	s, snapshots, _, job, op, window := extractionWindowFixture(t)
	ctx := context.Background()
	raw := windowProposal(t, window, windowRecord("window-record", "独立用户事实。", op.SourceKey))
	if _, err := s.ValidateEngineProposal(ctx, job, op, raw); err != nil {
		t.Fatal(err)
	}
	snapshot := snapshots[sourceChat]
	snapshot.Revision++
	snapshot.Messages[0].Revision++
	snapshot.Messages[0].Text = "已修改的助手澄清"
	snapshots[sourceChat] = snapshot
	// Publish performs its existing reconciliation itself, as when a model
	// finishes after ST changed but no separate reconcile ran in the meantime.
	if err := s.PublishEngineProposal(ctx, job, op, raw); err == nil {
		t.Fatal("late proposal published with changed unused context")
	}
}

func TestExtractionWindowInheritsOnlyLinkedTargetEvidence(t *testing.T) {
	s, snapshots, binding, first, a, window := extractionWindowFixture(t)
	ctx := context.Background()
	if err := s.PublishEngineProposal(ctx, first, a, windowProposal(t, window, windowRecord("old-record", "旧事实。", a.SourceKey))); err != nil {
		t.Fatal(err)
	}
	job, b, window := nextExtractionWindow(t, s, snapshots, first)
	proposal := func(inherit bool) json.RawMessage {
		replacement := windowRecord("replacement", "替代事实。", b.SourceKey)
		if inherit {
			replacement = windowRecord("replacement", "替代事实。", b.SourceKey, a.SourceKey)
		}
		replacement.Metadata["vcPrimarySourceId"] = b.SourceKey
		replacement.Version = 2
		replacement.ConflictTargetIDs = []string{"old-record"}
		// The old source is not in the replayed prompt. It must be
		// inherited from the named target by the replacement alone.
		var p EngineProposal
		raw := windowProposal(t, window[len(window)-1:], replacement, windowRecord("unrelated", "独立事实。", b.SourceKey))
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatal(err)
		}
		p.Targets = []EngineTarget{{ID: "old-record", Version: 1}}
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	if _, err := s.ValidateEngineProposal(ctx, job, b, proposal(false)); err == nil {
		t.Fatal("replacement dropped target evidence")
	}
	if err := s.PublishEngineProposal(ctx, job, b, proposal(true)); err != nil {
		t.Fatal(err)
	}
	records, err := s.engineCandidates(ctx, 1, binding.RelationshipID, binding.ConversationID)
	if err != nil || len(records) != 2 {
		t.Fatalf("replacement publication count=%d: %v", len(records), err)
	}
	if refs := records["replacement"].Sources; len(refs) != 2 || !slices.Contains(refs, a.SourceRef) || !slices.Contains(refs, b.SourceRef) {
		t.Fatalf("replacement evidence: %v", refs)
	}
	if refs := records["unrelated"].Sources; !slices.Equal(refs, []string{b.SourceRef}) {
		t.Fatalf("unrelated record inherited target evidence: %v", refs)
	}
}

func TestExtractionWindowWritesEachFactTimeFromItsCitedUser(t *testing.T) {
	atA := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	atB := atA.Add(48 * time.Hour)
	s, snapshots, binding, first, a, _ := extractionWindowFixture(t, stsource.Message{
		MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "明天去买书。",
		Eligible: true, Settled: true, SourceTimestamp: &atA, SourceTimezone: "UTC",
	})
	job, b, window := nextExtractionWindow(t, s, snapshots, first, stsource.Message{
		MessageID: "20000000-0000-0000-0000-000000000098", CandidateID: "30000000-0000-0000-0000-000000000098",
		Revision: 1, Role: "user", Text: "明天去游泳。", Eligible: true, Settled: true, SourceTimestamp: &atB, SourceTimezone: "UTC",
	})
	if len(window) != 3 || window[0].SourceTime != nil {
		t.Fatalf("assistant supplied a source clock or window length changed: count=%d", len(window))
	}
	for i, date := range []string{"2026-11-05", "2026-11-07"} {
		sourceTime := window[i+1].SourceTime
		if sourceTime == nil || sourceTime.EventDate == nil || *sourceTime.EventDate != date {
			t.Fatalf("window clock %d: %+v", i, sourceTime)
		}
	}
	ctx := context.Background()
	recordA := windowRecord("fact-a", "2026-11-05去买书。", a.SourceKey)
	recordB := windowRecord("fact-b", "2026-11-07去游泳。", b.SourceKey)
	recordA.Metadata["vcPrimarySourceId"] = b.SourceKey
	if _, err := s.ValidateEngineProposal(ctx, job, b, windowProposal(t, window, recordA, recordB)); err == nil {
		t.Fatal("accepted a primary clock from a user the fact did not cite")
	}
	recordA.Metadata["vcPrimarySourceId"] = a.SourceKey
	if err := s.PublishEngineProposal(ctx, job, b, windowProposal(t, window, recordA, recordB)); err != nil {
		t.Fatal(err)
	}
	assertClock := func(record Memory, date string, at time.Time) {
		t.Helper()
		if record.Time == nil || record.Time.EventDate == nil || *record.Time.EventDate != date ||
			record.Time.SourceTimestamp == nil || !record.Time.SourceTimestamp.Equal(at) || record.Time.SourceExpression != "明天" {
			t.Fatalf("fact clock: %+v", record.Time)
		}
	}
	records, err := s.engineCandidates(ctx, 1, binding.RelationshipID, binding.ConversationID)
	if err != nil || len(records) != 2 {
		t.Fatalf("published facts=%d: %v", len(records), err)
	}
	assertClock(records["fact-a"], "2026-11-05", atA)
	assertClock(records["fact-b"], "2026-11-07", atB)
	if err := s.ForgetManagedMemory(ctx, 1, records["fact-b"].ID); err != nil {
		t.Fatal(err)
	}
	records, err = s.engineCandidates(ctx, 1, binding.RelationshipID, binding.ConversationID)
	if err != nil || len(records) != 1 {
		t.Fatalf("facts after forgetting B=%d: %v", len(records), err)
	}
	assertClock(records["fact-a"], "2026-11-05", atA)
}

func TestExtractionWindowRejectsOldAssistantTargetWithoutChangingMemory(t *testing.T) {
	s, snapshots, binding, job, op, window := extractionWindowFixture(t)
	ctx := context.Background()
	if err := s.PublishEngineProposal(ctx, job, op, windowProposal(t, window, windowRecord("window-record", "用户每周三游泳。", window[0].ID, op.SourceKey))); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteJob(ctx, 1, job.JobID, job.Token, job.Fence, "DONE", ""); err != nil {
		t.Fatal(err)
	}
	snapshot := snapshots[sourceChat]
	snapshot.Revision++
	for i := 0; i < 6; i++ {
		snapshot.Messages = append(snapshot.Messages, stsource.Message{MessageID: fmt.Sprintf("20000000-0000-0000-0000-%012d", 200+i),
			CandidateID: fmt.Sprintf("30000000-0000-0000-0000-%012d", 200+i), Revision: 1, Role: "assistant", Text: "后续澄清", Eligible: true, Settled: true})
	}
	snapshot.Messages = append(snapshot.Messages, stsource.Message{MessageID: "20000000-0000-0000-0000-000000000300",
		CandidateID: "30000000-0000-0000-0000-000000000300", Revision: 1, Role: "user", Text: "现在改成周四游泳。", Eligible: true, Settled: true})
	snapshots[sourceChat] = snapshot
	if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("new claim count=%d: %v", len(jobs), err)
	}
	next, err := s.PrepareEngineOperation(ctx, jobs[0])
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.ReadEngineExtractionWindow(ctx, jobs[0], next)
	if err != nil {
		t.Fatal(err)
	}
	var proposal EngineProposal
	if err := json.Unmarshal(windowProposal(t, current, windowRecord("window-record", "用户现在周四游泳。", next.SourceKey)), &proposal); err != nil {
		t.Fatal(err)
	}
	proposal.Records[0].ID = "replacement-record"
	proposal.Records[0].Content = "用户现在周四游泳。"
	proposal.Targets = []EngineTarget{{ID: "window-record", Version: 1}}
	proposal.Records[0].ConflictTargetIDs = []string{"window-record"}
	for _, source := range window {
		proposal.Dependencies = append(proposal.Dependencies, source.ID)
	}
	proposal.Records[0].SourceMessageIDs = proposal.Dependencies
	proposal.Records[0].Metadata["vcDependencies"] = proposal.Dependencies
	raw, _ := json.Marshal(proposal)
	if _, err := s.ValidateEngineProposal(ctx, jobs[0], next, raw); err == nil {
		t.Fatal("old assistant evidence bypassed the extraction window")
	}
	if ids, err := s.engineAllowed(ctx, 1, binding.RelationshipID, binding.ConversationID); err != nil || !reflect.DeepEqual(ids, []string{"window-record"}) {
		t.Fatalf("rejected replacement changed old memory: ids=%v err=%v", ids, err)
	}
	var intact bool
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_management_row(1,m.memory_id)->>'summary'='用户每周三游泳。'
            AND (vc.memory_management_row(1,m.memory_id)->>'recallEligible')::boolean AND m.version=1
            FROM vc.go_memorycore_projection(1,$1) m WHERE m.record_id='window-record'`, binding.RelationshipID).Scan(&intact)
	}); err != nil || !intact {
		t.Fatalf("old record damaged: intact=%t err=%v", intact, err)
	}
}

func TestExtractionWindowRejectsAssistantOnlyAndPrivateSources(t *testing.T) {
	for _, condition := range []string{"assistant-only", "record-assistant-only", "no-memory", "incognito", "foreign-chat", "outside-window"} {
		t.Run(condition, func(t *testing.T) {
			s, snapshots, binding, job, op, window := extractionWindowFixture(t)
			ctx := context.Background()
			raw := windowProposal(t, window, windowRecord("window-record", "用户每周三游泳。", window[0].ID, op.SourceKey))
			var proposal EngineProposal
			if err := json.Unmarshal(raw, &proposal); err != nil {
				t.Fatal(err)
			}
			switch condition {
			case "assistant-only":
				proposal.Dependencies = []string{window[0].ID}
				proposal.Records[0].SourceMessageIDs = proposal.Dependencies
				proposal.Records[0].Metadata["vcDependencies"] = proposal.Dependencies
			case "record-assistant-only":
				// The aggregate and metadata still claim the verified user.
				proposal.Records[0].SourceMessageIDs = []string{window[0].ID}
				proposal.Records[0].Metadata["vcPrimarySourceId"] = op.SourceKey
			case "no-memory":
				snapshot := snapshots[sourceChat]
				snapshot.Revision++
				snapshot.Messages[0].Eligible = false
				snapshots[sourceChat] = snapshot
			case "incognito":
				if err := IsolationSuperExec(ctx, fmt.Sprintf(`UPDATE vc.conversation SET incognito=true WHERE owner_user_id=1 AND id=%d`, binding.ConversationID)); err != nil {
					t.Fatal(err)
				}
			case "foreign-chat":
				foreign := "10000000-0000-0000-0000-000000000099"
				if _, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: foreign, CharacterRef: "extraction-window", Mode: "COMPANION", RelationshipID: &binding.RelationshipID}); err != nil {
					t.Fatal(err)
				}
				snapshots[foreign] = stsource.Snapshot{ChatIdentity: foreign, State: "PRESENT", Revision: 1, Location: "chats/synthetic/foreign.jsonl", Messages: snapshots[sourceChat].Messages[:1]}
				if _, err := s.ReconcileSTSources(ctx, 1, []string{foreign}); err != nil {
					t.Fatal(err)
				}
				if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
					return tx.QueryRow(ctx, `SELECT 'source-'||s.id||'-'||s.source_revision||'-'||s.source_generation FROM vc.st_message_source s JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id) WHERE s.owner_user_id=1 AND c.st_chat_identity=$1`, foreign).Scan(&proposal.Dependencies[0])
				}); err != nil {
					t.Fatal(err)
				}
				proposal.Records[0].SourceMessageIDs = proposal.Dependencies
				proposal.Records[0].Metadata["vcDependencies"] = proposal.Dependencies
			case "outside-window":
				snapshot := snapshots[sourceChat]
				snapshot.Revision++
				for i := 0; i < 6; i++ {
					message := stsource.Message{MessageID: fmt.Sprintf("20000000-0000-0000-0000-%012d", 200+i), CandidateID: fmt.Sprintf("30000000-0000-0000-0000-%012d", 200+i), Revision: 1, Role: "assistant", Text: "后续澄清", Eligible: true, Settled: true}
					snapshot.Messages = append(snapshot.Messages[:len(snapshot.Messages)-1], message, snapshot.Messages[len(snapshot.Messages)-1])
				}
				snapshots[sourceChat] = snapshot
			}
			if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
				t.Fatal(err)
			}
			if condition == "no-memory" {
				current, err := s.ReadEngineExtractionWindow(ctx, job, op)
				if err != nil || len(current) != 1 {
					t.Fatalf("no-memory support entered prompt: count=%d err=%v", len(current), err)
				}
			}
			raw, _ = json.Marshal(proposal)
			if _, err := s.ValidateEngineProposal(ctx, job, op, raw); err == nil {
				t.Fatal("untrusted support accepted")
			}
		})
	}
}

func TestExtractionWindowLegacyTargetsActuallyPublish(t *testing.T) {
	s, snapshots, binding, first, a, _ := extractionWindowFixture(t)
	ctx := context.Background()
	old, err := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: "old-target", Content: "旧事实", Version: 1, SourceMessageIDs: []string{a.SourceKey}}}, Targets: []EngineTarget{}, Dependencies: []string{a.SourceKey}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PublishEngineProposal(ctx, first, a, old); err != nil {
		t.Fatal(err)
	}
	job, b, _ := nextExtractionWindow(t, s, snapshots, first)
	legacy, err := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: "legacy-successor", Content: "纠正后的事实", Version: 1, SourceMessageIDs: []string{a.SourceKey, b.SourceKey}}}, Targets: []EngineTarget{{ID: "old-target", Version: 1}}, Dependencies: []string{a.SourceKey, b.SourceKey}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PublishEngineProposal(ctx, job, b, legacy); err != nil {
		t.Fatal(err)
	}
	candidates, err := s.engineCandidates(ctx, 1, binding.RelationshipID, binding.ConversationID)
	if err != nil || len(candidates) != 1 || len(candidates["legacy-successor"].Sources) != 2 {
		t.Fatalf("legacy publication=%v err=%v", candidates, err)
	}
	var saved EngineProposal
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT proposal FROM vc.memorycore_operation WHERE owner_user_id=1 AND job_id=$1`, job.JobID).Scan(&saved)
	}); err != nil {
		t.Fatal(err)
	}
	if len(saved.Records) != 1 || !slices.Equal(saved.Records[0].ConflictTargetIDs, []string{"old-target"}) || len(saved.RecordSourceRefs["legacy-successor"]) != 2 {
		t.Fatalf("legacy target/source manifest lost: %+v", saved)
	}
}
