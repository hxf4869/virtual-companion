//go:build integration

package postgres

import (
	"context"
	"testing"
)

func TestFavoritesAndDiaryAreExportedAndClearedWithTheRelationship(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	installRightsEngine(t, testEnv.store)
	if _, err := testEnv.store.CreateFavorite(ctx, 1, 10, FavoriteWrite{ChatFile: "a.jsonl", MesID: 2, Role: "character", Body: "晚安"}); err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.SaveDiaryEntry(ctx, 1, 10, "2026-11-02", "今天很安静。", "开心", []string{"晚霞"}); err != nil {
		t.Fatal(err)
	}
	exported, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if goArrayLen(exported.Go["favorites"]) != 1 || goArrayLen(exported.Go["diaryEntries"]) != 1 {
		t.Fatalf("export go domain = favorites %d, diary %d", goArrayLen(exported.Go["favorites"]), goArrayLen(exported.Go["diaryEntries"]))
	}
	if _, err := testEnv.store.ResetRelationship(ctx, 1, 10, false); err != nil {
		t.Fatal(err)
	}
	after, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if goArrayLen(after.Go["favorites"]) != 0 || goArrayLen(after.Go["diaryEntries"]) != 0 {
		t.Fatal("relationship reset left favorites or diary pages")
	}
}
