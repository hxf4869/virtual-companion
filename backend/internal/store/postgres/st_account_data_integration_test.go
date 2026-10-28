//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type testSTData struct {
	unavailable      bool
	deletes, exports int
	owners           []int64
}

func (d *testSTData) Export(_ context.Context, owner int64) (stsource.AccountExport, error) {
	d.exports++
	d.owners = append(d.owners, owner)
	if d.unavailable {
		return stsource.AccountExport{}, stsource.ErrUnavailable
	}
	return stsource.AccountExport{OwnerAccountID: strconv.FormatInt(owner, 10), Handle: "synthetic-owner", State: "COMPLETE", Snapshot: "PER_FILE", Files: []stsource.ExportFile{}}, nil
}
func (d *testSTData) Delete(_ context.Context, owner int64, handle string) (stsource.AccountDeletion, error) {
	d.deletes++
	d.owners = append(d.owners, owner)
	if d.unavailable {
		return stsource.AccountDeletion{}, stsource.ErrUnavailable
	}
	return stsource.AccountDeletion{OwnerAccountID: strconv.FormatInt(owner, 10), Handle: "synthetic-owner", State: "DELETED"}, nil
}
func rightsFixture(t *testing.T) (*Store, *testSTData) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(), `TRUNCATE vc.account_deletion_intent`); err != nil {
		t.Fatal(err)
	}
	store := resetCatalogFixtures(t)
	data := &testSTData{}
	store.UseSTDataClient(data)
	t.Cleanup(func() {
		store.UseSTSourceReader(nil)
		store.UseSTDataClient(nil)
		store.UseCipher(nil)
		if err := IsolationSuperExec(context.Background(), `TRUNCATE vc.account_deletion_intent`); err != nil {
			t.Error(err)
		}
	})
	return store, data
}
func TestSTAccountDeletionRemainsPendingAndResumesIdempotently(t *testing.T) {
	store, data := rightsFixture(t)
	ctx := context.Background()
	data.unavailable = true
	relation, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	owners, err := store.ListPendingAccountDeletions(ctx)
	if err != nil || len(owners) != 1 || owners[0] != 1 {
		t.Fatalf("pending owners=%v err=%v", owners, err)
	}
	if done, err := store.ClearSTAccountData(ctx, 1); err != nil || done {
		t.Fatalf("unavailable ST cleanup=%v %v", done, err)
	}
	if err := store.DeleteAccount(ctx, 1); err == nil {
		t.Fatal("cascade bypassed pending external cleanup")
	}
	if _, found, err := store.LookupIdentity(ctx, "owner"); err != nil || !found {
		t.Fatal("account disappeared while cleanup was pending")
	}
	if _, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: relation.ID, Scope: "RELATIONSHIP", Summary: "late source"}); err == nil {
		t.Fatal("deletion intent allowed a late memory write")
	}
	data.unavailable = false
	if done, err := store.ClearSTAccountData(ctx, 1); err != nil || !done {
		t.Fatalf("resumed ST cleanup=%v %v", done, err)
	}
	if err := store.DeleteAccount(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteAccount(ctx, 1); err != nil {
		t.Fatalf("replayed completion=%v", err)
	}
	owners, err = store.ListPendingAccountDeletions(ctx)
	if err != nil || len(owners) != 0 {
		t.Fatal("completed account remained pending")
	}
	if _, found, err := store.LookupIdentity(ctx, "disabled"); err != nil || !found {
		t.Fatal("another account was removed")
	}
	if data.deletes != 2 {
		t.Fatalf("external deletion calls=%d", data.deletes)
	}
}
func TestSTOwnerExportDecryptsSourcesAndKeepsExternalFailureVisible(t *testing.T) {
	store, data := rightsFixture(t)
	ctx := context.Background()
	binding, err := store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "export-card", Mode: "COMPANION", DisplayName: "合成角色"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveSTBinding(ctx, 2, STBindingInput{ChatIdentity: "10000000-0000-0000-0000-000000000002", CharacterRef: "FOREIGN_PRIVATE_CARD", Mode: "COMPANION"}); err != nil {
		t.Fatal(err)
	}
	snapshot := stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/card/current.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我喜欢乌龙茶", Eligible: true, Settled: true}}}
	store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, q []stsource.Query) ([]stsource.Snapshot, error) {
		if owner != 1 || len(q) != 1 || q[0].ChatIdentity != sourceChat {
			t.Error("export read another owner's source")
		}
		return []stsource.Snapshot{snapshot}, nil
	}))
	if _, err := store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	acceptedSourceMemory(t, binding, currentSourceRef(t))
	exported, err := store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(exported)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "我喜欢乌龙茶") || strings.Contains(string(raw), "enc2:") || strings.Contains(string(raw), "FOREIGN_PRIVATE_CARD") {
		t.Fatal("export omitted/decrypted the wrong source or crossed owner scope")
	}
	if len(exported.Go["bindings"].([]any)) != 1 || len(exported.Go["sources"].([]any)) != 1 || len(exported.Go["evidence"].([]any)) != 1 {
		t.Fatal("export manifest omitted bindings/source/evidence")
	}
	data.unavailable = true
	if _, err := store.ExportV2OwnerData(ctx, 1); !errors.Is(err, stsource.ErrUnavailable) {
		t.Fatalf("incomplete export was not reported unavailable: %v", err)
	}
}

func TestSTProfileWithoutChatRetainsDataRightsScopeAfterConfigurationLoss(t *testing.T) {
	store, data := rightsFixture(t)
	ctx := context.Background()
	if err := store.RegisterSTProfile(ctx, 1, "synthetic-owner"); err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterSTProfile(ctx, 1, "synthetic-owner"); err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterSTProfile(ctx, 1, "another-profile"); err == nil {
		t.Fatal("registered profile was silently rebound")
	}
	store.UseSTDataClient(nil) // process restart with the private ST channel missing
	if _, err := store.ExportV2OwnerData(ctx, 1); !errors.Is(err, stsource.ErrUnavailable) {
		t.Fatalf("profile without chats was omitted from the export scope: %v", err)
	}
	if err := store.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if done, err := store.ClearSTAccountData(ctx, 1); err != nil || done {
		t.Fatal("profile without chats was treated as having no ST data")
	}
	if err := store.DeleteAccount(ctx, 1); err == nil {
		t.Fatal("profile scope was bypassed by a direct cascade")
	}
	store.UseSTDataClient(data)
	if done, err := store.ClearSTAccountData(ctx, 1); err != nil || !done {
		t.Fatal("restored channel could not resume the captured profile")
	}
	if err := store.DeleteAccount(ctx, 1); err != nil {
		t.Fatal(err)
	}
}
