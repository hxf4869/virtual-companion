package main

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestMigrationConfigCurrentAndPreviousKeys(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("c", 32)))
	oldKey := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("p", 32)))
	env := map[string]string{"VC_MIGRATE_DB_DSN": "synthetic", "VC_CRYPTO_REST_KEY": key, "VC_CRYPTO_REST_KEY_ID": "current", "VC_CRYPTO_REST_KEY_VERSION": "2", "VC_CRYPTO_PREVIOUS_REST_KEY": oldKey, "VC_CRYPTO_PREVIOUS_REST_KEY_ID": "previous", "VC_CRYPTO_PREVIOUS_REST_KEY_VERSION": "1"}
	cfg, err := migrationConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	for _, slot := range []struct {
		id      string
		version int
		key     string
	}{{"current", 2, key}, {"previous", 1, oldKey}} {
		cipher, err := postgres.NewFieldCipher(slot.id, slot.version, slot.key)
		if err != nil {
			t.Fatal(err)
		}
		stored, err := cipher.Encrypt("synthetic memory")
		if err != nil {
			t.Fatal(err)
		}
		got, err := cfg.DecryptMemory(stored)
		if err != nil || got != "synthetic memory" {
			t.Fatalf("slot %s decode failed: %v", slot.id, err)
		}
		if slot.id == "previous" {
			got, err = cfg.DecryptMemory("enc1:" + strings.SplitN(stored, ":", 4)[3])
			if err != nil || got != "synthetic memory" {
				t.Fatal("legacy key not wired")
			}
		}
	}
	env["VC_CRYPTO_REST_KEY_VERSION"] = "invalid"
	if _, err := migrationConfig(func(k string) string { return env[k] }); err == nil {
		t.Fatal("invalid version accepted")
	}
}

func TestMigrationConfigEmptyDatabaseNeedsNoKeys(t *testing.T) {
	cfg, err := migrationConfig(func(k string) string {
		if k == "VC_MIGRATE_DB_DSN" {
			return "synthetic"
		}
		return ""
	})
	if err != nil || cfg.DecryptMemory != nil {
		t.Fatalf("no-key config: %v", err)
	}
}
