//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

func TestStoredChatSX7FProfilePublicationRechecksSourceAuthority(t *testing.T) {
	for _, tc := range []struct {
		name              string
		frozen            bool
		rawAhead          bool
		omittedDependency bool
	}{
		{name: "current GO"},
		{name: "frozen", frozen: true},
		{name: "raw ahead of projection", rawAhead: true},
		{name: "omitted dependency raw ahead of projection", rawAhead: true, omittedDependency: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			chat := sx7SourceChat(t)
			sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic profile source", "is_user": true}))
			binding := STBinding{
				RelationshipID: *chat.RelationshipID, ConversationID: *chat.ConversationID,
				ChatIdentity: chat.ChatID, CharacterRef: *chat.CharacterRef, Mode: "COMPANION",
			}
			ref := refForChat(t, chat.ChatID)
			addSTMemory(t, binding, "synthetic profile fact", ref)
			prepareEngineProfileJob(t, binding, ref)
			claim, revision := loadProfileClaim(t, ref, binding.RelationshipID)
			deps := []string{sourceDependencyID(t, ref)}
			fullRefs, fullDeps := []string{ref}, slices.Clone(deps)
			mutatedChatID := chat.ChatID
			if tc.omittedDependency {
				otherBinding, otherRef := addStoredChatProfileDependency(t, chat, binding)
				mutatedChatID = otherBinding.ChatIdentity
				fullRefs = append(fullRefs, otherRef)
				fullDeps = append(fullDeps, sourceDependencyID(t, otherRef))
				slices.Sort(fullRefs)
				slices.Sort(fullDeps)
			}
			const persona = "synthetic profile persona"

			entered, release := make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/internal/operation-status":
					json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
				case "/internal/rebuild-profile":
					var input struct {
						VerifiedDependencies []string `json:"verifiedDependencies"`
					}
					if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
						t.Errorf("decode engine rebuild request: %v", err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					slices.Sort(input.VerifiedDependencies)
					if !slices.Equal(input.VerifiedDependencies, fullDeps) {
						t.Error("engine did not receive the full verified dependency set")
					}
					// The engine can publish only a subset of the allowed
					// dependencies. SQL still stores the full allowlist.
					json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": deps})
				case "/internal/read-profile":
					// Go has reconciled the evidence and is waiting to read the
					// engine result. The SQL publication has yet to run.
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"dependencies": deps, "files": map[string]string{"persona.md": persona}})
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			client, err := memoryengine.New(server.URL, "synthetic-profile-token")
			if err != nil {
				t.Fatal(err)
			}
			s := testEnv.store
			s.UseMemoryEngine(client)
			defer s.UseMemoryEngine(nil)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			op := EngineOperation{
				ID: fmt.Sprintf("fixture-profile-%d", claim.JobID), ProfileOperationID: fmt.Sprintf("profile-authority-%d", claim.JobID),
				Scope: EngineScope(1, binding.RelationshipID), Revision: revision, SourceRef: ref,
				Input: MemoryExtractInput{RelationshipID: binding.RelationshipID, ConversationID: binding.ConversationID},
			}
			done := make(chan struct{})
			var buildErr error
			go func() {
				defer close(done)
				buildErr = s.BuildEngineProfile(ctx, claim, op, "synthetic-capability")
			}()
			defer func() {
				cancel()
				<-done
			}()
			select {
			case <-entered:
			case <-done:
				t.Fatalf("profile did not reach the engine read: %v", buildErr)
			case <-ctx.Done():
				t.Fatal("profile timed out before the engine read")
			}
			switch {
			case tc.frozen:
				err = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='FROZEN' WHERE owner_user_id=1`)
			case tc.rawAhead:
				err = IsolationSuperExec(ctx, `UPDATE vc.stored_chat SET revision=revision+1 WHERE owner_user_id=1 AND chat_id=$1`, mutatedChatID)
			}
			if err != nil {
				t.Fatal(err)
			}
			close(release)
			<-done
			wantCode, wantRows := "", 1
			if tc.frozen || tc.rawAhead {
				wantCode, wantRows = "MEMORYCORE_PROFILE_SOURCE", 0
			}
			if got := memoryengine.ClosedCode(buildErr); got != wantCode || (wantCode == "" && buildErr != nil) {
				t.Errorf("profile publication: got %v, want closed code %q", buildErr, wantCode)
			}
			var rows, matching int
			err = superPool(t, ctx).QueryRow(ctx, `
SELECT count(*),count(*) FILTER (WHERE valid AND persona=$2 AND st_source_refs=$3)
FROM vc.memory_profile WHERE owner_user_id=1 AND relationship_id=$1`, binding.RelationshipID, persona, fullRefs).Scan(&rows, &matching)
			if err != nil {
				t.Fatal(err)
			}
			if rows != wantRows || matching != wantRows {
				t.Errorf("stored profile rows=%d valid with expected evidence=%d, want %d", rows, matching, wantRows)
			}
		})
	}
}

// Resolve an independent conversation in the same relationship. The normal
// create endpoint starts a new relationship, and forks share a branch root.
func addStoredChatProfileDependency(t *testing.T, chat StoredChat, binding STBinding) (STBinding, string) {
	t.Helper()
	s, ctx := testEnv.store, t.Context()
	other, err := s.ResolveSTBinding(ctx, 1, STBindingInput{
		ChatIdentity: chatUUID(), CharacterRef: binding.CharacterRef, Mode: binding.Mode,
		RelationshipID: &binding.RelationshipID,
	})
	if err != nil {
		t.Fatal(err)
	}
	empty, err := s.encodeChatJSON(ChatData{})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.insert_stored_chat(1,$1,'SINGLE',$2,$3,$4,NULL,$1,'synthetic',$5,$5)`,
			other.ChatIdentity, other.ConversationID, other.RelationshipID, other.CharacterRef, empty)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	raw := StoredChat{StoredChatSummary: StoredChatSummary{ChatID: other.ChatIdentity, AuthorityEpoch: chat.AuthorityEpoch}}
	sx5Append(t, raw, sx5AppendRequest(raw, ChatData{"mes": "synthetic additional source", "is_user": true}))
	ref := refForChat(t, other.ChatIdentity)
	addSTMemory(t, other, "synthetic additional fact", ref)
	return other, ref
}
