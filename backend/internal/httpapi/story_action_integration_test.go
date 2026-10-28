//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStoryHTTPDialogueStaysInLinView(t *testing.T) {
	resetIsolation(t)
	s := newIsoServer(t, postgres.IsolationStore())
	run := openStoryHTTP(t, s, "w14-http-dialogue")
	const said = "今晚的雨停在窗台上"
	statement := postStoryAction(t, s, run, 0, "say-1", "player", "", "lin", "", said)
	if !statement.Accepted || statement.Replayed || statement.WorldVersion != 1 || statement.WorldEventID == "" || statement.Ended {
		t.Fatalf("statement = %+v", statement)
	}
	replay := postStoryAction(t, s, run, 0, "say-1", "player", "", "lin", "", said)
	if !replay.Accepted || !replay.Replayed || replay.WorldEventID != statement.WorldEventID || replay.WorldVersion != statement.WorldVersion {
		t.Fatalf("replay = %+v", replay)
	}
	confirmed := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/projections/"+statement.WorldEventID+"/confirm", "{}", 1)
	if confirmed.Code != http.StatusOK || !decodeJSON[storyConfirmResponse](t, confirmed).Confirmed {
		t.Fatalf("confirm %d %s", confirmed.Code, confirmed.Body.String())
	}
	evidence := postStoryAction(t, s, run, 1, "a1", "player", "request_evidence", "lin", "", "")
	if !evidence.Accepted || evidence.Replayed || evidence.WorldVersion != 2 {
		t.Fatalf("evidence = %+v", evidence)
	}
	stale := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/actions", storyActionBody(run.BranchID, 0, "a2", "player", "request_evidence", "su", "", ""), 1)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale %d %s", stale.Code, stale.Body.String())
	}
	assertEnvelope(t, stale, "REVISION_CONFLICT")
	foreign := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/actions", storyActionBody(run.BranchID, 2, "a2", "player", "request_evidence", "su", "", ""), 2)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign %d %s", foreign.Code, foreign.Body.String())
	}
	if missing := postStoryWithoutCSRF(t, s, "/api/v1/story/runs/"+run.RunID+"/actions", storyActionBody(run.BranchID, 2, "a2", "player", "request_evidence", "su", "", "")); missing.Code != http.StatusForbidden {
		t.Fatalf("csrf %d %s", missing.Code, missing.Body.String())
	}
	if bearer := postStoryBearer(t, s, "/api/v1/story/runs/"+run.RunID+"/actions", storyActionBody(run.BranchID, 2, "a2", "player", "request_evidence", "su", "", "")); bearer.Code != http.StatusUnauthorized {
		t.Fatalf("bearer %d %s", bearer.Code, bearer.Body.String())
	}

	rewound := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/rewind", `{"toWorldVersion":1,"chatIdentity":"w14-http-rewind"}`, 1)
	if rewound.Code != http.StatusOK {
		t.Fatalf("rewind %d %s", rewound.Code, rewound.Body.String())
	}
	fork := decodeJSON[storyRewindResponse](t, rewound)
	if fork.BranchID == run.BranchID || fork.WorldVersion != 1 || fork.Stage != "investigation" {
		t.Fatalf("fork = %+v", fork)
	}
	lin := doJSON(t, s, http.MethodGet, storyViewPath(run.RunID, "lin", fork.BranchID, 1), "", 1)
	zhou := doJSON(t, s, http.MethodGet, storyViewPath(run.RunID, "zhou", fork.BranchID, 1), "", 1)
	if lin.Code != http.StatusOK || zhou.Code != http.StatusOK {
		t.Fatalf("views lin %d zhou %d", lin.Code, zhou.Code)
	}
	if !strings.Contains(lin.Body.String(), said) || strings.Contains(lin.Body.String(), "钥匙借用记录") || strings.Contains(lin.Body.String(), "GM_ONLY_WATCH_TRUTH_92") {
		t.Fatalf("lin view = %s", lin.Body.String())
	}
	if strings.Contains(zhou.Body.String(), said) || strings.Contains(zhou.Body.String(), "钥匙借用记录") || strings.Contains(zhou.Body.String(), "GM_ONLY_WATCH_TRUTH_92") {
		t.Fatalf("zhou view = %s", zhou.Body.String())
	}
}

func TestStoryHTTPSevenStepsResolve(t *testing.T) {
	resetIsolation(t)
	s := newIsoServer(t, postgres.IsolationStore())
	discarded := playStoryHTTP(t, s, "w14-http-discard")
	if !discarded.Ended || discarded.Stage != "resolved" || discarded.WorldVersion != 7 {
		t.Fatalf("discard path = %+v", discarded)
	}
	player := doJSON(t, s, http.MethodGet, storyViewPath(discarded.RunID, "player", discarded.BranchID, discarded.WorldVersion), "", 1)
	if player.Code != http.StatusOK || strings.Contains(player.Body.String(), "GM_ONLY_WATCH_TRUTH_92") {
		t.Fatalf("resolved view %d %s", player.Code, player.Body.String())
	}
	gone := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+discarded.RunID+"/epilogue", `{"decision":"discard"}`, 1)
	if gone.Code != http.StatusOK {
		t.Fatalf("discard %d %s", gone.Code, gone.Body.String())
	}
	if strings.Contains(gone.Body.String(), "memoryId") || decodeJSON[storyEpilogueResponse](t, gone).Decision != "discard" {
		t.Fatalf("discard body %s", gone.Body.String())
	}
	if got := superText(t, `SELECT count(*)::text FROM vc.memory_item WHERE owner_user_id=1`); got != "0" {
		t.Fatalf("discard wrote memory: %s", got)
	}

	savedRun := playStoryHTTP(t, s, "w14-http-save")
	created := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("relationship %d %s", created.Code, created.Body.String())
	}
	var rel struct {
		RelationshipID int64 `json:"relationshipId"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &rel); err != nil || rel.RelationshipID <= 0 {
		t.Fatal(created.Body.String())
	}
	relationshipID := strconv.FormatInt(rel.RelationshipID, 10)
	mapped := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+savedRun.RunID+"/participants/lin", `{"relationshipId":"`+relationshipID+`"}`, 1)
	if mapped.Code != http.StatusOK {
		t.Fatalf("map %d %s", mapped.Code, mapped.Body.String())
	}
	joined := decodeJSON[storyJoinResponse](t, mapped)
	if joined.RunID != savedRun.RunID || joined.ActorID != "lin" || joined.RelationshipID != relationshipID {
		t.Fatalf("joined = %+v", joined)
	}
	const summary = "我们一起玩过雨夜旅馆这一局"
	kept := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+savedRun.RunID+"/epilogue",
		`{"decision":"save","relationshipId":"`+relationshipID+`","summary":"`+summary+`"}`, 1)
	if kept.Code != http.StatusOK {
		t.Fatalf("save %d %s", kept.Code, kept.Body.String())
	}
	epilogue := decodeJSON[storyEpilogueResponse](t, kept)
	if epilogue.Decision != "save" || epilogue.RelationshipID != relationshipID || epilogue.MemoryID == "" || epilogue.MemoryStatus != "PENDING_CONFIRMATION" || epilogue.Summary != summary {
		t.Fatalf("save = %+v", epilogue)
	}
	if got := superText(t, `SELECT status || ' ' || (SELECT count(*) FROM vc.memory_item WHERE owner_user_id=1 AND status='ACCEPTED')::text FROM vc.memory_item WHERE owner_user_id=1 AND id=$1::bigint`, epilogue.MemoryID); got != "PENDING_CONFIRMATION 0" {
		t.Fatalf("unconfirmed save = %s", got)
	}
}

type storyConfirmResponse struct {
	WorldEventID string `json:"worldEventId"`
	Confirmed    bool   `json:"confirmed"`
}

type storyRewindResponse struct {
	BranchID     string `json:"branchId"`
	WorldVersion int64  `json:"worldVersion"`
	Stage        string `json:"stage"`
}

type storyEpilogueResponse struct {
	Decision       string `json:"decision"`
	RelationshipID string `json:"relationshipId"`
	MemoryID       string `json:"memoryId"`
	MemoryStatus   string `json:"memoryStatus"`
	Summary        string `json:"summary"`
}

type storyJoinResponse struct {
	RunID          string `json:"runId"`
	ActorID        string `json:"actorId"`
	RelationshipID string `json:"relationshipId"`
}

type storyPlayed struct {
	RunID        string
	BranchID     string
	WorldVersion int64
	Stage        string
	Ended        bool
}

func openStoryHTTP(t *testing.T, s *Server, chat string) storyRunResponse {
	t.Helper()
	binding := doJSON(t, s, http.MethodPost, "/api/v1/st/bindings",
		`{"chatIdentity":"`+chat+`","characterRef":"rainy-card","mode":"STORY"}`, 1)
	if binding.Code != http.StatusOK {
		t.Fatalf("binding %d %s", binding.Code, binding.Body.String())
	}
	var bound struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal(binding.Body.Bytes(), &bound); err != nil || bound.ConversationID == "" {
		t.Fatal(binding.Body.String())
	}
	started := doJSON(t, s, http.MethodPost, "/api/v1/story/runs",
		`{"conversationId":"`+bound.ConversationID+`","caseId":"rainy-inn-v1"}`, 1)
	if started.Code != http.StatusOK {
		t.Fatalf("start %d %s", started.Code, started.Body.String())
	}
	return decodeJSON[storyRunResponse](t, started)
}

func playStoryHTTP(t *testing.T, s *Server, chat string) storyPlayed {
	t.Helper()
	run := openStoryHTTP(t, s, chat)
	steps, err := story.DeterministicSuccessPath("rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	version := run.WorldVersion
	branch := run.BranchID
	var last storyActionResponse
	for _, step := range steps {
		last = postStoryAction(t, s, run, version, step.ActionID, step.ActorID, step.Action, step.Target, step.ClueID, "")
		if !last.Accepted || last.Replayed || last.WorldVersion != version+1 || last.BranchID != branch {
			t.Fatalf("step %+v = %+v", step, last)
		}
		version = last.WorldVersion
	}
	return storyPlayed{RunID: run.RunID, BranchID: branch, WorldVersion: version, Stage: last.Stage, Ended: last.Ended}
}

func postStoryAction(t *testing.T, s *Server, run storyRunResponse, version int64, actionID, actorID, action, target, clueID, text string) storyActionResponse {
	t.Helper()
	rec := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/actions",
		storyActionBody(run.BranchID, version, actionID, actorID, action, target, clueID, text), 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("action %s %d %s", actionID, rec.Code, rec.Body.String())
	}
	return decodeJSON[storyActionResponse](t, rec)
}

func storyActionBody(branch string, version int64, actionID, actorID, action, target, clueID, text string) string {
	raw, err := json.Marshal(map[string]any{
		"branchId": branch, "expectedWorldVersion": version, "actionId": actionID, "actorId": actorID,
		"action": action, "target": target, "clueId": clueID, "text": text,
	})
	if err != nil {
		panic(err)
	}
	return string(raw)
}

func storyViewPath(runID, actorID, branchID string, version int64) string {
	return "/api/v1/story/runs/" + runID + "/actors/" + actorID + "/view?branchId=" + branchID + "&worldVersion=" + strconv.FormatInt(version, 10)
}

func postStoryWithoutCSRF(t *testing.T, s *Server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	attachAuth(t, s, req, 1, false)
	req.Header.Set("Origin", "https://vc.test")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func postStoryBearer(t *testing.T, s *Server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://vc.test")
	req.Header.Set("Authorization", "Bearer synthetic-service-token-0123456789")
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	req.Header.Set(csrfHeader, "csrf-token")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json %s", rec.Body.String())
	}
	return out
}

func superText(t *testing.T, query string, args ...any) string {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, postgres.IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var got string
	if err := pool.QueryRow(ctx, query, args...).Scan(&got); err != nil {
		t.Fatal(err)
	}
	return got
}
