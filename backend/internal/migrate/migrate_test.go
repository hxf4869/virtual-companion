package migrate

import "testing"

func TestLoadEnvRequiresDSN(t *testing.T) {
	if _, err := LoadEnv(func(string) string { return "" }); err == nil {
		t.Fatal("expected missing migration DSN to fail")
	}
}

func TestEmbeddedMigrationsAreOrderedAndComplete(t *testing.T) {
	items, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 121 {
		t.Fatalf("migration count = %d, want 121", len(items))
	}
	for i, item := range items {
		want := int64(i + 1)
		if item.Version != want {
			t.Fatalf("migration[%d].Version = %d, want %d", i, item.Version, want)
		}
	}
	if items[len(items)-1].File != "V121__atomic_password_and_session_revoke.sql" {
		t.Fatalf("latest migration = %q", items[len(items)-1].File)
	}
}
