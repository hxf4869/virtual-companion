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
	if len(items) != 148 {
		t.Fatalf("migration count = %d, want 148", len(items))
	}
	// Versions must be strictly ascending.
	for i := 1; i < len(items); i++ {
		if items[i].Version <= items[i-1].Version {
			t.Fatalf("migration[%d].Version = %d not after %d", i, items[i].Version, items[i-1].Version)
		}
	}
	if items[len(items)-1].File != "V148__memorycore_model_calls.sql" {
		t.Fatalf("latest migration = %q", items[len(items)-1].File)
	}
}
