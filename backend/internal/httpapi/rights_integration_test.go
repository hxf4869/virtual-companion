//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestG8IsolationMemoryConsentExportAccount(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)

	relRec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if relRec.Code != http.StatusOK {
		t.Fatalf("rel %d %s", relRec.Code, relRec.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(relRec.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	candPath := fmt.Sprintf("/api/v1/relationships/%d/memories/candidates", rel.RelationshipID)
	created := doJSON(t, s, http.MethodPost, candPath, `{"scope":"RELATIONSHIP","summary":"fixture-canonical-fact"}`, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("candidate %d %s", created.Code, created.Body.String())
	}
	if strings.Contains(created.Body.String(), "enc2:") {
		t.Fatal("ciphertext leaked")
	}
	var mem memoryJSON
	if err := json.Unmarshal(created.Body.Bytes(), &mem); err != nil {
		t.Fatal(err)
	}
	if mem.Status != "PENDING_CONFIRMATION" || mem.AutoSaved {
		t.Fatalf("%+v", mem)
	}
	foreign := doJSON(t, s, http.MethodGet, "/api/v1/memories/"+mem.MemoryID, "", 2)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("cross-owner get %d %s", foreign.Code, foreign.Body.String())
	}
	assertEnvelope(t, foreign, "NOT_FOUND_OR_FORBIDDEN")

	confirm := doJSON(t, s, http.MethodPost, "/api/v1/memories/"+mem.MemoryID+"/confirm", "", 1)
	if confirm.Code != http.StatusOK {
		t.Fatalf("confirm %d %s", confirm.Code, confirm.Body.String())
	}
	list := doJSON(t, s, http.MethodGet, fmt.Sprintf("/api/v1/relationships/%d/memories", rel.RelationshipID), "", 1)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"status":"ACCEPTED"`) {
		t.Fatalf("list %s", list.Body.String())
	}

	conv := doJSON(t, s, http.MethodPost, "/api/v1/conversations", fmt.Sprintf(`{"relationshipId":%d,"incognito":true}`, rel.RelationshipID), 1)
	if conv.Code != http.StatusOK {
		t.Fatalf("incognito conv %d %s", conv.Code, conv.Body.String())
	}
	var convBody struct {
		ConversationID int64 `json:"conversationId"`
	}
	_ = json.Unmarshal(conv.Body.Bytes(), &convBody)
	session := doJSON(t, s, http.MethodPost, candPath,
		fmt.Sprintf(`{"scope":"SESSION","summary":"incognito-fact","conversationId":%d}`, convBody.ConversationID), 1)
	if session.Code != http.StatusBadRequest {
		t.Fatalf("incognito candidate %d %s", session.Code, session.Body.String())
	}

	for _, typ := range []string{
		"SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE",
		"THIRD_PARTY_MODEL_PROCESSING", "SENSITIVE_DATA_PROCESSING",
	} {
		body := fmt.Sprintf(`{"consentType":%q,"version":"2026-08","granted":true}`, typ)
		rec := doJSON(t, s, http.MethodPut, "/api/v1/consents", body, 1)
		if rec.Code != http.StatusOK {
			t.Fatalf("grant %s %d %s", typ, rec.Code, rec.Body.String())
		}
	}
	gate, err := store.OutboundCheck(context.Background(), 1)
	if err != nil || !gate.Allow {
		t.Fatalf("outbound after grant %+v %v", gate, err)
	}
	withdraw := doJSON(t, s, http.MethodPut, "/api/v1/consents",
		`{"consentType":"THIRD_PARTY_MODEL_PROCESSING","version":"2026-08","granted":false,"currentPassword":"`+testPassword+`"}`, 1)
	if withdraw.Code != http.StatusOK {
		t.Fatalf("withdraw %d %s", withdraw.Code, withdraw.Body.String())
	}
	gate, err = store.OutboundCheck(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if gate.Allow || len(gate.Categories) != 0 || gate.Code != "CONSENT_WITHDRAWN" {
		t.Fatalf("outbound after withdraw %+v", gate)
	}

	exp := doJSON(t, s, http.MethodPost, "/api/v1/exports", `{"currentPassword":"`+testPassword+`"}`, 1)
	if exp.Code != http.StatusOK {
		t.Fatalf("export %d %s", exp.Code, exp.Body.String())
	}
	var export exportJSON
	if err := json.Unmarshal(exp.Body.Bytes(), &export); err != nil {
		t.Fatal(err)
	}
	if export.DownloadToken == nil {
		t.Fatal("missing download token")
	}
	exportID := mustParseID(t, export.ExportID)
	payload := `{"exportId":"1","generatedAt":"2026-01-01T00:00:00Z","expiresAt":"2026-01-02T00:00:00Z","aiContentNotice":"n","conversations":[],"memories":[],"reminders":[],"consents":[]}`
	if err := store.CompleteExport(context.Background(), 1, exportID, payload, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	dl := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+export.ExportID+"/download?token="+*export.DownloadToken, "", 1)
	if dl.Code != http.StatusOK {
		t.Fatalf("download %d %s", dl.Code, dl.Body.String())
	}
	if strings.Contains(dl.Body.String(), "enc2:") {
		t.Fatal("export ciphertext leaked")
	}
	again := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+export.ExportID+"/download?token="+*export.DownloadToken, "", 1)
	if again.Code != http.StatusNotFound {
		t.Fatalf("second download %d", again.Code)
	}

	del := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if del.Code != http.StatusOK {
		t.Fatalf("account delete %d %s", del.Code, del.Body.String())
	}
	_, known, err := store.LookupIdentity(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if known {
		t.Fatal("identity survived account delete")
	}
}

func TestG8IsolationDeleteIntentBlocksLateWriter(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)

	relRec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	var rel relationshipJSON
	_ = json.Unmarshal(relRec.Body.Bytes(), &rel)
	if err := store.RequestAccountDeletion(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	late := doJSON(t, s, http.MethodPost,
		fmt.Sprintf("/api/v1/relationships/%d/memories/candidates", rel.RelationshipID),
		`{"scope":"RELATIONSHIP","summary":"late-write"}`, 1)
	if late.Code != http.StatusNotFound {
		t.Fatalf("late memory %d %s", late.Code, late.Body.String())
	}
	assertEnvelope(t, late, "NOT_FOUND_OR_FORBIDDEN")
	exp := doJSON(t, s, http.MethodPost, "/api/v1/exports", `{"currentPassword":"`+testPassword+`"}`, 1)
	if exp.Code != http.StatusNotFound && exp.Code != http.StatusBadRequest {
		t.Fatalf("late export %d %s", exp.Code, exp.Body.String())
	}
	gate, err := store.OutboundCheck(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if gate.Allow || len(gate.Categories) != 0 {
		t.Fatalf("outbound during deletion %+v", gate)
	}
}

func TestG8IsolationExportObjectLifecycleVsDelete(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	blobs := newMemBlob()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)
	s.core.Blobs = blobs

	for _, typ := range []string{
		"SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE",
		"THIRD_PARTY_MODEL_PROCESSING", "SENSITIVE_DATA_PROCESSING",
	} {
		rec := doJSON(t, s, http.MethodPut, "/api/v1/consents",
			fmt.Sprintf(`{"consentType":%q,"version":"2026-08","granted":true}`, typ), 1)
		if rec.Code != http.StatusOK {
			t.Fatalf("grant %s %d", typ, rec.Code)
		}
	}
	exp := doJSON(t, s, http.MethodPost, "/api/v1/exports", `{"currentPassword":"`+testPassword+`"}`, 1)
	if exp.Code != http.StatusOK {
		t.Fatalf("export %d %s", exp.Code, exp.Body.String())
	}
	var export exportJSON
	_ = json.Unmarshal(exp.Body.Bytes(), &export)
	exportID := mustParseID(t, export.ExportID)
	key := fmt.Sprintf("exports/1/%d-0123456789abcdef.json", exportID)
	doc := []byte(`{"exportId":"1","conversations":[]}`)
	if err := blobs.Put(context.Background(), key, doc); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordExportUploadIntent(context.Background(), 1, exportID, key, 30); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteExportObject(context.Background(), 1, exportID, key, int64(len(doc)), time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestAccountDeletion(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	lateSeal := store.CompleteExportObject(context.Background(), 1, exportID, key+"-late", 1, time.Now().UTC().Add(time.Hour))
	if lateSeal == nil {
		t.Fatal("late seal after intent must fail")
	}
	del := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if del.Code != http.StatusOK {
		t.Fatalf("delete with objects %d %s", del.Code, del.Body.String())
	}
	if _, err := blobs.Get(context.Background(), key); err == nil {
		t.Fatal("object survived account delete")
	}
}
