//go:build integration

package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestSTMemoryRecentTopicUsesVerifiedTargetWindow(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "我想继续图书馆改造项目。", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	addSTMemory(t, b, "市集筹备的下一步是检查摊位。", refForChat(t, sourceChat))
	target := "10000000-0000-0000-0000-000000000010"
	targetBinding, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{
		ChatIdentity: target, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &b.RelationshipID,
	})
	if err != nil {
		t.Fatal(err)
	}

	const topic = "10月30日市集筹备"
	const indirect = "我们上次谈到哪一步了？"
	const explicit = "市集筹备上次谈到哪一步了？"
	named := stsource.Message{Role: "user", Text: "今天想继续" + topic + "。", Eligible: true}
	other := stsource.Message{Role: "user", Text: "图书馆改造项目也搁了很久。", Eligible: true}
	neutral := stsource.Message{Role: "user", Text: "先回顾一下吧。", Eligible: true}
	cases := []struct {
		name       string
		before     []stsource.Message
		question   string
		want       string
		suppressed bool
	}{
		{"unsettled user topic", []stsource.Message{
			named, {Role: "assistant", Text: "我想继续玻璃温室翻新项目。", Eligible: true}, neutral,
		}, indirect, topic + "：" + indirect, false},
		{"explicit question in mixed window", []stsource.Message{named, other}, explicit, explicit, false},
		{"mixed user topics", []stsource.Message{named, other}, indirect, "", false},
		{"no local history", nil, indirect, indirect, false},
		{"topic outside three preceding user turns", []stsource.Message{named, neutral, neutral, neutral}, indirect, "", false},
		{"ineligible user turn blocks older hint", []stsource.Message{named, {Role: "user", Text: "先回顾一下吧。"}}, indirect, "", false},
		{"suppressed topic", []stsource.Message{named}, indirect, "", true},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			snapshot := stMemorySnapshot(target, tc.question, at)
			snapshot.Revision = int64(i + 1)
			snapshot.Messages[0].Settled = false
			snapshot.Messages = append(append([]stsource.Message{}, tc.before...), snapshot.Messages[0])
			for j := range snapshot.Messages {
				key := 100 + i*10 + j
				snapshot.Messages[j].MessageID = fmt.Sprintf("20000000-0000-0000-0000-%012d", key)
				snapshot.Messages[j].CandidateID = fmt.Sprintf("30000000-0000-0000-0000-%012d", key)
				snapshot.Messages[j].Revision = 1
			}
			snapshots[target] = snapshot
			if tc.suppressed {
				// A persisted memory can only have settled evidence. Suppress it
				// through the actual owner-bound forget path, including its fences.
				snapshot.Messages[0].Settled = true
				if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{target}); err != nil {
					t.Fatal(err)
				}
				var ref string
				if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
					return tx.QueryRow(ctx, `SELECT source_ref FROM vc.st_message_source
                        WHERE owner_user_id=1 AND message_id=$1`, snapshot.Messages[0].MessageID).Scan(&ref)
				}); err != nil {
					t.Fatal(err)
				}
				memory := addSTMemory(t, targetBinding, topic, ref)
				if err := testEnv.store.ForgetManagedMemory(ctx, 1, memory.ID); err != nil {
					t.Fatal(err)
				}
			}
			lastEngineSearch = nil
			out, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: target, Revision: snapshot.Revision, Enabled: true})
			if err != nil {
				t.Fatal(err)
			}
			if tc.want == "" {
				if out.Status != "skipped" || out.Block != "" || lastEngineSearch != nil {
					t.Fatal("inconclusive context reached memory search or injection")
				}
				return
			}
			if got := lastEngineSearch["query"]; got != tc.want {
				t.Fatalf("engine query = %q, want %q", got, tc.want)
			}
			if _, exists := lastEngineSearch["dateRestricted"]; exists {
				t.Fatal("context date changed the question's date restriction")
			}
		})
	}
}
