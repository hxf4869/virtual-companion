//go:build integration

package postgres

import "testing"

func TestStoredChatSX7FWorkerPrunesExpiredChangesInBatches(t *testing.T) {
	chat := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	group := "synthetic-retention"
	other, err := s.CreateStoredChat(ctx, 2, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: chat.AuthorityEpoch, Kind: "GROUP", GroupRef: &group})
	if err != nil {
		t.Fatal(err)
	}
	// Age body-free change rows directly on both sides of seven days.
	// No chat writes happen while the worker drains the backlog.
	if err = IsolationSuperExec(ctx, `
WITH recent AS (
    UPDATE vc.chat_change SET created_at=now()-interval '6 days'
    WHERE revision=1 AND ((owner_user_id=1 AND chat_id=$1) OR (owner_user_id=2 AND chat_id=$2))
)
INSERT INTO vc.chat_change(owner_user_id,chat_id,revision,event,created_at)
SELECT 1,$1::uuid,n,'{}'::jsonb,now()-interval '8 days' FROM generate_series(2,1002) n
UNION ALL
SELECT 2,$2::uuid,2,'{}'::jsonb,now()-interval '8 days'`, chat.ChatID, other.ChatID); err != nil {
		t.Fatal(err)
	}
	pool := superPool(t, ctx)
	previous := [2]int{1001, 1}
	for round := 1; round <= 3; round++ {
		if err = s.PruneStoredChatRuns(ctx); err != nil {
			t.Fatalf("prune round %d: %v", round, err)
		}
		var expired, recent [2]int
		err = pool.QueryRow(ctx, `
SELECT count(*) FILTER (WHERE owner_user_id=1 AND revision>1),
       count(*) FILTER (WHERE owner_user_id=2 AND revision>1),
       count(*) FILTER (WHERE owner_user_id=1 AND revision=1),
       count(*) FILTER (WHERE owner_user_id=2 AND revision=1)
FROM vc.chat_change WHERE (owner_user_id=1 AND chat_id=$1) OR (owner_user_id=2 AND chat_id=$2)`,
			chat.ChatID, other.ChatID).Scan(&expired[0], &expired[1], &recent[0], &recent[1])
		if err != nil {
			t.Fatal(err)
		}
		if recent != [2]int{1, 1} {
			t.Fatalf("round %d removed a recent change: counts=%v", round, recent)
		}
		for i, before := range previous {
			if removed := before - expired[i]; removed < 0 || removed > 500 {
				t.Fatalf("round %d owner %d removed %d expired changes, want at most 500", round, i+1, removed)
			}
		}
		previous = expired
	}
	if previous != [2]int{} {
		t.Fatalf("three worker rounds left expired changes: counts=%v", previous)
	}
}
