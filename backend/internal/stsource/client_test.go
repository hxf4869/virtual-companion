package stsource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// All fixtures are synthetic: loopback httptest servers, generated UUID-shaped
// identities and one fixed service token; no real chat content or credentials.
const synthToken = "st-source-service-token-0123456789abcdef"

const (
	synthIdentity   = "01234567-89ab-4def-8abc-0123456789ab"
	otherIdentity   = "fedcba98-7654-4321-8abc-def012345678"
	privateReadPath = "/internal/v1/st/sources"
)

func synthIdentityN(i int) string { return fmt.Sprintf("00000000-4000-8000-8000-%012x", i) }

type capturedSourceRead struct {
	method, path, auth, contentType, owner string
	chats                                  []Query
}

func serveSourceRead(t *testing.T, respond func(w http.ResponseWriter, owner string, chats []Query)) (*httptest.Server, *capturedSourceRead) {
	t.Helper()
	captured := &capturedSourceRead{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.method, captured.path = r.Method, r.URL.Path
		captured.auth, captured.contentType = r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		var body struct {
			Owner string  `json:"ownerAccountId"`
			Chats []Query `json:"chats"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode source read request: %v", err)
		}
		captured.owner, captured.chats = body.Owner, body.Chats
		respond(w, body.Owner, body.Chats)
	}))
	t.Cleanup(server.Close)
	return server, captured
}

func newSourceClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := NewClient(server.URL, synthToken)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func writeSourceResponse(w http.ResponseWriter, owner string, snapshots ...map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ownerAccountId": owner, "snapshots": snapshots})
}

func TestNewClientRejectsInvalidConfiguration(t *testing.T) {
	for _, base := range []string{"", "ftp://127.0.0.1:8752", "http://user:pass@127.0.0.1:8752", "http://127.0.0.1:8752/?q=1", "http://127.0.0.1:8752/#frag", "not a url"} {
		if _, err := NewClient(base, synthToken); err == nil {
			t.Errorf("NewClient(%q) accepted an invalid base", base)
		}
	}
	if _, err := NewClient("http://127.0.0.1:8752", "short"); err == nil {
		t.Error("NewClient accepted a token below 32 bytes")
	}
	if _, err := NewClient("http://127.0.0.1:8752", synthToken); err != nil {
		t.Fatalf("NewClient rejected a valid configuration: %v", err)
	}
}

func TestReadPostsPrivateSourceQueryWithBearerAndExactDecimalOwner(t *testing.T) {
	server, captured := serveSourceRead(t, func(w http.ResponseWriter, owner string, chats []Query) {
		writeSourceResponse(w, owner, map[string]any{
			"chatIdentity": chats[0].ChatIdentity,
			"state":        "PRESENT",
			"revision":     5,
			"location":     "chats/synthetic-a.jsonl",
			"messages": []map[string]any{{
				"messageId": synthIdentityN(1), "candidateId": synthIdentityN(2), "revision": 3,
				"role": "assistant", "text": "synthetic reply", "settled": true, "eligible": true,
			}},
		})
	})
	client, err := NewClient(server.URL+"/", synthToken) // trailing slash must still hit the exact path
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	snapshots, err := client.Read(context.Background(), 2000001, []Query{{ChatIdentity: synthIdentity}})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if captured.method != http.MethodPost || captured.path != privateReadPath {
		t.Errorf("request = %s %s, want POST %s", captured.method, captured.path, privateReadPath)
	}
	if captured.auth != "Bearer "+synthToken {
		t.Errorf("Authorization = %q, want Bearer service token", captured.auth)
	}
	if captured.contentType != "application/json" {
		t.Errorf("Content-Type = %q", captured.contentType)
	}
	if captured.owner != strconv.FormatInt(2000001, 10) {
		t.Errorf("ownerAccountId = %q, want exact decimal 2000001", captured.owner)
	}
	if len(captured.chats) != 1 || captured.chats[0].ChatIdentity != synthIdentity {
		t.Errorf("chats = %+v", captured.chats)
	}
	if len(snapshots) != 1 || snapshots[0].State != "PRESENT" || snapshots[0].Revision != 5 || snapshots[0].Location != "chats/synthetic-a.jsonl" {
		t.Fatalf("snapshots = %+v", snapshots)
	}
	if messages := snapshots[0].Messages; len(messages) != 1 || messages[0].MessageID != synthIdentityN(1) || messages[0].CandidateID != synthIdentityN(2) || messages[0].Revision != 3 || !messages[0].Settled || !messages[0].Eligible {
		t.Errorf("messages = %+v", messages)
	}
}

func TestReadBatchReturnsSnapshotAndNotModified(t *testing.T) {
	requested := int64(9)
	server, _ := serveSourceRead(t, func(w http.ResponseWriter, owner string, chats []Query) {
		writeSourceResponse(w, owner,
			map[string]any{
				"chatIdentity": synthIdentityN(10), "state": "PRESENT", "revision": 4, "location": "chats/synthetic-b.jsonl",
				"messages": []map[string]any{{
					"messageId": synthIdentityN(11), "candidateId": synthIdentityN(12), "revision": 1,
					"role": "user", "text": "synthetic user line", "settled": false, "eligible": true,
				}},
			},
			map[string]any{
				"chatIdentity": synthIdentityN(20), "state": "PRESENT", "revision": requested,
				"location": "chats/synthetic-c.jsonl", "notModified": true,
			},
		)
	})
	client := newSourceClient(t, server)
	snapshots, err := client.Read(context.Background(), 2000001, []Query{
		{ChatIdentity: synthIdentityN(10)},
		{ChatIdentity: synthIdentityN(20), Revision: &requested},
	})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if len(snapshots) != 2 {
		t.Fatalf("snapshots = %+v, want 2", snapshots)
	}
	if !snapshots[1].NotModified || snapshots[1].Revision != requested || len(snapshots[1].Messages) != 0 {
		t.Errorf("notModified snapshot = %+v", snapshots[1])
	}
	if len(snapshots[0].Messages) != 1 || snapshots[0].Messages[0].Role != "user" || snapshots[0].Messages[0].Settled {
		t.Errorf("snapshot messages = %+v", snapshots[0].Messages)
	}
}

func TestReadAcceptsDeletedUnknownUnavailable(t *testing.T) {
	server, _ := serveSourceRead(t, func(w http.ResponseWriter, owner string, chats []Query) {
		response := make([]map[string]any, 0, len(chats))
		for _, chat := range chats {
			switch chat.ChatIdentity {
			case synthIdentityN(30):
				response = append(response, map[string]any{"chatIdentity": chat.ChatIdentity, "state": "DELETED", "revision": int64(2)})
			case synthIdentityN(31):
				response = append(response, map[string]any{"chatIdentity": chat.ChatIdentity, "state": "UNKNOWN"})
			default:
				response = append(response, map[string]any{"chatIdentity": chat.ChatIdentity, "state": "UNAVAILABLE"})
			}
		}
		writeSourceResponse(w, owner, response...)
	})
	client := newSourceClient(t, server)
	snapshots, err := client.Read(context.Background(), 2000001, []Query{
		{ChatIdentity: synthIdentityN(30)},
		{ChatIdentity: synthIdentityN(31)},
		{ChatIdentity: synthIdentityN(32)},
	})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	want := []string{"DELETED", "UNKNOWN", "UNAVAILABLE"}
	for i, state := range want {
		if snapshots[i].State != state {
			t.Errorf("snapshots[%d].State = %q, want %q", i, snapshots[i].State, state)
		}
	}
}

func TestReadRejectsMalformedResponses(t *testing.T) {
	id := synthIdentityN(100)
	rev9 := int64(9)
	msg := func(messageID, candidateID, role string, revision int64) string {
		return fmt.Sprintf(`{"messageId":%q,"candidateId":%q,"revision":%d,"role":%q,"text":"synthetic","settled":false,"eligible":true}`, messageID, candidateID, revision, role)
	}
	present := func(extra string) string {
		return fmt.Sprintf(`{"chatIdentity":%q,"state":"PRESENT","revision":4,"location":"chats/s.jsonl"%s}`, id, extra)
	}
	wrap := func(snapshot string) string {
		return `{"ownerAccountId":"2000001","snapshots":[` + snapshot + `]}`
	}
	cases := []struct {
		name string
		rev  *int64
		body string
	}{
		{"empty owner", nil, `{"ownerAccountId":"","snapshots":[{"chatIdentity":"` + id + `","state":"UNKNOWN"}]}`},
		{"missing snapshots", nil, `{"ownerAccountId":"2000001"}`},
		{"wrong owner", nil, `{"ownerAccountId":"2000002","snapshots":[{"chatIdentity":"` + id + `","state":"UNKNOWN"}]}`},
		{"duplicate snapshot identity", nil, wrap(`{"chatIdentity":"` + id + `","state":"UNKNOWN"},{"chatIdentity":"` + id + `","state":"UNKNOWN"}`)},
		{"unrequested identity", nil, wrap(`{"chatIdentity":"` + otherIdentity + `","state":"UNKNOWN"}`)},
		{"identity not uuid", nil, wrap(`{"chatIdentity":"chat-100","state":"UNKNOWN"}`)},
		{"unknown state", nil, wrap(`{"chatIdentity":"` + id + `","state":"FLYING"}`)},
		{"present without location", nil, wrap(`{"chatIdentity":"` + id + `","state":"PRESENT","revision":1}`)},
		{"present negative revision", nil, wrap(`{"chatIdentity":"` + id + `","state":"PRESENT","revision":-1,"location":"l"}`)},
		{"notModified without requested revision", nil, wrap(present(`,"notModified":true`))},
		{"notModified revision mismatch", &rev9, wrap(`{"chatIdentity":"` + id + `","state":"PRESENT","revision":8,"location":"l","notModified":true}`)},
		{"notModified with messages", &rev9, wrap(present(`,"notModified":true,"messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "user", 1) + `]`))},
		{"message identity not uuid", nil, wrap(present(`,"messages":[` + msg("m1", synthIdentityN(42), "user", 1) + `]`))},
		{"candidate identity not uuid", nil, wrap(present(`,"messages":[` + msg(synthIdentityN(41), "c1", "user", 1) + `]`))},
		{"duplicate message identity", nil, wrap(present(`,"messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "user", 1) + `,` + msg(synthIdentityN(41), synthIdentityN(43), "assistant", 1) + `]`))},
		{"message role unknown", nil, wrap(present(`,"messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "narrator", 1) + `]`))},
		{"message revision zero", nil, wrap(present(`,"messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "user", 0) + `]`))},
		{"deleted with messages", nil, wrap(`{"chatIdentity":"` + id + `","state":"DELETED","revision":2,"messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "user", 1) + `]}`)},
		{"deleted notModified", nil, wrap(`{"chatIdentity":"` + id + `","state":"DELETED","revision":2,"notModified":true}`)},
		{"deleted revision zero", nil, wrap(`{"chatIdentity":"` + id + `","state":"DELETED","revision":0}`)},
		{"unknown entry with messages", nil, wrap(`{"chatIdentity":"` + id + `","state":"UNKNOWN","messages":[` + msg(synthIdentityN(41), synthIdentityN(42), "user", 1) + `]}`)},
		{"unavailable entry notModified", nil, wrap(`{"chatIdentity":"` + id + `","state":"UNAVAILABLE","notModified":true}`)},
		{"trailing body garbage", nil, `{"ownerAccountId":"2000001","snapshots":[]} garbage`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := serveSourceRead(t, func(w http.ResponseWriter, owner string, chats []Query) {
				_, _ = fmt.Fprint(w, tc.body)
			})
			client := newSourceClient(t, server)
			query := Query{ChatIdentity: id}
			if tc.rev != nil {
				query.Revision = tc.rev
			}
			snapshots, err := client.Read(context.Background(), 2000001, []Query{query})
			if !errors.Is(err, ErrUnavailable) {
				t.Fatalf("Read err = %v, want ErrUnavailable", err)
			}
			if snapshots != nil {
				t.Errorf("snapshots = %+v, want nil on rejection", snapshots)
			}
		})
	}
}

func TestReadValidatesInputBeforeRequest(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	t.Cleanup(server.Close)
	client := newSourceClient(t, server)
	negative := int64(-1)
	rev := int64(3)
	batch := make([]Query, 65)
	for i := range batch {
		batch[i] = Query{ChatIdentity: synthIdentityN(i)}
	}
	cases := []struct {
		name    string
		owner   int64
		queries []Query
	}{
		{"owner zero", 0, []Query{{ChatIdentity: synthIdentity}}},
		{"owner negative", -1, []Query{{ChatIdentity: synthIdentity}}},
		{"no queries", 2000001, nil},
		{"identity not uuid", 2000001, []Query{{ChatIdentity: "chat-1"}}},
		{"negative revision", 2000001, []Query{{ChatIdentity: synthIdentity, Revision: &negative}}},
		{"duplicate query identity", 2000001, []Query{{ChatIdentity: synthIdentity}, {ChatIdentity: synthIdentity, Revision: &rev}}},
		{"batch above 64", 2000001, batch},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			snapshots, err := client.Read(context.Background(), tc.owner, tc.queries)
			if !errors.Is(err, ErrUnavailable) {
				t.Fatalf("Read err = %v, want ErrUnavailable", err)
			}
			if snapshots != nil {
				t.Errorf("snapshots = %+v, want nil", snapshots)
			}
		})
	}
	if hits.Load() != 0 {
		t.Errorf("server received %d requests, want 0", hits.Load())
	}
}

func TestReadTransportFailureIsUnavailableNotDeletion(t *testing.T) {
	t.Run("non-200 with deletion body", func(t *testing.T) {
		server, _ := serveSourceRead(t, func(w http.ResponseWriter, owner string, chats []Query) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = fmt.Fprint(w, `{"ownerAccountId":"2000001","snapshots":[{"chatIdentity":"`+synthIdentity+`","state":"DELETED","revision":1}]}`)
		})
		client := newSourceClient(t, server)
		snapshots, err := client.Read(context.Background(), 2000001, []Query{{ChatIdentity: synthIdentity}})
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("Read err = %v, want ErrUnavailable", err)
		}
		if snapshots != nil {
			t.Errorf("snapshots = %+v, want nil: a non-200 body must never surface as deletion", snapshots)
		}
	})
	t.Run("request deadline exceeded", func(t *testing.T) {
		release := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
		t.Cleanup(server.Close)
		t.Cleanup(func() { close(release) })
		client := newSourceClient(t, server)
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		t.Cleanup(cancel)
		snapshots, err := client.Read(ctx, 2000001, []Query{{ChatIdentity: synthIdentity}})
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("Read err = %v, want ErrUnavailable", err)
		}
		if snapshots != nil {
			t.Errorf("snapshots = %+v, want nil: an aborted request must never surface as deletion", snapshots)
		}
	})
	t.Run("connection refused", func(t *testing.T) {
		server := httptest.NewServer(http.NotFoundHandler())
		client := newSourceClient(t, server)
		server.Close()
		snapshots, err := client.Read(context.Background(), 2000001, []Query{{ChatIdentity: synthIdentity}})
		if !errors.Is(err, ErrUnavailable) || snapshots != nil {
			t.Fatalf("Read = %+v, %v; want nil, ErrUnavailable", snapshots, err)
		}
	})
}

func TestReadDoesNotFollowRedirectsWithToken(t *testing.T) {
	assertNoLeak := func(t *testing.T, client *Client, leaks, withToken *atomic.Int32) {
		t.Helper()
		snapshots, err := client.Read(context.Background(), 2000001, []Query{{ChatIdentity: synthIdentity}})
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("Read err = %v, want ErrUnavailable", err)
		}
		if snapshots != nil {
			t.Errorf("snapshots = %+v, want nil", snapshots)
		}
		if leaks.Load() != 0 || withToken.Load() != 0 {
			t.Fatalf("redirect target hit %d times (%d with token); the service token must not be forwarded", leaks.Load(), withToken.Load())
		}
	}
	t.Run("same server path redirect", func(t *testing.T) {
		var leaks, withToken atomic.Int32
		mux := http.NewServeMux()
		mux.HandleFunc(privateReadPath, func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/sink", http.StatusFound)
		})
		mux.HandleFunc("/sink", func(w http.ResponseWriter, r *http.Request) {
			leaks.Add(1)
			if r.Header.Get("Authorization") != "" {
				withToken.Add(1)
			}
		})
		server := httptest.NewServer(mux)
		t.Cleanup(server.Close)
		assertNoLeak(t, newSourceClient(t, server), &leaks, &withToken)
	})
	t.Run("cross host redirect", func(t *testing.T) {
		var leaks, withToken atomic.Int32
		leakServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			leaks.Add(1)
			if r.Header.Get("Authorization") != "" {
				withToken.Add(1)
			}
		}))
		t.Cleanup(leakServer.Close)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, leakServer.URL+"/sink", http.StatusFound)
		}))
		t.Cleanup(server.Close)
		assertNoLeak(t, newSourceClient(t, server), &leaks, &withToken)
	})
}

func TestRefRoundtripAndCanonicalRejection(t *testing.T) {
	ref := Ref{Chat: synthIdentity, Message: synthIdentityN(1), Candidate: synthIdentityN(2), Revision: 7, Generation: 3}
	raw := ref.String()
	parsed, ok := ParseRef(raw)
	if !ok || parsed != ref {
		t.Fatalf("roundtrip of %q = %+v, %v", raw, parsed, ok)
	}
	bad := []string{
		"",
		"st",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:3:extra",
		"go:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:3",
		"st:chat:" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:3",
		"st:" + strings.ToUpper(synthIdentity) + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:3",
		"st:" + synthIdentity + ":message:" + synthIdentityN(2) + ":7:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":candidate:7:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":0:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":-1:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":x:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:0",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:-2",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7:9223372036854775808",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":+7:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":07:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ": 7:3",
		"st:" + synthIdentity + ":" + synthIdentityN(1) + ":" + synthIdentityN(2) + ":7: 3",
	}
	for _, raw := range bad {
		if _, ok := ParseRef(raw); ok {
			t.Errorf("ParseRef(%q) accepted a malformed or non-canonical ref", raw)
		}
	}
}

func TestReadMissingMessagesIsNotAnEmptySnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ownerAccountId":"1","snapshots":[{"chatIdentity":"10000000-0000-0000-0000-000000000001","state":"PRESENT","revision":1,"location":"chats/x.jsonl"}]}`))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, strings.Repeat("t", 32))
	if err != nil {
		t.Fatal(err)
	}
	snapshots, err := client.Read(context.Background(), 1, []Query{{ChatIdentity: "10000000-0000-0000-0000-000000000001"}})
	if !errors.Is(err, ErrUnavailable) || snapshots != nil {
		t.Fatal("missing messages must not confirm an empty source")
	}
}
