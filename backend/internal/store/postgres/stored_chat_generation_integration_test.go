//go:build integration

package postgres

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func sx5Registration(c StoredChat, revision int64, input StoredMessage) ChatGenerationRegistrationRequest {
	return ChatGenerationRegistrationRequest{
		OwnerAccountID: "1", RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, RunID: chatUUID(),
		Revision: revision, InputMessageID: input.MessageID, InputCandidateID: input.SelectedCandidateID,
	}
}

func sx5Register(t *testing.T, c StoredChat, in ChatGenerationRegistrationRequest) ChatGenerationRegistration {
	t.Helper()
	got, err := testEnv.store.RegisterStoredChatGeneration(t.Context(), 1, c.ChatID, in)
	if err != nil {
		t.Fatalf("register generation run: %v", err)
	}
	return got
}

func sx5Terminal(c StoredChat, runID, state string) ChatAppendRequest {
	out := sx5AppendRequest(c, ChatData{"mes": "synthetic output", "is_user": false})
	out.Generation = &ChatGenerationCommit{RunID: runID, State: state}
	return out
}

func sx5Edit(t *testing.T, c StoredChat, m StoredMessage, candidate *string, change ChatFieldChange) {
	t.Helper()
	_, err := testEnv.store.EditStoredMessage(t.Context(), 1, c.ChatID, m.MessageID, ChatMessageEditRequest{
		RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, BaseRevision: m.Revision,
		CandidateID: candidate, Changes: []ChatFieldChange{change},
	})
	if err != nil {
		t.Fatalf("edit message: %v", err)
	}
}

func TestStoredChatSX5GenerationReplayAndSingleTerminal(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	inputWrite := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic input", "is_user": true}))
	input := inputWrite.Changed[0]
	first := sx5Registration(c, inputWrite.Revision, input)

	for _, bad := range []struct {
		name   string
		change func(*ChatGenerationRegistrationRequest)
	}{
		{"unsaved input", func(in *ChatGenerationRegistrationRequest) { in.InputMessageID = chatUUID() }},
		{"unsaved candidate", func(in *ChatGenerationRegistrationRequest) { in.InputCandidateID = chatUUID() }},
		{"future revision", func(in *ChatGenerationRegistrationRequest) { in.Revision++ }},
		{"zero revision", func(in *ChatGenerationRegistrationRequest) { in.Revision = 0 }},
	} {
		t.Run(bad.name, func(t *testing.T) {
			in := first
			bad.change(&in)
			_, err := s.RegisterStoredChatGeneration(t.Context(), 1, c.ChatID, in)
			expectChatCode(t, err, "REVISION_CONFLICT")
		})
	}

	// An ordinary append represents the same unrelated tail change as inbox.
	tail := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic background"})).Changed[0]
	registered := sx5Register(t, c, first)
	if registered.Revision != inputWrite.Revision || registered.InputMessageID != input.MessageID ||
		registered.InputCandidateID != input.SelectedCandidateID || registered.InputMessageRevision != input.Revision ||
		registered.InputSourceRevision != input.Candidates[0].SourceRevision ||
		registered.InputSourceGeneration != input.Candidates[0].SourceGeneration || registered.BranchRoot != c.BranchRoot ||
		registered.ExpiresAt.Sub(registered.RegisteredAt) != 15*time.Minute {
		t.Fatal("registration did not preserve the original saved input fence and 15 minute lifetime")
	}
	if replay := sx5Register(t, c, first); !reflect.DeepEqual(replay, registered) {
		t.Fatal("registration replay changed the original receipt or its deadline")
	}
	changed := first
	changed.RunID = chatUUID()
	_, err := s.RegisterStoredChatGeneration(ctx, 1, c.ChatID, changed)
	expectChatCode(t, err, "IDEMPOTENCY_KEY_REUSED")
	reused := first
	reused.RequestID = chatUUID()
	_, err = s.RegisterStoredChatGeneration(ctx, 1, c.ChatID, reused)
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")

	second := sx5Registration(c, inputWrite.Revision, input)
	sx5Register(t, c, second)
	if replay := sx5Register(t, c, first); !reflect.DeepEqual(replay, registered) {
		t.Fatal("fenced registration did not return its original receipt")
	}
	oldTerminal := sx5Terminal(c, first.RunID, "settled")
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, oldTerminal)
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")

	// Source edits to the post-baseline tail still leave the original
	// prefix valid. Capturing the current boundary at registration would
	// falsely fence this terminal write.
	sx5Edit(t, c, tail, &tail.SelectedCandidateID, sx5Field([]string{"mes"}, "synthetic background", "synthetic later edit"))
	for _, state := range []string{"settled", "aborted"} {
		t.Run(state, func(t *testing.T) {
			if state == "aborted" {
				second = sx5Registration(c, sx5Page(t, c).Revision, input)
				sx5Register(t, c, second)
			}
			terminal := sx5Terminal(c, second.RunID, state)
			before := sx5Page(t, c)
			empty := terminal
			empty.Messages = nil
			_, err := s.AppendStoredMessages(t.Context(), 1, c.ChatID, empty)
			expectChatCode(t, err, "CHAT_INVALID_OPERATION")
			_, err = s.ApplyStoredChatOperations(t.Context(), 1, c.ChatID, ChatOperationsRequest{
				RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, Generation: terminal.Generation,
			})
			expectChatCode(t, err, "CHAT_INVALID_OPERATION")
			if after := sx5Page(t, c); after.Revision != before.Revision || len(after.Items) != len(before.Items) {
				t.Fatal("empty terminal request changed chat history")
			}
			firstWrite := sx5Append(t, c, terminal)
			if replay := sx5Append(t, c, terminal); !reflect.DeepEqual(replay, firstWrite) {
				t.Fatal("terminal write replay changed its receipt")
			}
			terminal.RequestID = chatUUID()
			_, err = s.AppendStoredMessages(t.Context(), 1, c.ChatID, terminal)
			expectChatCode(t, err, "CHAT_GENERATION_FENCED")
			after := sx5Page(t, c)
			if len(after.Items) != len(before.Items)+1 || after.Revision != before.Revision+1 {
				t.Fatal("run did not create exactly one terminal message")
			}
			output := after.Items[len(after.Items)-1]
			extra := asChatData(output.Candidates[0].Data["extra"])
			source := asChatData(extra["vc_source"])
			if output.MessageID != terminal.Messages[0].MessageID || source["settled"] != (state == "settled") {
				t.Fatal("terminal candidate did not preserve its settled or aborted evidence state")
			}
		})
	}
}

func TestStoredChatSX5GenerationRelevantChangesFence(t *testing.T) {
	for _, mutation := range []string{"input", "prefix source", "prefix selection", "metadata", "order"} {
		t.Run(mutation, func(t *testing.T) {
			c := storedChatFixture(t)
			s, ctx := testEnv.store, t.Context()
			sx5Append(t, c, sx5AppendRequest(c,
				ChatData{"mes": "synthetic prefix", "swipes": []string{"synthetic prefix", "synthetic alternate"}},
				ChatData{"mes": "synthetic input", "is_user": true, "extension": true},
			))
			page := sx5Page(t, c)
			prefix, input := page.Items[0], page.Items[1]
			in := sx5Registration(c, page.Revision, input)
			sx5Register(t, c, in)
			switch mutation {
			case "input":
				sx5Edit(t, c, input, nil, sx5Field([]string{"extension"}, true, false))
			case "prefix source":
				sx5Edit(t, c, prefix, &prefix.SelectedCandidateID, sx5Field([]string{"mes"}, "synthetic prefix", "synthetic change"))
			case "prefix selection":
				selectSwipe := sx5Swipe(t, prefix, "selectSwipe", prefix.Candidates[1].CandidateID)
				if _, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, selectSwipe)); err != nil {
					t.Fatal(err)
				}
			case "metadata":
				_, err := s.EditStoredChatMetadata(ctx, 1, c.ChatID, ChatMetadataEditRequest{
					RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, BaseRevision: page.MetadataRevision,
					Changes: []ChatFieldChange{sx5Field([]string{"title"}, c.Title, "synthetic change")},
				})
				if err != nil {
					t.Fatal(err)
				}
			case "order":
				reorder := sx5Reorder(t, page, prefix.MessageID, input.MessageID, input.MessageID, prefix.MessageID)
				if _, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, reorder)); err != nil {
					t.Fatal(err)
				}
			}
			before := sx5Page(t, c)
			_, err := s.RegisterStoredChatGeneration(ctx, 1, c.ChatID, sx5Registration(c, page.Revision, input))
			expectChatCode(t, err, "REVISION_CONFLICT")
			_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, sx5Terminal(c, in.RunID, "settled"))
			expectChatCode(t, err, "CHAT_GENERATION_FENCED")
			if after := sx5Page(t, c); after.Revision != before.Revision || len(after.Items) != len(before.Items) {
				t.Fatal("a fenced terminal write mutated history")
			}
		})
	}
}

func TestStoredChatSX5GenerationBindingAndRetention(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	inputWrite := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic input", "is_user": true}))
	in := sx5Registration(c, inputWrite.Revision, inputWrite.Changed[0])
	original := sx5Register(t, c, in)
	for _, owner := range []int64{1, 2} {
		group := "synthetic-group"
		other, err := s.CreateStoredChat(ctx, owner, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, Kind: "GROUP", GroupRef: &group})
		if err != nil {
			t.Fatalf("create independent target chat: %v", err)
		}
		_, err = s.AppendStoredMessages(ctx, owner, other.ChatID, sx5Terminal(other, in.RunID, "settled"))
		expectChatCode(t, err, "CHAT_GENERATION_FENCED")
	}
	_, err := s.AppendStoredMessages(ctx, 1, c.ChatID, sx5Terminal(c, chatUUID(), "settled"))
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")

	// The isolated clock fixture ages the only run without sleeping or
	// changing the receipt's independent seven-day retention window.
	if _, err := psqlSuper(`UPDATE vc.chat_generation_run SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, sx5Terminal(c, in.RunID, "aborted"))
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")
	if err = s.PruneStoredChatRuns(ctx); err != nil {
		t.Fatalf("prune expired run: %v", err)
	}
	assertRetention := func(cleared bool) {
		t.Helper()
		if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
			var expired, fenceCleared, receiptCleared, compact bool
			err := tx.QueryRow(ctx, `SELECT r.state='expired',r.fence IS NULL,p.result_cipher IS NULL,
 octet_length(p.request_digest)>0 AND p.operation_id IS NOT NULL AND p.status=201
 FROM vc.chat_generation_run r JOIN vc.chat_receipt p USING (owner_user_id,chat_id,request_id)
 WHERE r.owner_user_id=1 AND r.chat_id=$1 AND r.run_id=$2 AND r.request_id=$3`, c.ChatID, in.RunID, in.RequestID).
				Scan(&expired, &fenceCleared, &receiptCleared, &compact)
			if err == nil && (!expired || fenceCleared != cleared || receiptCleared != cleared || !compact) {
				t.Error("expiry or seven-day compaction lost the expected run/receipt state")
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	assertRetention(false)
	if replay := sx5Register(t, c, in); !reflect.DeepEqual(replay, original) {
		t.Fatal("expired registration replay changed its original receipt")
	}
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, sx5Terminal(c, in.RunID, "settled"))
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")
	if _, err = psqlSuper(`UPDATE vc.chat_generation_run SET registered_at=clock_timestamp()-interval '8 days' WHERE owner_user_id=1;
 UPDATE vc.chat_receipt SET expires_at=clock_timestamp()-interval '1 day' WHERE owner_user_id=1 AND status=201`); err != nil {
		t.Fatal(err)
	}
	if err = s.PruneStoredChatRuns(ctx); err != nil {
		t.Fatalf("prune retained fence detail: %v", err)
	}
	assertRetention(true)
	_, err = s.RegisterStoredChatGeneration(ctx, 1, c.ChatID, in)
	expectChatCode(t, err, "OPERATION_RESULT_EXPIRED")
	in.RequestID = chatUUID()
	_, err = s.RegisterStoredChatGeneration(ctx, 1, c.ChatID, in)
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")
	if after := sx5Page(t, c); after.Revision != inputWrite.Revision || len(after.Items) != 1 {
		t.Fatal("rejected binding or expired run changed history")
	}
}
