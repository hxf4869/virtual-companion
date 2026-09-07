package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
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
	// 个人标识（词表 + 下面的固定模式双保险，不无限扩表）
	"身份证", "证件号", "护照", "驾照", "驾驶证", "住址", "门牌", "手机号",
	"电话", "银行卡", "社保号", "邮箱", "微信号", "QQ号",
}

// extractIdentifierPatterns are the fixed-shape personal identifiers the
// keyword list cannot name: an email address, a mainland mobile number and an
// 18-digit id card number. They scan the same fields as the keyword list;
// nothing beyond these three shapes is matched.
var extractIdentifierPatterns = []*regexp.Regexp{
	regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`),
	regexp.MustCompile(`1[3-9][0-9]{9}`),
	regexp.MustCompile(`[0-9]{17}[0-9Xx]`),
}

// extractHedgePrefixes marks speculation: a summary opening with one of these
// is the model guessing, not the user stating, and is dropped.
var extractHedgePrefixes = []string{"可能", "也许", "大概", "好像", "似乎", "我猜", "听说", "据说"}

type extractItem struct {
	Summary  string `json:"summary"`
	Category string `json:"category"`
	Evidence string `json:"evidence"`
}

// extractDecision is the decision vocabulary of the V133 pre-flight
// transaction. "EXTRACTABLE" registers the attempt and allows the single
// bounded provider call; the rest are normal refusals the handler closes DONE
// (no outbound, no save), except CLAIM_LOST which fences the holder out.
const (
	extractDecisionExtractable  = "EXTRACTABLE"
	extractDecisionClaimLost    = "CLAIM_LOST"
	extractCloseClaimLost       = "EXTRACT_CLAIM_LOST"
	extractCloseModelIneligible = "SOURCE_NOT_MODEL_ELIGIBLE"
	extractClosePrepareFailed   = "EXTRACT_PREPARE"
	extractCloseProviderFailed  = "EXTRACT_PROVIDER"
	extractCloseMalformed       = "EXTRACT_MALFORMED"
	extractClosePersistFailed   = "EXTRACT_PERSIST"
	extractCloseSourceGuarded   = "MEMORY_SOURCE_GUARDED"
)

// extractAttemptStore is the narrow durable surface for the extraction attempt
// lifecycle: the claim-fenced pre-flight transaction before the provider call
// and the usage outcome after it. postgres.Store implements it.
type extractAttemptStore interface {
	PrepareMemoryExtractAttempt(ctx context.Context, owner, jobID, generationID int64, token, fence, providerID, supplierName, modelID string) (postgres.MemoryExtractPreparation, error)
	RecordMemoryExtractOutcome(ctx context.Context, owner, jobID, attemptID int64, out postgres.MemoryExtractOutcome) (int64, error)
}

// errExtractPayloadTooLarge is the fixed buffer-cap failure: the bounded call
// with MaxTokens 512 can never legitimately produce this much text, so the
// payload is refused, the usage that was already produced is settled (UNKNOWN
// — the aborted stream reports none) and the bounded retry applies.
var errExtractPayloadTooLarge = errors.New("memory extract: payload exceeds the fixed buffer cap")

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
	// The persisted egress fact: a blocked/cancelled turn's messages never
	// enter a provider request (V112), extraction included.
	if !input.ModelEligible {
		return l.closeExtract(ctx, c, "DONE", extractCloseModelIneligible)
	}

	// Resolve the model the same way generation does: first database route via
	// the closed factory, falling back to the process-level env provider when
	// no route is configured. Config failures are terminal, never retried.
	provider, closeProvider, identity, code := l.extractProvider(ctx)
	if code != "" {
		return l.closeExtract(ctx, c, "FAILED", code)
	}
	if closeProvider != nil {
		defer closeProvider()
	}

	// Pre-flight: one short claim-fenced transaction re-checks the auto-save
	// pref, deletion intent, consents + the actual outbound category
	// (MESSAGE_TEXT), turn extractability incl. model_eligible, and route
	// admission, then registers the attempt. No transaction or row lock is
	// held across the provider I/O below.
	attempts, ok := l.store.(extractAttemptStore)
	if !ok {
		return l.closeExtract(ctx, c, "FAILED", extractClosePrepareFailed)
	}
	prep, err := attempts.PrepareMemoryExtractAttempt(ctx, c.OwnerID, c.JobID, c.RefID,
		c.Token, c.Fence, identity.providerID, identity.supplierName, identity.modelID)
	if err != nil {
		return l.failExtract(ctx, c, extractClosePrepareFailed)
	}
	if prep.Decision != extractDecisionExtractable {
		if prep.Decision == extractDecisionClaimLost {
			// The close is fenced out; the claim ages out through lease
			// recovery. No outbound, no retry burn.
			return l.closeExtract(ctx, c, "FAILED", extractCloseClaimLost)
		}
		return l.closeExtract(ctx, c, "DONE", prep.Decision)
	}

	// Best-effort cancel on account deletion: the shared registry is
	// owner-keyed via CancelOwner. The extraction registers under its own
	// MEMORY_EXTRACT key space (kind + job id), disjoint from GENERATION ids;
	// the durable write phase stays protected by the V128 barrier either way.
	payload := prep.PriorPayload
	items, parsed := parseExtractOutput(payload, extractMaxItems, input.UserContent)
	if payload == "" {
		callCtx, cancel := context.WithCancel(ctx)
		l.cancels.Register(KindMemoryExtract, c.OwnerID, c.JobID, cancel)
		var result companion.AttemptResult
		var callErr error
		payload, result, callErr = l.callExtractProvider(callCtx, provider, input)
		cancel()
		l.cancels.Unregister(KindMemoryExtract, c.JobID)
		// Settle the attempt in one short transaction: real usage or an
		// explicit UNKNOWN — never zero for a missing report. A payload that
		// is not a JSON array settles its usage but is not stored as the
		// replayable output: a retry then makes a fresh model call, while a
		// parse-valid payload whose local save later failed replays without
		// one (T-26 — only the local save skips the model).
		items, parsed = parseExtractOutput(payload, extractMaxItems, input.UserContent)
		outcome := extractOutcome(result, callErr, payload)
		if !parsed {
			outcome.OutputPayload = ""
		} else {
			// Only the minimal accepted entries persist for the replay path:
			// the raw model output (fences, dropped items, unknown fields) is
			// never written, and the store encrypts this JSON at rest.
			outcome.OutputPayload = extractReplayPayload(items)
		}
		if _, recErr := attempts.RecordMemoryExtractOutcome(ctx, c.OwnerID, c.JobID, prep.AttemptID, outcome); recErr != nil {
			l.log.Info("memory extract outcome",
				slog.String("operation", "memory_extract"),
				slog.String("outcome", "error"),
				slog.String("error_code", "EXTRACT_OUTCOME_FAILED"),
			)
		}
		if callErr != nil {
			if errors.Is(callErr, errExtractPayloadTooLarge) {
				return l.failExtract(ctx, c, extractCloseMalformed)
			}
			return l.failExtract(ctx, c, extractCloseProviderFailed)
		}
		if !parsed {
			// The payload was not a JSON array at all: treat it as a failed
			// bounded call, not as "nothing to extract".
			return l.failExtract(ctx, c, extractCloseMalformed)
		}
	} else if !parsed {
		// A stored output was written only after a successful parse, so this
		// means the stored payload no longer parses: fail the run instead of
		// reading it as an empty result.
		return l.failExtract(ctx, c, extractCloseMalformed)
	}
	if len(items) == 0 {
		return l.closeExtract(ctx, c, "DONE", "")
	}

	// The evidence binds the user source message only: the assistant message
	// is not an extraction source, and the V57 tombstone flip on this ref is
	// what re-suppresses the source after a deletion.
	evidence := []string{
		fmt.Sprintf("message:%d", *input.SourceMessageID),
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
				return l.closeExtract(ctx, c, "FAILED", extractCloseSourceGuarded)
			}
			// A transient local save failure retries WITHOUT a second model
			// call: the prepared attempt's stored payload is replayed through
			// the parser on the next run.
			return l.failExtract(ctx, c, extractClosePersistFailed)
		}
	}
	return l.closeExtract(ctx, c, "DONE", "")
}

// extractReplayPayload renders the accepted items as the minimal replayable
// record: exactly the validated {summary,category,evidence} entries, nothing
// else from the model output. A retry whose local save failed parses this
// JSON back into the same accepted items without a second model call; the
// store persists it encrypted at rest like every other stored message field.
func extractReplayPayload(items []extractItem) string {
	encoded, err := json.Marshal(items)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// extractOutcome maps one provider call to the write-once attempt outcome.
// A zero AttemptResult (the contract on error) or a result without usage
// records UNKNOWN — usage missing is never usage zero.
func extractOutcome(result companion.AttemptResult, callErr error, payload string) postgres.MemoryExtractOutcome {
	out := postgres.MemoryExtractOutcome{OutputPayload: payload}
	if callErr != nil {
		out.Status = "FAILED"
		if errors.Is(callErr, context.Canceled) || companion.Is(callErr, companion.CodeCanceled) {
			out.Status = "CANCELLED"
		}
		out.FailureCode = extractFailureCode(callErr)
		return out
	}
	out.Status = "SUCCEEDED"
	if result.Usage.InputTokens > 0 || result.Usage.OutputTokens > 0 {
		in, outTok := result.Usage.InputTokens, result.Usage.OutputTokens
		out.InputTokens = &in
		out.OutputTokens = &outTok
	}
	return out
}

// extractFailureCode maps a provider failure to the closed attempt failure
// vocabulary the V133 outcome record accepts.
func extractFailureCode(err error) string {
	if errors.Is(err, errExtractPayloadTooLarge) {
		return "RESPONSE_TOO_LARGE"
	}
	if companion.Is(err, companion.CodeTimeout) {
		switch companion.AsError(err).Phase {
		case companion.TimeoutConnect:
			return "TIMEOUT_CONNECT"
		case companion.TimeoutFirstToken:
			return "TIMEOUT_FIRST_TOKEN"
		case companion.TimeoutTotal:
			return "TIMEOUT_TOTAL"
		}
	}
	switch {
	case companion.Is(err, companion.CodeRateLimited):
		return "HTTP_429"
	case companion.Is(err, companion.CodeUpstreamUnavailable):
		return "HTTP_5XX"
	case companion.Is(err, companion.CodeDisconnected), companion.Is(err, companion.CodeMalformed):
		return "DISCONNECTED"
	default:
		return "OTHER"
	}
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

// extractProviderIdentity is the outbound identity recorded with the attempt:
// the database route's provider when one is configured, otherwise the
// process-level env provider defaults.
type extractProviderIdentity struct {
	providerID   string
	supplierName string
	modelID      string
}

// extractProvider resolves the bounded call's provider with the generation
// admission semantics: the first database route (single route, no multi-route
// retry) built through the closed factory, or the process-level env provider
// when no route exists. The returned close func is non-nil only for
// route-built providers; a non-empty code is a terminal failure reason.
func (l *Loop) extractProvider(ctx context.Context) (companion.Provider, func(), extractProviderIdentity, string) {
	identity := extractProviderIdentity{
		providerID:   l.policy.ProviderID,
		supplierName: l.policy.SupplierName,
		modelID:      l.policy.ModelID,
	}
	routes, err := l.resolveGenerationRoutes(ctx)
	if err != nil {
		l.log.Error("provider route read failed",
			slog.String("operation", "provider_route_read"),
			slog.String("outcome", "error"),
			slog.String("error_code", "PROVIDER_CONFIG_UNAVAILABLE"),
		)
		return nil, nil, identity, "PROVIDER_CONFIG_UNAVAILABLE"
	}
	if len(routes) > 0 {
		if l.providerFactory == nil {
			return nil, nil, identity, "PROVIDER_CONFIG_UNAVAILABLE"
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
			return nil, nil, identity, "PROVIDER_CONFIG_INVALID"
		}
		closeFn := func() {
			if closer, ok := provider.(interface{ Close() }); ok {
				closer.Close()
			}
		}
		return provider, closeFn, extractProviderIdentity{
			providerID: route.ProviderID, supplierName: route.SupplierName, modelID: route.ModelID,
		}, ""
	}
	if l.provider == nil {
		return nil, nil, identity, "PROVIDER_DISABLED"
	}
	return l.provider, nil, identity, ""
}

// extractMaxResponseBytes caps the in-process extraction buffer at the call
// point. The provider adapters already bound response bytes themselves
// (config-validated, hard cap 1 MiB); this second fixed cap keeps the
// accumulation bounded for any Provider implementation and gives the failure
// an explainable shape: a payload this large cannot be a valid extraction
// array for a call capped at extractMaxTokens.
const extractMaxResponseBytes = 64 << 10

// callExtractProvider makes the single bounded model call — one call per
// attempt, no internal retry. Only the authorized user message goes out: the
// assistant reply is not an extraction source and is not sent. Text is
// buffered in memory under a fixed cap; nothing is logged or streamed onward.
// The AttemptResult carries the provider-reported usage (zero on error).
func (l *Loop) callExtractProvider(ctx context.Context, provider companion.Provider, input postgres.MemoryExtractInput) (string, companion.AttemptResult, error) {
	callCtx, cancel := context.WithTimeout(ctx, extractTotalTimeout)
	defer cancel()
	var out strings.Builder
	// capped is set by this handler-owned sink when the fixed buffer cap
	// fires. The real adapters classify a sink error (classifyEmit and
	// classifyParse) into a companion error and drop the inner sentinel, so
	// the cap fact must be judged from this local state after the call
	// returns — the classification never depends on the sentinel surviving
	// the adapter's error mapping, and the adapter stays untouched.
	capped := false
	result, err := provider.Stream(callCtx, companion.ModelRequest{
		Messages: []companion.Message{
			{Role: companion.RoleSystem, Content: extractSystemPrompt},
			{Role: companion.RoleUser, Content: extractUserPrompt(input.UserContent)},
		},
		Stream: false,
		Timeouts: companion.TimeoutBudget{
			Connect:    extractConnectTimeout,
			FirstToken: extractFirstTokenTimeout,
			Total:      extractTotalTimeout,
		},
		MaxTokens: extractMaxTokens,
	}, func(d companion.OutputDelta) error {
		if out.Len()+len(d.Text) > extractMaxResponseBytes {
			capped = true
			return errExtractPayloadTooLarge
		}
		out.WriteString(d.Text)
		return nil
	})
	if capped {
		// The aborted stream reports no usage: the outcome settles UNKNOWN and
		// the handler maps the sentinel to RESPONSE_TOO_LARGE.
		return "", companion.AttemptResult{}, errExtractPayloadTooLarge
	}
	if err != nil {
		// The provider contract returns a zero AttemptResult on error: the
		// outcome settles UNKNOWN.
		return "", companion.AttemptResult{}, err
	}
	return out.String(), result, nil
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

// extractSystemPrompt states exactly the contract the server validates: the
// summary is the subject marker (用户) plus one verbatim contiguous span of
// the user message (a minimal rewrite adds nothing), and the evidence is a
// verbatim user quote covering that same span. Refusals mirror
// extractSensitive/extractSubjectOK: third-person or reported statements,
// conditionals, questions, moods, sensitive domains and personal identifiers
// are never extracted, and the deterministic checks drop anything the prompt
// only discourages.
const extractSystemPrompt = "你是记忆提取器。只从用户消息中提取用户明确表达的普通偏好与明确事实。" +
	"只输出一个 JSON 数组，元素形如 {\"summary\":\"一句话陈述\",\"category\":\"PREFERENCE|FACT\",\"evidence\":\"用户消息中的原文短引\"}，最多 3 条。" +
	"summary 必须以「用户」开头，后面是用户消息里的连续原文片段（最小改写）：不得改写措辞、不得调整语序、不得新增原句没有表达的内容。" +
	"每条必须有 evidence：从用户消息中逐字摘取的连续原文（不超过 80 字），并且必须完整包含 summary 对应的那段原文；给不出则不要输出该条。" +
	"禁止提取：第三人称转述（他人说的内容）、条件句（如「如果……」）、疑问句、否定含义不清的句子、推测或演绎、" +
	"情绪与临时状态、含糊表达，以及健康、心理、宗教、政治、性、财务困境等敏感类别和邮箱、电话、证件号等个人身份信息。" +
	"没有可提取内容时输出 []。不要输出数组以外的任何文字。"

// extractUserPrompt sends only the authorized user message. The assistant
// reply is deliberately absent: it is not an extraction source, so it must
// not enter the outbound payload either.
func extractUserPrompt(userContent string) string {
	return "用户消息：\n" + userContent
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
// domain or carries a fixed-shape personal identifier. The model output is
// untrusted; this deterministic check backs the prompt refusal. Only the
// offending item is dropped.
func extractSensitive(s string) bool {
	if containsAny(s, extractSensitiveKeywords) {
		return true
	}
	for _, pattern := range extractIdentifierPatterns {
		if pattern.MatchString(s) {
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

// extractSummaryPrefixes are the renderings the model must place in front of
// the verbatim user span: the third-person "用户" or the user's own "我". A
// bare span with no subject marker is refused — every accepted summary names
// its subject explicitly, so a third-person statement can never slip through
// as the user's own.
var extractSummaryPrefixes = []string{"用户", "我"}

// extractFirstPersonAnchors are the words that, immediately before a span,
// bind its subject to the user. Matching is a plain suffix check on the text
// directly in front of the span, so "我的同事" never anchors across "的".
var extractFirstPersonAnchors = []string{"我自己", "本人", "我"}

// extractClauseRunes are the breaks after which a new clause starts. They no
// longer prove the subject by themselves: a clause-start span additionally
// needs an explicit first-person subject earlier in the same sentence (see
// extractSubjectOK). "：" opens a clause after a lead-in ("测试轮次：…").
var extractClauseRunes = []string{"，", "。", "！", "？", "；", "、", "："}

// extractSentenceRunes end a sentence; the subject check below never reaches
// across them, so subject ellipsis after a full stop does not auto-anchor.
var extractSentenceRunes = "。！？"

// extractConditionalMarkers poison a sentence: a preference or fact stated
// inside a conditional clause ("如果…想去…") is not a standing one, so the
// whole sentence is refused as an anchor context.
var extractConditionalMarkers = []string{"如果", "假如", "假使", "假设", "要是", "万一", "倘若", "若是"}

// extractReportedSpeechMarkers mark third-person attribution ("同事说…").
// Between the last first-person anchor and the span none of these may appear,
// so a reported clause cannot borrow an earlier 我 as its subject.
var extractReportedSpeechMarkers = []string{"说", "提到", "认为", "觉得", "告诉", "转述", "建议", "推荐"}

// extractNegationMarkers mark an unclear negated statement around the span: a
// span opening with one ("我讨厌辣，不是喜欢喝茶" — 不是喜欢喝茶 opens the
// second clause and asserts what the user denied), or one sitting in the
// anchored span's clause directly in front of it. A bare 不 stays allowed so
// plain negative preferences ("我不喜欢熬夜") keep extracting.
var extractNegationMarkers = []string{"不是", "并不", "不太", "没有"}

// extractClauseRuneSet is extractClauseRunes as one rune set for membership
// checks while walking back to the span's clause start.
var extractClauseRuneSet = strings.Join(extractClauseRunes, "")

func hasSuffixAny(s string, suffixes []string) bool {
	for _, suffix := range suffixes {
		if strings.HasSuffix(s, suffix) {
			return true
		}
	}
	return false
}

func hasPrefixAny(s string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(s, prefix) {
			return true
		}
	}
	return false
}

// extractSpanSentence returns the part of haystack from the start of the
// sentence containing offset idx up to idx. Subject checks never reach across
// a sentence terminator (。！？).
func extractSpanSentence(haystack string, idx int) string {
	before := haystack[:idx]
	start := 0
	for pos, r := range before {
		if strings.ContainsRune(extractSentenceRunes, r) {
			start = pos + utf8.RuneLen(r)
		}
	}
	return before[start:]
}

// extractSpanClause returns the span's clause prefix: from after the last
// clause break up to idx.
func extractSpanClause(haystack string, idx int) string {
	before := haystack[:idx]
	start := 0
	for pos, r := range before {
		if strings.ContainsRune(extractClauseRuneSet, r) {
			start = pos + utf8.RuneLen(r)
		}
	}
	return before[start:]
}

func containsAny(s string, needles []string) bool {
	for _, needle := range needles {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

// extractSubjectOK reports whether the span at haystack[idx:] is bound to the
// user. Three anchors qualify, and nothing else does:
//   - the span starts the message (the message is the user's own statement),
//   - a first-person word sits immediately in front of the span ("我的同事"
//     still never anchors across "的"), or
//   - the span opens a clause of a sentence that names the user before the
//     span ("我住在杭州，喜欢清晨散步" — the second clause keeps the subject)
//     with no conditional marker anywhere in the sentence and no
//     reported-speech marker between that 我 and the span.
//
// The refusal contexts apply to the immediate-anchor path too: a span whose
// own clause carries a conditional ("如果我喜欢喝咖啡"), embedded reported
// speech ("妈妈说我应该早睡") or a negation marker in front of it
// ("那不是我喜欢喝茶") never anchors, and a span opening with a negation
// marker ("不是喜欢喝茶") is refused on every path. Anything undeterminable
// is refused: the item is dropped.
func extractSubjectOK(haystack string, idx int) bool {
	if hasPrefixAny(haystack[idx:], extractNegationMarkers) {
		// The span itself opens with the negation: the summary would assert
		// what the user denied.
		return false
	}
	if idx == 0 {
		return true
	}
	before := haystack[:idx]
	if hasSuffixAny(before, extractFirstPersonAnchors) {
		// The immediate anchor binds the subject, but the span's own clause
		// can still poison the statement — the same refusal contexts the
		// clause path applies below.
		if containsAny(extractSpanSentence(haystack, idx), extractConditionalMarkers) {
			return false
		}
		clause := extractSpanClause(haystack, idx)
		return !containsAny(clause, extractReportedSpeechMarkers) &&
			!containsAny(clause, extractNegationMarkers)
	}
	if !hasSuffixAny(before, extractClauseRunes) {
		return false
	}
	sentence := extractSpanSentence(haystack, idx)
	if containsAny(sentence, extractConditionalMarkers) {
		return false
	}
	// Latest non-possessive first-person anchor in the sentence. "我的同事"
	// skips its 我 (possessive) and keeps looking backwards.
	anchorEnd := -1
	for _, anchor := range extractFirstPersonAnchors {
		for pos := strings.LastIndex(sentence, anchor); pos >= 0; pos = strings.LastIndex(sentence[:pos], anchor) {
			end := pos + len(anchor)
			if end < len(sentence) && strings.HasPrefix(sentence[end:], "的") {
				continue
			}
			if end > anchorEnd {
				anchorEnd = end
			}
			break
		}
	}
	if anchorEnd < 0 {
		return false
	}
	return !containsAny(sentence[anchorEnd:], extractReportedSpeechMarkers)
}

// extractSummaryGrounded reports whether the summary lands on the user's own
// words: after whitespace normalisation it must be an explicit "用户"/"我"
// prefix plus one verbatim contiguous span of the user message whose left
// boundary binds the subject to the user (see extractSubjectOK). Rewording,
// reordering, added facts (no span), a missing subject marker and subject
// drift all fail and drop the item. The matched span is returned so the
// evidence can be bound to the same statement.
func extractSummaryGrounded(summary, userHaystack string) (string, bool) {
	for _, prefix := range extractSummaryPrefixes {
		rest, ok := strings.CutPrefix(summary, prefix)
		if !ok || rest == "" {
			continue
		}
		idx := strings.Index(userHaystack, rest)
		if idx >= 0 && extractSubjectOK(userHaystack, idx) {
			return rest, true
		}
	}
	return "", false
}

// extractEvidenceBindsSummary reports whether the evidence quote corroborates
// the summary's span: after normalisation one must contain the other (an
// equal quote, a shorter quote of the span, or the span plus local context).
// Two unrelated fragments that both occur in the user message never bind.
func extractEvidenceBindsSummary(evidenceNorm, span string) bool {
	if evidenceNorm == "" || span == "" {
		return false
	}
	return strings.Contains(evidenceNorm, span) || strings.Contains(span, evidenceNorm)
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

// parseExtractOutput validates the model output server-side: the payload must
// be a JSON array (`null` decodes into a nil slice without an error, so the
// leading "[" is checked explicitly; a non-array object or broken JSON fails
// the unmarshal), and at most maxItems well-formed items survive, each with a
// non-empty summary within the rune clamp, a whitelisted category, no
// sensitive domain or personal identifier (summary span and evidence quote
// are both scanned), no speculative phrasing, an evidence quote that really
// occurs in the user message AND covers the same statement the summary lands
// on, and a summary that is an explicit "用户"/"我" prefix plus one verbatim
// span of the user message whose left boundary binds the subject to the user
// (see extractSubjectOK). Anything invalid is dropped. A payload that is not
// a JSON array returns (nil, false); an array — including an empty one —
// returns (items, true).
func parseExtractOutput(text string, maxItems int, userContent string) ([]extractItem, bool) {
	payload := stripExtractFence(text)
	if payload == "" || !strings.HasPrefix(payload, "[") {
		return nil, false
	}
	var items []extractItem
	if err := json.Unmarshal([]byte(payload), &items); err != nil {
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
		span, grounded := extractSummaryGrounded(normalizeExtractText(summary), userHaystack)
		if !grounded {
			continue
		}
		if !extractEvidenceBindsSummary(normalizeExtractText(item.Evidence), span) {
			continue
		}
		// The evidence travels with the item: the stored replay payload is the
		// minimal accepted entries, and a replayed run must validate to the
		// same set without the original model output.
		out = append(out, extractItem{Summary: summary, Category: category, Evidence: item.Evidence})
	}
	return out, true
}
