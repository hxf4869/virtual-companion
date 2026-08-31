package auth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type cryptoVectors struct {
	Bcrypt struct {
		Password string `json:"password"`
		GoHash   string `json:"goHash"`
		LegacyHash string `json:"legacyHash"`
	} `json:"bcrypt"`
}

func loadCryptoVectors(t *testing.T) cryptoVectors {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	dir := filepath.Dir(file)
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			raw, err := os.ReadFile(filepath.Join(dir, "contracttest", "testdata", "crypto-vectors.json"))
			if err != nil {
				t.Fatal(err)
			}
			var v cryptoVectors
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatal(err)
			}
			return v
		}
		dir = filepath.Dir(dir)
	}
	t.Fatal("backend root not found")
	return cryptoVectors{}
}
