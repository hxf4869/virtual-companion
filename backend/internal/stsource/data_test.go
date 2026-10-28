package stsource

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// Fixtures are synthetic loopback servers with generated payloads and one
// fixed service token; no real chat content, handles or credentials.
var dataTestToken = strings.Repeat("t", 32)

const (
	dataExportPath = "/internal/v1/st/data/export"
	dataDeletePath = "/internal/v1/st/data/delete"
)

type dataRequest struct {
	method, path, auth, contentType, body string
}

type dataRecorder struct {
	mu       sync.Mutex
	requests []dataRequest
}

func (r *dataRecorder) add(req dataRequest) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, req)
}

func (r *dataRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.requests)
}

func (r *dataRecorder) single(t *testing.T) dataRequest {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.requests) != 1 {
		t.Fatalf("recorded %d requests, want exactly 1", len(r.requests))
	}
	return r.requests[0]
}

func newDataTestServer(t *testing.T, respond func(w http.ResponseWriter)) (*httptest.Server, *dataRecorder) {
	t.Helper()
	rec := &dataRecorder{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		rec.add(dataRequest{
			method:      r.Method,
			path:        r.URL.Path,
			auth:        r.Header.Get("Authorization"),
			contentType: r.Header.Get("Content-Type"),
			body:        string(raw),
		})
		respond(w)
	}))
	t.Cleanup(server.Close)
	return server, rec
}

func newDataTestClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := NewClient(server.URL, dataTestToken)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func dataWriteJSON(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(body)
}

func dataValidExportBody() map[string]any {
	return map[string]any{
		"ownerAccountId": "12345",
		"handle":         "owner-handle",
		"state":          "COMPLETE",
		"snapshot":       "PER_FILE",
		"startedAt":      "2026-10-28T10:00:00Z",
		"completedAt":    "2026-10-28T10:05:00Z",
		"fileCount":      2,
		"bytes":          int64(7),
		"files": []map[string]any{
			{
				"path":       "chats/synthetic-a.jsonl",
				"encoding":   "base64",
				"data":       "c3lu",
				"bytes":      int64(3),
				"capturedAt": "2026-10-28T10:01:00Z",
				"modifiedAt": "2026-10-28T10:01:30Z",
			},
			{
				"path":       "chats/synthetic-b.jsonl",
				"encoding":   "base64",
				"data":       "c3luMg==",
				"bytes":      int64(4),
				"capturedAt": "2026-10-28T10:02:00Z",
				"modifiedAt": "2026-10-28T10:02:30Z",
			},
		},
		"exclusions": []string{"worlds/scratch"},
	}
}

func dataValidDeleteBody() map[string]any {
	return map[string]any{
		"ownerAccountId": "12345",
		"handle":         "owner-handle",
		"state":          "DELETED",
	}
}

func TestExportRequestContractAndResultReadback(t *testing.T) {
	server, rec := newDataTestServer(t, func(w http.ResponseWriter) {
		dataWriteJSON(w, http.StatusOK, dataValidExportBody())
	})
	client := newDataTestClient(t, server)
	export, err := client.Export(context.Background(), 12345)
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	req := rec.single(t)
	if req.method != http.MethodPost {
		t.Errorf("method = %q, want POST", req.method)
	}
	if req.path != dataExportPath {
		t.Errorf("path = %q, want exactly %q", req.path, dataExportPath)
	}
	if req.auth != "Bearer "+dataTestToken {
		t.Errorf("Authorization = %q, want Bearer service token", req.auth)
	}
	if req.contentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", req.contentType)
	}
	if !strings.Contains(req.body, `"ownerAccountId":"12345"`) {
		t.Errorf(`request body %q lacks exact substring "ownerAccountId":"12345"`, req.body)
	}
	var decoded map[string]string
	if err := json.Unmarshal([]byte(req.body), &decoded); err != nil {
		t.Fatalf("decode export request body: %v", err)
	}
	if !reflect.DeepEqual(decoded, map[string]string{"ownerAccountId": "12345"}) {
		t.Errorf("request body decodes to %#v, want only ownerAccountId 12345", decoded)
	}
	if export.OwnerAccountID != "12345" || export.Handle != "owner-handle" || export.State != "COMPLETE" || export.Snapshot != "PER_FILE" || export.FileCount != 2 || export.FileCount != len(export.Files) {
		t.Fatalf("export readback = %+v", export)
	}
	wantFiles := []ExportFile{
		{Path: "chats/synthetic-a.jsonl", Encoding: "base64", Data: "c3lu", Bytes: 3, CapturedAt: "2026-10-28T10:01:00Z", ModifiedAt: "2026-10-28T10:01:30Z"},
		{Path: "chats/synthetic-b.jsonl", Encoding: "base64", Data: "c3luMg==", Bytes: 4, CapturedAt: "2026-10-28T10:02:00Z", ModifiedAt: "2026-10-28T10:02:30Z"},
	}
	if !reflect.DeepEqual(export.Files, wantFiles) {
		t.Errorf("files = %+v, want %+v", export.Files, wantFiles)
	}
}

func TestExportRejectsMalformedResponses(t *testing.T) {
	cases := []struct {
		name   string
		status int
		raw    string
		mutate func(map[string]any)
	}{
		{name: "http 500", status: http.StatusInternalServerError},
		{name: "http 403", status: http.StatusForbidden},
		{name: "invalid json body", raw: "{"},
		{name: "json array shape", raw: "[]"},
		{name: "wrong owner account", mutate: func(b map[string]any) { b["ownerAccountId"] = "54321" }},
		{name: "file count mismatch", mutate: func(b map[string]any) { b["fileCount"] = 3 }},
		{name: "missing files", mutate: func(b map[string]any) { delete(b, "files") }},
		{name: "state partial", mutate: func(b map[string]any) { b["state"] = "PARTIAL" }},
		{name: "single snapshot", mutate: func(b map[string]any) { b["snapshot"] = "SINGLE" }},
		{name: "empty handle", mutate: func(b map[string]any) { b["handle"] = "" }},
		{name: "empty startedAt", mutate: func(b map[string]any) { b["startedAt"] = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := newDataTestServer(t, func(w http.ResponseWriter) {
				if tc.raw != "" {
					_, _ = w.Write([]byte(tc.raw))
					return
				}
				body := dataValidExportBody()
				if tc.mutate != nil {
					tc.mutate(body)
				}
				status := tc.status
				if status == 0 {
					status = http.StatusOK
				}
				dataWriteJSON(w, status, body)
			})
			client := newDataTestClient(t, server)
			if _, err := client.Export(context.Background(), 12345); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("Export err = %v, want ErrUnavailable", err)
			}
		})
	}
}

func TestExportRejectsNonPositiveOwnerWithoutRequest(t *testing.T) {
	server, rec := newDataTestServer(t, func(w http.ResponseWriter) {
		dataWriteJSON(w, http.StatusOK, dataValidExportBody())
	})
	client := newDataTestClient(t, server)
	for _, owner := range []int64{0, -1} {
		t.Run("owner "+strconv.FormatInt(owner, 10), func(t *testing.T) {
			if _, err := client.Export(context.Background(), owner); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("Export(%d) err = %v, want ErrUnavailable", owner, err)
			}
		})
	}
	if n := rec.count(); n != 0 {
		t.Errorf("server received %d requests, want 0", n)
	}
}

func TestDeleteRequestContractAndResultReadback(t *testing.T) {
	serve := func(t *testing.T) (*httptest.Server, *dataRecorder) {
		return newDataTestServer(t, func(w http.ResponseWriter) {
			dataWriteJSON(w, http.StatusOK, dataValidDeleteBody())
		})
	}
	t.Run("matching expected handle", func(t *testing.T) {
		server, rec := serve(t)
		client := newDataTestClient(t, server)
		deletion, err := client.Delete(context.Background(), 12345, "owner-handle")
		if err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if deletion.OwnerAccountID != "12345" || deletion.Handle != "owner-handle" || deletion.State != "DELETED" {
			t.Errorf("deletion readback = %+v", deletion)
		}
		req := rec.single(t)
		if req.path != dataDeletePath {
			t.Errorf("path = %q, want exactly %q", req.path, dataDeletePath)
		}
		if req.auth != "Bearer "+dataTestToken {
			t.Errorf("Authorization = %q, want Bearer service token", req.auth)
		}
		var decoded map[string]string
		if err := json.Unmarshal([]byte(req.body), &decoded); err != nil {
			t.Fatalf("decode delete request body: %v", err)
		}
		if !reflect.DeepEqual(decoded, map[string]string{"ownerAccountId": "12345", "expectedHandle": "owner-handle"}) {
			t.Errorf("request body decodes to %#v, want ownerAccountId and expectedHandle", decoded)
		}
	})
	t.Run("empty expected handle skips equality check", func(t *testing.T) {
		server, _ := serve(t)
		client := newDataTestClient(t, server)
		deletion, err := client.Delete(context.Background(), 12345, "")
		if err != nil {
			t.Fatalf("Delete with empty expected handle: %v", err)
		}
		if deletion.OwnerAccountID != "12345" || deletion.Handle != "owner-handle" || deletion.State != "DELETED" {
			t.Errorf("deletion readback = %+v", deletion)
		}
	})
}

func TestDeleteRejectsMalformedResponses(t *testing.T) {
	cases := []struct {
		name   string
		status int
		raw    string
		mutate func(map[string]any)
	}{
		{name: "handle mismatch", mutate: func(b map[string]any) { b["handle"] = "other-handle" }},
		{name: "state deleting", mutate: func(b map[string]any) { b["state"] = "DELETING" }},
		{name: "wrong owner account", mutate: func(b map[string]any) { b["ownerAccountId"] = "54321" }},
		{name: "http 500", status: http.StatusInternalServerError},
		{name: "invalid json body", raw: "{"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := newDataTestServer(t, func(w http.ResponseWriter) {
				if tc.raw != "" {
					_, _ = w.Write([]byte(tc.raw))
					return
				}
				body := dataValidDeleteBody()
				if tc.mutate != nil {
					tc.mutate(body)
				}
				status := tc.status
				if status == 0 {
					status = http.StatusOK
				}
				dataWriteJSON(w, status, body)
			})
			client := newDataTestClient(t, server)
			if _, err := client.Delete(context.Background(), 12345, "owner-handle"); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("Delete err = %v, want ErrUnavailable", err)
			}
		})
	}
}

func TestDataClientDoesNotFollowRedirects(t *testing.T) {
	run := func(t *testing.T, call func(*Client) error) {
		var sourceHits, sinkHits atomic.Int32
		mux := http.NewServeMux()
		redirect := func(w http.ResponseWriter, r *http.Request) {
			sourceHits.Add(1)
			http.Redirect(w, r, "/data-redirect-sink", http.StatusFound)
		}
		mux.HandleFunc(dataExportPath, redirect)
		mux.HandleFunc(dataDeletePath, redirect)
		mux.HandleFunc("/data-redirect-sink", func(w http.ResponseWriter, r *http.Request) {
			sinkHits.Add(1)
		})
		server := httptest.NewServer(mux)
		t.Cleanup(server.Close)
		client := newDataTestClient(t, server)
		if err := call(client); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
		if sourceHits.Load() != 1 {
			t.Errorf("source endpoint hit %d times, want exactly 1", sourceHits.Load())
		}
		if sinkHits.Load() != 0 {
			t.Errorf("redirect target hit %d times, want 0", sinkHits.Load())
		}
	}
	t.Run("export", func(t *testing.T) {
		run(t, func(client *Client) error {
			_, err := client.Export(context.Background(), 12345)
			return err
		})
	})
	t.Run("delete", func(t *testing.T) {
		run(t, func(client *Client) error {
			_, err := client.Delete(context.Background(), 12345, "owner-handle")
			return err
		})
	})
}

func TestDataClientTransportFailureIsUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	client := newDataTestClient(t, server)
	server.Close()
	if _, err := client.Export(context.Background(), 12345); !errors.Is(err, ErrUnavailable) {
		t.Errorf("Export after transport shutdown err = %v, want ErrUnavailable", err)
	}
	if _, err := client.Delete(context.Background(), 12345, "owner-handle"); !errors.Is(err, ErrUnavailable) {
		t.Errorf("Delete after transport shutdown err = %v, want ErrUnavailable", err)
	}
}
