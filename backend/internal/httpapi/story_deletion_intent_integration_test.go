//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// 删除意图期间，剧情 ActorView、服务令牌 outbound-check，以及行动、回档、
// 投影确认、未确认投影列表，都与会话写一样返回 NOT_FOUND_OR_FORBIDDEN。
// 无意图时这些入口仍按原语义成功。
func TestStoryDeletionIntentRejectsEntries(t *testing.T) {
	resetIsolation(t)
	ctx := context.Background()
	s := newIsoServer(t, postgres.IsolationStore())
	s.cfg.STPlugin.ServiceToken = storyOutboundToken

	const chat = "10000000-0000-4000-8000-0000000000f1"
	const rewindChat = "10000000-0000-4000-8000-0000000000f2"
	const blockedRewindChat = "10000000-0000-4000-8000-0000000000f3"
	run := openStoryHTTP(t, s, chat)
	runID, err := strconv.ParseInt(run.RunID, 10, 64)
	if err != nil || runID <= 0 {
		t.Fatalf("run id %q", run.RunID)
	}

	view := doJSON(t, s, http.MethodGet, storyViewPath(run.RunID, "lin", run.BranchID, 0), "", 1)
	if view.Code != http.StatusOK {
		t.Fatalf("view before intent %d %s", view.Code, view.Body.String())
	}
	outbound := postStoryServiceOutbound(t, s, run.RunID, "lin", storyDeletionOutboundBody(t, run.BranchID, 0, chat))
	if outbound.Code != http.StatusOK || strings.TrimSpace(outbound.Body.String()) != `{"passed":true}` {
		t.Fatalf("outbound before intent %d %s", outbound.Code, outbound.Body.String())
	}
	firstFacts, err := postgres.IsolationStore().LoadStoryActor(ctx, 1, runID, mustStoryID(t, run.BranchID), "lin", 0)
	if err != nil || firstFacts.ChatIdentity != chat || firstFacts.ActorID != "lin" {
		t.Fatalf("LoadStoryActor before intent = %+v %v", firstFacts, err)
	}

	said := postStoryAction(t, s, run, 0, "say-1", "player", "", "lin", "", "今晚的雨停在窗台上")
	if !said.Accepted || said.Replayed || said.WorldVersion != 1 || said.WorldEventID == "" {
		t.Fatalf("statement = %+v", said)
	}
	listed := listStoryProjections(t, s, run.RunID)
	if listed.Code != http.StatusOK || !storyProjectionIDs(t, listed)[said.WorldEventID] {
		t.Fatalf("pending before confirm %d %s", listed.Code, listed.Body.String())
	}
	confirmed := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/projections/"+said.WorldEventID+"/confirm", "{}", 1)
	if confirmed.Code != http.StatusOK || !decodeJSON[storyConfirmResponse](t, confirmed).Confirmed {
		t.Fatalf("confirm %d %s", confirmed.Code, confirmed.Body.String())
	}
	empty := listStoryProjections(t, s, run.RunID)
	if empty.Code != http.StatusOK || len(storyProjectionIDs(t, empty)) != 0 {
		t.Fatalf("pending after confirm %d %s", empty.Code, empty.Body.String())
	}

	rewound := doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/rewind",
		`{"toWorldVersion":0,"chatIdentity":"`+rewindChat+`"}`, 1)
	if rewound.Code != http.StatusOK {
		t.Fatalf("rewind %d %s", rewound.Code, rewound.Body.String())
	}
	fork := decodeJSON[storyRewindResponse](t, rewound)
	if fork.BranchID == run.BranchID || fork.WorldVersion != 0 {
		t.Fatalf("fork = %+v", fork)
	}
	head := run
	head.BranchID = fork.BranchID
	pending := postStoryAction(t, s, head, 0, "say-2", "player", "", "lin", "", "雨还在廊下")
	if !pending.Accepted || pending.Replayed || pending.WorldVersion != 1 || pending.BranchID != fork.BranchID || pending.WorldEventID == "" {
		t.Fatalf("head statement = %+v", pending)
	}
	again := listStoryProjections(t, s, run.RunID)
	if again.Code != http.StatusOK || !storyProjectionIDs(t, again)[pending.WorldEventID] {
		t.Fatalf("pending on head %d %s", again.Code, again.Body.String())
	}
	headView := doJSON(t, s, http.MethodGet, storyViewPath(run.RunID, "lin", fork.BranchID, 1), "", 1)
	if headView.Code != http.StatusOK || !strings.Contains(headView.Body.String(), "雨还在廊下") {
		t.Fatalf("head view %d %s", headView.Code, headView.Body.String())
	}
	headOutbound := postStoryServiceOutbound(t, s, run.RunID, "lin", storyDeletionOutboundBody(t, fork.BranchID, 1, chat))
	if headOutbound.Code != http.StatusOK || strings.TrimSpace(headOutbound.Body.String()) != `{"passed":true}` {
		t.Fatalf("head outbound %d %s", headOutbound.Code, headOutbound.Body.String())
	}

	eventsBefore := superText(t, `SELECT count(*)::text FROM vc.story_event WHERE owner_user_id=1`)
	branchesBefore := superText(t, `SELECT count(*)::text FROM vc.story_branch WHERE owner_user_id=1`)
	versionBefore := superText(t, `SELECT world_version::text FROM vc.story_run WHERE owner_user_id=1 AND id=$1::bigint`, run.RunID)
	stateBefore := superText(t, `SELECT projection_state FROM vc.story_event WHERE owner_user_id=1 AND id=$1::bigint`, pending.WorldEventID)
	if versionBefore != "1" || stateBefore != "PENDING" {
		t.Fatalf("before intent version=%s state=%s", versionBefore, stateBefore)
	}

	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
		VALUES (1, '00000000000000000000000000000000000000000000000000000000000000f1', 'REQUESTED')`); err != nil {
		t.Fatal(err)
	}

	branchID := mustStoryID(t, fork.BranchID)
	cases := []struct {
		name string
		call func() *httptest.ResponseRecorder
	}{
		{"actor view", func() *httptest.ResponseRecorder {
			return doJSON(t, s, http.MethodGet, storyViewPath(run.RunID, "lin", fork.BranchID, 1), "", 1)
		}},
		{"outbound-check", func() *httptest.ResponseRecorder {
			return postStoryServiceOutbound(t, s, run.RunID, "lin", storyDeletionOutboundBody(t, fork.BranchID, 1, chat))
		}},
		{"action", func() *httptest.ResponseRecorder {
			return doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/actions",
				storyActionBody(fork.BranchID, 1, "say-3", "player", "", "lin", "", "不该写进去"), 1)
		}},
		{"rewind", func() *httptest.ResponseRecorder {
			return doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/rewind",
				`{"toWorldVersion":0,"chatIdentity":"`+blockedRewindChat+`"}`, 1)
		}},
		{"projection confirm", func() *httptest.ResponseRecorder {
			return doJSON(t, s, http.MethodPost, "/api/v1/story/runs/"+run.RunID+"/projections/"+pending.WorldEventID+"/confirm", "{}", 1)
		}},
		{"pending projections", func() *httptest.ResponseRecorder {
			return listStoryProjections(t, s, run.RunID)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := tc.call()
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			assertEnvelope(t, rec, "NOT_FOUND_OR_FORBIDDEN")
			var env struct {
				Message string `json:"message"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Message != "not found" {
				t.Fatalf("message = %q body %s", env.Message, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), `"passed":true`) || strings.Contains(rec.Body.String(), "雨还在廊下") {
				t.Fatalf("deletion response leaked story data: %s", rec.Body.String())
			}
		})
	}
	_, err = postgres.IsolationStore().LoadStoryActor(ctx, 1, runID, branchID, "lin", 1)
	if !errors.Is(err, postgres.ErrNotFound) {
		t.Fatalf("LoadStoryActor during deletion = %v", err)
	}
	if got := superText(t, `SELECT count(*)::text FROM vc.story_event WHERE owner_user_id=1`); got != eventsBefore {
		t.Fatalf("events %s want %s", got, eventsBefore)
	}
	if got := superText(t, `SELECT count(*)::text FROM vc.story_branch WHERE owner_user_id=1`); got != branchesBefore {
		t.Fatalf("branches %s want %s", got, branchesBefore)
	}
	if got := superText(t, `SELECT world_version::text FROM vc.story_run WHERE owner_user_id=1 AND id=$1::bigint`, run.RunID); got != versionBefore {
		t.Fatalf("world version %s", got)
	}
	if got := superText(t, `SELECT projection_state FROM vc.story_event WHERE owner_user_id=1 AND id=$1::bigint`, pending.WorldEventID); got != "PENDING" {
		t.Fatalf("projection state %s", got)
	}
	if got := superText(t, `SELECT status FROM vc.identity_account WHERE id=1`); got != "ACTIVE" {
		t.Fatalf("account status %s", got)
	}
}

func listStoryProjections(t *testing.T, s *Server, runID string) *httptest.ResponseRecorder {
	t.Helper()
	return doJSON(t, s, http.MethodGet, "/api/v1/story/runs/"+runID+"/projections?state=PENDING", "", 1)
}

func storyProjectionIDs(t *testing.T, rec *httptest.ResponseRecorder) map[string]bool {
	t.Helper()
	var body struct {
		Projections []struct {
			WorldEventID string `json:"worldEventId"`
		} `json:"projections"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("projections %s", rec.Body.String())
	}
	ids := map[string]bool{}
	for _, row := range body.Projections {
		if row.WorldEventID == "" {
			t.Fatalf("blank projection id in %s", rec.Body.String())
		}
		ids[row.WorldEventID] = true
	}
	return ids
}

func postStoryServiceOutbound(t *testing.T, s *Server, runID, actor, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/story/runs/"+runID+"/actors/"+actor+"/outbound-check", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+storyOutboundToken)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func storyDeletionOutboundBody(t *testing.T, branch string, version int64, chat string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"ownerAccountId":        "1",
		"branchId":              branch,
		"worldVersion":          version,
		"chatIdentity":          chat,
		"protocol":              "OPENAI_CHAT_COMPLETIONS",
		"messages":              []string{"玩家：怀表是什么时候不见的？"},
		"system":                []string{"雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。"},
		"instructions":          []string{"只回答你知道的事。"},
		"toolDefinitions":       []string{"ask"},
		"toolResults":           []string{},
		"hasPreviousResponseId": false,
		"hasConversation":       false,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func mustStoryID(t *testing.T, raw string) int64 {
	t.Helper()
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != raw {
		t.Fatalf("id %q", raw)
	}
	return id
}
