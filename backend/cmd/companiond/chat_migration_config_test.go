package main

import (
	"strings"
	"testing"
)

func migrationEnv() map[string]string {
	return map[string]string{
		"VC_WORKER_DB_DSN":           "postgres://synthetic-worker@127.0.0.1/isolated",
		"VC_OWNER_BINDING_SECRET":    strings.Repeat("b", 32),
		"VC_CRYPTO_REST_KEY":         strings.Repeat("k", 44),
		"VC_ST_PLUGIN_SERVICE_TOKEN": strings.Repeat("t", 32),
		"VC_ST_HOST_BASE_URL":        "http://127.0.0.1:18080",
		"VC_EXPORT_S3_ENDPOINT":      "http://127.0.0.1:19000",
		"VC_EXPORT_S3_ACCESS_KEY":    "synthetic",
		"VC_EXPORT_S3_SECRET_KEY":    "synthetic-secret",
		"VC_EXPORT_S3_BUCKET":        "isolated",
	}
}
func migrationArgs(operation string) []string {
	return []string{operation, "--synthetic-isolated", "--owner", "101", "--run", "10000000-0000-4000-8000-000000000001", "--expected-epoch", "1", "--st-root", "/synthetic/st", "--artifact-root", "/synthetic/artifacts", "--snapshot-tool", "/synthetic/tool.mjs", "--account-handle", "synthetic"}
}

func TestMigrationConfigUsesControlledWorkerOwnerAndDefaultsToVerify(t *testing.T) {
	env := migrationEnv()
	c, err := chatMigrationConfig(migrationArgs("forward"), func(k string) string { return env[k] })
	if err != nil || c.Owner != 101 || c.Activate || c.Direction != "ST_TO_GO" || c.AccountHandles["101"] != "synthetic" {
		t.Fatalf("config: %+v %v", c.Config, err)
	}
	delete(env, "VC_WORKER_DB_DSN")
	env["VC_DB_DSN"] = "postgres://public-role"
	if _, err := chatMigrationConfig(migrationArgs("forward"), func(k string) string { return env[k] }); err == nil {
		t.Fatal("public database role authorized migration")
	}
}

func TestMigrationConfigRejectsMissingScopeAndInvalidParameters(t *testing.T) {
	for _, args := range [][]string{
		{"forward"},
		append(migrationArgs("forward"), "--owner", "0"),
		append(migrationArgs("forward"), "--run", "invalid"),
		append(migrationArgs("forward"), "--character-directories", "[]"),
		append(migrationArgs("forward"), "--unexpected-secret", "private"),
	} {
		env := migrationEnv()
		if _, err := chatMigrationConfig(args, func(k string) string { return env[k] }); err == nil || strings.Contains(err.Error(), "private") {
			t.Fatal("invalid scope accepted or error leaked")
		}
	}
}

func TestReverseAndFinalizeDoNotRequireUnrelatedSTOrObjectCredentials(t *testing.T) {
	for _, op := range []string{"reverse", "finalize"} {
		env := map[string]string{"VC_WORKER_DB_DSN": "postgres://synthetic", "VC_OWNER_BINDING_SECRET": strings.Repeat("b", 32)}
		if op == "reverse" {
			env["VC_CRYPTO_REST_KEY"] = "synthetic-key"
		}
		if _, err := chatMigrationConfig(migrationArgs(op), func(k string) string { return env[k] }); err != nil {
			t.Fatal(op, err)
		}
	}
}
