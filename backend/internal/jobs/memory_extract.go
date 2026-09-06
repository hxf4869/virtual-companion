package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// Memory extraction is one bounded provider call per finished turn. The
// handler never blocks a chat reply (it runs as its own job), never logs
// conversation bodies, and re-checks every suppression guard before saving.
const (
	// extractMaxItems caps how many memories one turn may produce.
	extractMaxItems = 3
	// extractMaxSummaryRunes is the server-side per-item clamp (the store
	// still enforces the 2000-rune DB limit).
	extractMaxSummaryRunes = 200
	// extractMaxEvidenceRunes caps the per-item user quote the model must
	// return as evidence for the summary.
	extractMaxEvidenceRunes = 80
	// One bounded call: short budgets on the shared TimeoutBudget mechanism.
	extractConnectTimeout    = 5 * time.Second
	extractFirstTokenTimeout = 15 * time.Second
	extractTotalTimeout      = 20 * time.Second
	extractMaxTokens         = 512
)

// extractCategories is the deterministic whitelist: ordinary user-stated
// preferences and explicit facts only. Anything else the model emits is
// dropped server-side (assistant content, speculation, moods and sensitive
// categories are refused by prompt and cannot pass this filter).
var extractCategories = map[string]struct{}{
	"PREFERENCE": {},
	"FACT":       {},
}

// extractSensitiveKeywords is the deterministic denial list for the sensitive
// domains the product already refuses in the persona avoid-topics vocabulary
// (internal/turn persona avoidLabels: health, mental state, politics,
// religion, substance, money) plus personal identifiers. A match drops only
// the offending item, never the whole batch; the model output is untrusted
// data, so this server-side check backs the prompt refusal.
var extractSensitiveKeywords = []string{
	// 健康 / 心理 / 精神（含常见疾病与身体状况的最小常见清单）
	"健康", "疾病", "病史", "抑郁", "焦虑", "心理", "精神", "吃药", "服药", "就诊", "诊断",
	"糖尿病", "高血压", "失眠", "癌症", "肿瘤", "心脏病", "心梗", "中风",
	"哮喘", "肺炎", "肝炎", "肾炎", "癫痫", "残疾", "过敏", "化疗",
	"手术", "住院", "发烧", "怀孕",
	// 性
	"性取向", "性行为", "性生活", "性病", "同性恋",
	// 宗教 / 政治
	"宗教", "教会", "政治", "党派", "选举",
	// 财务困境
	"负债", "欠债", "欠款", "破产", "还贷",
	// 个人标识
	"身份证", "住址", "门牌", "手机号", "电话号", "银行卡", "社保号",
}

// extractHedgePrefixes marks speculation: a summary opening with one of these
// is the model guessing, not the user stating, and is dropped.
var extractHedgePrefixes = []string{"可能", "也许", "大概", "好像", "似乎", "我猜", "听说"}

type extractItem struct {
	Summary  string `json:"summary"`
	Category string `json:"category"`
	Evidence string `json:"evidence"`
}

func (l *Loop) handleMemoryExtract(ctx context.Context, c postgres.JobClaim) error {
	if l == nil || l.store == nil {
		return postgres.ErrInvalid
	}
	input, err := l.store.ReadMemoryExtractInput(ctx, c.OwnerID, c.RefID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return l.closeExtract(ctx, c, "FAILED", "GENERATION_MISSING")
		}
		return l.failExtract(ctx, c, "EXTRACT_READ")
	}
	if input.Status != "COMPLETED" || input.SourceMessageID == nil || input.AssistantMessageID == nil {
		return l.closeExtract(ctx, c, "DONE", "TURN_NOT_EXTRACTABLE")
	}
	// Suppression guards: incognito turn, or either source message carries the
	// no_memory tombstone (set by user marking or by deleting a memory mined
	// from it). A retried job must never resurrect suppressed sources.
	if input.Incognito || input.UserNoMemory || input.AssistantNoMemory {
		return l.closeExtract(ctx, c, "DONE", "MEMORY_SOURCE_SUPPRESSED")
	}
	pref, err := l.store.GetMemoryAutoSavePref(ctx, c.OwnerID)
	if err != nil {
		return l.failExtract(ctx, c, "EXTRACT_READ")
	}
	if !pref {
		return l.closeExtract(ctx, c, "DONE", "AUTO_SAVE_OFF")
	}
	gate, err := l.store.OutboundCheck(ctx, c.OwnerID)
	if err != nil {
		return l.failExtract(ctx, c, "EXTRACT_READ")
	}
	if !gate.Allow {
		return l.closeExtract(ctx, c, "DONE", gate.Code)
	}

	// Resolve the model the same way generation does: first database route via
	// the closed factory, falling back to the process-level env provider when
	// no route is configured. Config failures are terminal, never retried.
	provider, closeProvider, code := l.extractProvider(ctx)
	if code != "" {
		return l.closeExtract(ctx, c, "FAILED", code)
	}
	if closeProvider != nil {
		defer closeProvider()
	}

	items, ok, err := l.callExtractProvider(ctx, provider, input)
	if err != nil {
		return l.failExtract(ctx, c, "EXTRACT_PROVIDER")
	}
	if !ok {
		// The payload was not a JSON array at all: treat it as a failed
		// bounded call, not as "nothing to extract".
		return l.failExtract(ctx, c, "EXTRACT_MALFORMED")
	}
	if len(items) == 0 {
		return l.closeExtract(ctx, c, "DONE", "")
	}

	evidence := []string{
		fmt.Sprintf("message:%d", *input.SourceMessageID),
		fmt.Sprintf("message:%d", *input.AssistantMessageID),
	}
	for i, item := range items {
		_, err := l.store.CreateAutoSavedMemory(ctx, c.OwnerID, postgres.AutoSavedMemoryCreate{
			RelationshipID: input.RelationshipID,
			ConversationID: input.ConversationID,
			Summary:        item.Summary,
			Evidence:       evidence,
			// Stable per (generation, index): a retried job re-hits the same
			// keys and the keyed insert returns the existing rows.
			IdempotencyKey: fmt.Sprintf("auto%d-%d", c.RefID, i),
		})
		if err != nil {
			if errors.Is(err, postgres.ErrInvalid) || errors.Is(err, postgres.ErrNotFound) {
				// The guard refused a source (deleted memory tombstone,
				// incognito): never retry, never resurrect.
				return l.closeExtract(ctx, c, "FAILED", "MEMORY_SOURCE_GUARDED")
			}
			return l.failExtract(ctx, c, "EXTRACT_PERSIST")
		}
	}
	return l.closeExtract(ctx, c, "DONE", "")
}

// enqueueMemoryExtract is the post-completion trigger. It must never affect
// the chat reply: enqueue failures are logged and the task may be lost.
func (l *Loop) enqueueMemoryExtract(ctx context.Context, owner, generationID int64) {
	if l == nil || l.store == nil {
		return
	}
	if _, err := l.store.EnqueueMemoryExtract(ctx, owner, generationID); err != nil {
		l.log.Info("memory extract enqueue",
			slog.String("operation", "memory_extract_enqueue"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXTRACT_ENQUEUE_FAILED"),
		)
	}
}

// extractProvider resolves the bounded call's provider with the generation
// admission semantics: the first database route (single route, no multi-route
// retry) built through the closed factory, or the process-level env provider
// when no route exists. The returned close func is non-nil only for
// route-built providers; a non-empty code is a terminal failure reason.
func (l *Loop) extractProvider(ctx context.Context) (companion.Provider, func(), string) {
	routes, err := l.resolveGenerationRoutes(ctx)
	if err != nil {
		l.log.Error("provider route read failed",
			slog.String("operation", "provider_route_read"),
			slog.String("outcome", "error"),
			slog.String("error_code", "PROVIDER_CONFIG_UNAVAILABLE"),
		)
		return nil, nil, "PROVIDER_CONFIG_UNAVAILABLE"
	}
	if len(routes) > 0 {
		if l.providerFactory == nil {
			return nil, nil, "PROVIDER_CONFIG_UNAVAILABLE"
		}
		route := routes[0]
		provider, buildErr := l.providerFactory(modelprovider.Route{
			ProviderID: route.ProviderID, SupplierName: route.SupplierName,
			Protocol: route.Protocol, BaseURL: route.BaseURL,
			Credential: route.Credential, ModelID: route.ModelID,
			MaxOutputTokens: route.MaxOutputTokens, Priority: route.Priority,
		})
		if buildErr != nil {
			l.log.Error("provider route invalid",
				slog.String("operation", "provider_route_build"),
				slog.String("outcome", "error"),
				slog.String("error_code", "PROVIDER_CONFIG_INVALID"),
			)
			return nil, nil, "PROVIDER_CONFIG_INVALID"
		}
		closeFn := func() {
			if closer, ok := provider.(interface{ Close() }); ok {
				closer.Close()
			}
		}
		return provider, closeFn, ""
	}
	if l.provider == nil {
		return nil, nil, "PROVIDER_DISABLED"
	}
	return l.provider, nil, ""
}

// callExtractProvider makes the single bounded model call. Text is buffered
// in memory; nothing is logged or streamed onward. The bool reports whether
// the payload parsed as a JSON array at all.
func (l *Loop) callExtractProvider(ctx context.Context, provider companion.Provider, input postgres.MemoryExtractInput) ([]extractItem, bool, error) {
	callCtx, cancel := context.WithTimeout(ctx, extractTotalTimeout)
	defer cancel()
	var out strings.Builder
	_, err := provider.Stream(callCtx, companion.ModelRequest{
		Messages: []companion.Message{
			{Role: companion.RoleSystem, Content: extractSystemPrompt},
			{Role: companion.RoleUser, Content: extractUserPrompt(input.UserContent, input.AssistantContent)},
		},
		Stream: false,
		Timeouts: companion.TimeoutBudget{
			Connect:    extractConnectTimeout,
			FirstToken: extractFirstTokenTimeout,
			Total:      extractTotalTimeout,
		},
		MaxTokens: extractMaxTokens,
	}, func(d companion.OutputDelta) error {
		out.WriteString(d.Text)
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	items, ok := parseExtractOutput(out.String(), extractMaxItems, input.UserContent)
	return items, ok, nil
}

// failExtract schedules the bounded retry (V29 requeue: RETRY_SCHEDULED or
// DEAD_LETTERED). Only when the requeue call itself errors does the handler
// attempt an explicit FAILED close, and a losing claim is ignored.
func (l *Loop) failExtract(ctx context.Context, c postgres.JobClaim, code string) error {
	action, err := l.store.RetryMemoryExtract(ctx, c.OwnerID, c.JobID, c.Token, c.Fence)
	if err == nil {
		l.log.Info("memory extract retry",
			slog.String("operation", "memory_extract"),
			slog.String("outcome", "requeued"),
			slog.String("event_type", action),
			slog.String("decision_code", code),
		)
		return nil
	}
	if err := l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", code); err != nil {
		// The bounded retry and the explicit close both failed: the swallowed
		// commit error must stay observable (audit L3), the claim then ages
		// out through lease-expiry recovery.
		l.log.Info("memory extract retry",
			slog.String("operation", "memory_extract_retry"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXTRACT_CLOSE_FAILED"),
		)
	}
	return nil
}

func (l *Loop) closeExtract(ctx context.Context, c postgres.JobClaim, status, reason string) error {
	if err := l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, status, reason); err != nil {
		l.log.Info("memory extract close",
			slog.String("operation", "memory_extract"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXTRACT_CLOSE_FAILED"),
		)
	}
	return nil
}

const extractSystemPrompt = "你是记忆提取器。只从用户消息中提取用户明确表达的普通偏好与明确事实。" +
	"只输出一个 JSON 数组，元素形如 {\"summary\":\"一句话陈述\",\"category\":\"PREFERENCE|FACT\",\"evidence\":\"用户消息中的原文短引\"}，最多 3 条。" +
	"每条必须有 evidence：从用户消息中逐字摘取的连续原文（不超过 80 字）；给不出原文证据的条目不要输出。" +
	"禁止提取：助手回复中的内容、推测或演绎、情绪与临时状态、含糊表达，以及健康、心理、宗教、政治、性、财务困境等敏感类别和个人身份信息。" +
	"没有可提取内容时输出 []。不要输出数组以外的任何文字。"

func extractUserPrompt(userContent, assistantContent string) string {
	return "用户消息：\n" + userContent + "\n\n助手回复（仅供参考，禁止作为提取来源）：\n" + assistantContent
}

// normalizeExtractText collapses all whitespace so the evidence match is a
// verbatim-quote check that tolerates wrapping inside the prompt text.
func normalizeExtractText(s string) string {
	return strings.Join(strings.Fields(s), "")
}

// extractEvidenceOK reports whether evidence is a bounded short quote that
// really appears in the user message (assistant restatements never pass).
func extractEvidenceOK(evidence, userHaystack string) bool {
	quote := normalizeExtractText(evidence)
	if quote == "" || utf8.RuneCountInString(quote) > extractMaxEvidenceRunes {
		return false
	}
	return strings.Contains(userHaystack, quote)
}

// extractSensitive reports whether the summary touches a denied sensitive
// domain. The model output is untrusted; this deterministic list backs the
// prompt refusal. Only the offending item is dropped.
func extractSensitive(summary string) bool {
	for _, keyword := range extractSensitiveKeywords {
		if strings.Contains(summary, keyword) {
			return true
		}
	}
	return false
}

// extractSpeculative reports whether the summary opens with a hedge marker —
// the model guessing instead of the user stating.
func extractSpeculative(summary string) bool {
	for _, prefix := range extractHedgePrefixes {
		if strings.HasPrefix(summary, prefix) {
			return true
		}
	}
	return false
}

// extractSummaryPrefixes are the renderings the model may place in front of
// the verbatim user span: the third-person "用户", the user's own "我", or
// nothing. Any other leading word is a rewrite of the user's statement and is
// refused by the span check below.
var extractSummaryPrefixes = []string{"用户", "我", ""}

// extractFirstPersonAnchors are the words that, immediately before a span,
// bind its subject to the user. Matching is a plain suffix check on the text
// directly in front of the span, so "我的同事" never anchors across "的".
var extractFirstPersonAnchors = []string{"我自己", "本人", "我"}

// extractBoundaryRunes are the clause breaks after which a verbatim span may
// still open without an explicit first-person word (message start is handled
// separately). Whitespace never appears here: both texts are normalised.
var extractBoundaryRunes = []string{"，", "。", "！", "？", "；", "、"}

// extractAnchorOK reports whether the text immediately before haystack[idx:]
// keeps the span's subject on the user: a first-person word right in front
// (suffix match only, so "我的同事" does not anchor across "的"), a clause
// boundary, or the very start of the message.
func extractAnchorOK(haystack string, idx int) bool {
	if idx == 0 {
		return true
	}
	before := haystack[:idx]
	for _, anchor := range extractFirstPersonAnchors {
		if strings.HasSuffix(before, anchor) {
			return true
		}
	}
	for _, boundary := range extractBoundaryRunes {
		if strings.HasSuffix(before, boundary) {
			return true
		}
	}
	return false
}

// extractSummaryGrounded reports whether the summary lands on the user's own
// words: after whitespace normalisation it must be an optional "用户"/"我"
// prefix plus one verbatim contiguous span of the user message whose left
// boundary anchors the subject to the user. Rewording, reordering, added
// facts (no span) and subject drift ("我的同事…" — the span's neighbour is
// 同事, not 我) all fail and drop the item.
func extractSummaryGrounded(summary, userHaystack string) bool {
	for _, prefix := range extractSummaryPrefixes {
		rest, ok := strings.CutPrefix(summary, prefix)
		if !ok || rest == "" {
			continue
		}
		idx := strings.Index(userHaystack, rest)
		if idx >= 0 && extractAnchorOK(userHaystack, idx) {
			return true
		}
	}
	return false
}

// stripExtractFence removes one paired Markdown code fence from the model
// output: real providers frequently wrap the JSON array in ``` fences, and an
// unstripped payload would fail to parse and burn the bounded retries. After
// a TrimSpace, a leading fence line (``` plus an optional language tag) is
// dropped together with one trailing ```; exactly one pair is stripped, an
// unpaired or non-fence payload is returned unchanged, and a pure fence with
// no payload strips down to an empty string (still malformed).
func stripExtractFence(text string) string {
	s := strings.TrimSpace(text)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	head, rest, found := strings.Cut(s, "\n")
	if !found {
		return s
	}
	open := strings.TrimSpace(head)
	if open != "```" {
		tag := strings.TrimPrefix(open, "```")
		if tag == open || strings.Contains(tag, "`") {
			// Not a fence opener with an optional language tag.
			return s
		}
	}
	closing, ok := strings.CutSuffix(strings.TrimSpace(rest), "```")
	if !ok {
		return s
	}
	return strings.TrimSpace(closing)
}

// parseExtractOutput validates the model output server-side: it must be a
// JSON array, at most maxItems well-formed items survive, each with a
// non-empty summary within the rune clamp, a whitelisted category, no
// sensitive domain (summary span and evidence quote are both scanned), no
// speculative phrasing, an evidence quote that really occurs in the user
// message, and a summary that lands on the user's own words — an optional
// "用户"/"我" prefix plus one verbatim anchored span of the user message
// (see extractSummaryGrounded). Anything invalid is dropped. A payload
// that is not a JSON array returns (nil, false); an array — including an
// empty one — returns (items, true).
func parseExtractOutput(text string, maxItems int, userContent string) ([]extractItem, bool) {
	var items []extractItem
	if err := json.Unmarshal([]byte(stripExtractFence(text)), &items); err != nil {
		return nil, false
	}
	userHaystack := normalizeExtractText(userContent)
	out := make([]extractItem, 0, len(items))
	for _, item := range items {
		if len(out) >= maxItems {
			break
		}
		summary := strings.TrimSpace(item.Summary)
		if summary == "" || utf8.RuneCountInString(summary) > extractMaxSummaryRunes {
			continue
		}
		if extractSensitive(summary) || extractSensitive(normalizeExtractText(item.Evidence)) || extractSpeculative(summary) {
			continue
		}
		category := strings.ToUpper(strings.TrimSpace(item.Category))
		if _, ok := extractCategories[category]; !ok {
			continue
		}
		if !extractEvidenceOK(item.Evidence, userHaystack) {
			continue
		}
		if !extractSummaryGrounded(normalizeExtractText(summary), userHaystack) {
			continue
		}
		out = append(out, extractItem{Summary: summary, Category: category})
	}
	return out, true
}
