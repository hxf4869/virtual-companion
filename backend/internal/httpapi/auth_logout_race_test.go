package httpapi

// VC-R12 证据阶段：普通登出「迟到响应」与新登录的服务端竞态。
//
// 现有 auth_http_test.go 全部用 httptest.ResponseRecorder 直调 handler，
// 并以手工维护的 map 充当 cookie jar，因此看不到 Set-Cookie 对真实
// cookiejar 的作用。本文件改用 httptest.NewServer + net/http/cookiejar
// 的真实 HTTP 视角取证：
//
//   - 竞态回归护栏：普通 logout 的服务端撤销若先完成、响应后到达客户端
//     （闸门模拟迟到），响应也不得影响较新一次登录建立的会话。VC-R12
//     定稿前，迟到的 Max-Age=0 Set-Cookie 会在真实 cookiejar 上删掉较新
//     登录的 vc_session（当时为红）；定稿后 logout 响应不再携带任何
//     Set-Cookie，本测试转为绿的回归护栏。
//   - 正向证明：旧 token 服务端撤销语义、正常 logout 契约（200 且无
//     Set-Cookie，遗留 Cookie 为惰性死 token）、trusted-device 保留语义。
//
// 安全约束：任何 cookie/token/CSRF 的值都不进入日志与断言消息；
// 断言只使用状态码、布尔、长度与字段存在性。

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// logoutGate 仅拦截 POST /api/v1/auth/logout：先把请求交给真实 handler 写入
// ResponseRecorder（此刻服务端撤销已完成、Set-Cookie 已捕获），向测试发出
// 「服务端已撤销」信号，阻塞等待 release，最后把 Recorder 的状态码、全部
// 响应头（含多条 Set-Cookie）与响应体原样转发给真实客户端。
type logoutGate struct {
	inner   http.Handler
	revoked chan struct{}
	release chan struct{}
	once    sync.Once
}

func newLogoutGate(inner http.Handler) *logoutGate {
	return &logoutGate{
		inner:   inner,
		revoked: make(chan struct{}, 1),
		release: make(chan struct{}),
	}
}

func (g *logoutGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/api/v1/auth/logout" {
		g.inner.ServeHTTP(w, r)
		return
	}
	rec := httptest.NewRecorder()
	// 真实 handler 同步执行完毕：撤销与清除 Cookie 的决定已经做出。
	g.inner.ServeHTTP(rec, r)
	// 通知测试「服务端已撤销」，非阻塞发送，channel 容量为 1。
	select {
	case g.revoked <- struct{}{}:
	default:
	}
	// 阻塞等待测试放行；超时兜底防止测试逻辑异常时永久挂起连接。
	select {
	case <-g.release:
	case <-time.After(15 * time.Second):
	}
	// 原样转发：先复制全部响应头（Set-Cookie 可能有多条），再写状态码与响应体。
	dst := w.Header()
	for k, vv := range rec.Header() {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
	w.WriteHeader(rec.Code)
	_, _ = w.Write(rec.Body.Bytes())
}

// letThrough 放行被闸门阻塞的 logout 响应；sync.Once 保证幂等，
// t.Cleanup 兜底调用，避免异常路径下 httptest.Server.Close 卡死。
func (g *logoutGate) letThrough() {
	g.once.Do(func() { close(g.release) })
}

// pageAccountTransport 模拟「页面已知账号」的前置条件头：真实浏览器中页面
// 知道自己渲染的 auth.accountId，并在请求上携带 X-VC-Expected-Account-ID；
// 完成一次新登录后，页面已知账号随之更新。Cookie 仍由真实 cookiejar 维护，
// transport 只负责在请求发出前附加当前已知账号的头。
type pageAccountTransport struct {
	mu   sync.Mutex
	id   string
	base http.RoundTripper
}

func (t *pageAccountTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.mu.Lock()
	id := t.id
	base := t.base
	t.mu.Unlock()
	if id != "" && req.Header.Get(expectedAccountHeader) == "" {
		req = req.Clone(req.Context())
		req.Header.Set(expectedAccountHeader, id)
	}
	return base.RoundTrip(req)
}

// setAccount 记录页面当前已知账号（登录 200 响应中的 accountId）。
func (t *pageAccountTransport) setAccount(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.id = id
}

// newRealBrowserClient 返回使用独立真实 cookiejar、并带 page-account
// transport 的真实 client；页面已知账号在登录完成处由
// realNoteLoginAccount 更新。
func newRealBrowserClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("创建 cookiejar 失败: %v", err)
	}
	return &http.Client{
		Jar:     jar,
		Timeout: 10 * time.Second,
		Transport: &pageAccountTransport{
			base: http.DefaultTransport,
		},
	}
}

// realNoteLoginAccount 从登录完成的 200 响应体解析 accountId 并更新页面
// 已知账号；client 未使用 page-account transport 时为空操作。
func realNoteLoginAccount(client *http.Client, body string) {
	if pt, ok := client.Transport.(*pageAccountTransport); ok {
		var identity sessionIdentityJSON
		if err := json.Unmarshal([]byte(body), &identity); err == nil && identity.AccountID != "" {
			pt.setAccount(identity.AccountID)
		}
	}
}

// newRealAuthServer 用真实 TCP 服务器包住核心 handler（Server.Handler()
// 返回标准 http.Handler），并返回一个使用独立 cookiejar 的真实 client。
func newRealAuthServer(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	s := newCoreServer(t, "full", newMemStore())
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, newRealBrowserClient(t)
}

// realHTTPResult 是 realJSON 的完整返回形态；setCookies 只统计响应携带的
// Set-Cookie 条数（不取值），供 VC-R12 护栏断言「logout 响应不带任何
// Set-Cookie」使用。
type realHTTPResult struct {
	code       int
	setCookies int
	body       string
}

// doRealJSON 经真实 client 发送 JSON 请求，返回状态码、Set-Cookie 条数
// 与响应体；realJSON 是它的薄包装。不调用 t.Fatal，便于在非测试
// goroutine 中使用。
func doRealJSON(client *http.Client, base, method, path, body string) (realHTTPResult, error) {
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, base+path, rdr)
	if err != nil {
		return realHTTPResult{}, err
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if isStateChanging(method) {
		// 服务端允许列表仅 https://vc.test（见 newCoreServer 的
		// VC_HTTP_ORIGINS）；缺省无 Origin 会被 403 拒绝。
		req.Header.Set("Origin", "https://vc.test")
		if client.Jar != nil {
			if u, perr := url.Parse(base); perr == nil {
				for _, c := range client.Jar.Cookies(u) {
					if c.Name == csrfCookie && c.Value != "" {
						req.Header.Set(csrfHeader, c.Value)
						break
					}
				}
			}
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return realHTTPResult{}, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return realHTTPResult{code: resp.StatusCode}, err
	}
	return realHTTPResult{
		code:       resp.StatusCode,
		setCookies: len(resp.Header.Values("Set-Cookie")),
		body:       string(b),
	}, nil
}

// realJSON 是 doRealJSON 的薄包装，返回状态码与响应体。
func realJSON(client *http.Client, base, method, path, body string) (int, string, error) {
	res, err := doRealJSON(client, base, method, path, body)
	return res.code, res.body, err
}

// realFullLogin 用真实 client 走完整登录链：密码步 → authenticator-setup →
// authenticator-confirm（固定测试验证码），Cookie 全部由真实 jar 维护。
func realFullLogin(t *testing.T, client *http.Client, base, username string, trustDevice bool) {
	t.Helper()
	email := username
	if !strings.Contains(email, "@") {
		email += "@example.com"
	}
	code, body, err := realJSON(client, base, http.MethodPost, "/api/v1/auth/login",
		`{"account":"`+email+`","password":"`+testPassword+`"}`)
	if err != nil {
		t.Fatalf("login 请求失败: %v", err)
	}
	if code != http.StatusAccepted {
		t.Fatalf("login 第一步状态码 = %d, 期望 202", code)
	}
	var next authNextStepJSON
	if err := json.Unmarshal([]byte(body), &next); err != nil {
		t.Fatalf("login 响应解析失败: %v", err)
	}
	if next.NextStep != "AUTHENTICATOR_SETUP_REQUIRED" || !validChallengeID(next.ChallengeID) {
		t.Fatalf("login 下一步 = %q, 期望 AUTHENTICATOR_SETUP_REQUIRED 且带有效 challengeId", next.NextStep)
	}
	code, _, err = realJSON(client, base, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/authenticator-setup", "")
	if err != nil {
		t.Fatalf("authenticator-setup 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("authenticator-setup 状态码 = %d, 期望 200", code)
	}
	trust := "false"
	if trustDevice {
		trust = "true"
	}
	code, body, err = realJSON(client, base, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/authenticator-confirm",
		`{"code":"123456","trustDevice":`+trust+`}`)
	if err != nil {
		t.Fatalf("authenticator-confirm 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("authenticator-confirm 状态码 = %d, 期望 200", code)
	}
	// 登录完成：页面已知账号更新为响应中的 accountId。
	realNoteLoginAccount(client, body)
}

// realCookieValue 读取真实 cookiejar 中指定名称的 Cookie 值（只用于
// 存在性/相等性断言，绝不打印返回值）。
func realCookieValue(client *http.Client, base, name string) string {
	if client.Jar == nil {
		return ""
	}
	u, err := url.Parse(base)
	if err != nil {
		return ""
	}
	for _, c := range client.Jar.Cookies(u) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

// realGetWithExplicitCookie 用显式 Cookie 头（不经过 cookiejar）发起
// GET /api/v1/auth/session，用于验证某个旧 token 在服务端的撤销状态。
func realGetWithExplicitCookie(base, name, value string) (int, error) {
	req, err := http.NewRequest(http.MethodGet, base+"/api/v1/auth/session", nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Cookie", name+"="+value)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

// TestVC12LateLogoutResponseDropsNewerSessionCookie 是 VC-R12 竞态回归
// 护栏：普通 logout 的服务端撤销先完成、响应被闸门延迟，期间同一浏览器
// 完成一次新登录；VC-R12 定稿前，迟到的 logout 响应携带 Max-Age=0 的
// Set-Cookie，会在真实 cookiejar 上删掉较新登录的会话 Cookie（红证据）；
// 定稿后 logout 响应不带任何 Set-Cookie，较新登录必须保持登录态。
func TestVC12LateLogoutResponseDropsNewerSessionCookie(t *testing.T) {
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	gate := newLogoutGate(s.Handler())
	ts := httptest.NewServer(gate)
	t.Cleanup(ts.Close)
	t.Cleanup(gate.letThrough)

	client := newRealBrowserClient(t)

	// 1) alice 完整登录，真实 jar 持有 A 的 vc_session/vc_csrf。
	realFullLogin(t, client, ts.URL, "alice", false)
	aliceToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if aliceToken == "" {
		t.Fatal("alice 登录后真实 cookiejar 缺少 vc_session")
	}

	// 2) 后台 goroutine 经真实 client 发出普通 logout。
	type logoutResult struct {
		code int
		err  error
	}
	logoutDone := make(chan logoutResult, 1)
	go func() {
		code, _, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/logout", "")
		logoutDone <- logoutResult{code: code, err: err}
	}()

	// 3) 等待「服务端已撤销」信号：此刻 A 的会话已在服务端撤销，
	//    清除 Cookie 的 Set-Cookie 已被闸门捕获但尚未到达客户端。
	select {
	case <-gate.revoked:
	case <-time.After(5 * time.Second):
		t.Fatal("logout 请求未到达服务端（闸门未触发）")
	}

	// 4) 同一 jar 完成一次新登录（第二账号 bob），换取新的会话 Cookie。
	realFullLogin(t, client, ts.URL, "bob", false)
	bobToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if bobToken == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_session")
	}
	if bobToken == aliceToken {
		t.Fatal("新登录未换发新的 vc_session（新旧值相同）")
	}

	// 5) 放行闸门，等待 logout 响应送达客户端（应为 200）。
	gate.letThrough()
	select {
	case res := <-logoutDone:
		if res.err != nil {
			t.Fatalf("logout 请求失败: %v", res.err)
		}
		if res.code != http.StatusOK {
			t.Errorf("logout 状态码 = %d, 期望 200", res.code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("等待 logout 响应超时")
	}

	// 6) 护栏断言：迟到的 logout 响应不得影响较新登录——VC-R12 定稿前
	//    迟到响应携带的过期 Set-Cookie 会删掉较新登录的 vc_session，
	//    使 GET session 变成 401（红）；现在 logout 响应不带任何
	//    Set-Cookie，GET session 必须保持 200。
	code, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("竞态回归护栏：普通 logout 迟到响应影响了较新登录；"+
			"GET /api/v1/auth/session 状态码 = %d, 期望 200", code)
	}

	// 对照（应当满足）：A 的旧 token 在服务端确实已撤销——
	// 用显式 Cookie 头（不走 jar）携带旧值请求 session，必须 401。
	codeA, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if codeA != http.StatusUnauthorized {
		t.Errorf("旧会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeA)
	}
}

// TestVC12RevokedSessionTokenStaysRejected 正向证明 a：普通 logout 完成后，
// 被撤销的旧 vc_session 即使脱离 cookiejar、以显式 Cookie 头重放，
// 服务端也必须拒绝（401），即撤销发生在服务端而非仅靠清 Cookie。
func TestVC12RevokedSessionTokenStaysRejected(t *testing.T) {
	ts, client := newRealAuthServer(t)
	realFullLogin(t, client, ts.URL, "alice", false)
	oldToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if oldToken == "" {
		t.Fatal("登录后真实 cookiejar 缺少 vc_session")
	}
	code, _, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/logout", "")
	if err != nil {
		t.Fatalf("logout 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("logout 状态码 = %d, 期望 200", code)
	}
	replay, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, oldToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if replay != http.StatusUnauthorized {
		t.Errorf("撤销后的旧 token 重放状态码 = %d, 期望 401", replay)
	}
}

// TestVC12PlainLogoutEndsSessionOverRealJar 正向证明 b：无闸门的正常
// 普通 logout 仍是登出契约（VC-R12 定稿语义）——响应 200 且不携带任何
// Set-Cookie；jar 中遗留的 vc_session 是惰性死 token，登出证明落在
// 服务端：同 jar 随后的 GET session 为 401。
func TestVC12PlainLogoutEndsSessionOverRealJar(t *testing.T) {
	ts, client := newRealAuthServer(t)
	realFullLogin(t, client, ts.URL, "alice", false)
	if realCookieValue(client, ts.URL, auth.SessionCookieName) == "" {
		t.Fatal("登录后真实 cookiejar 缺少 vc_session")
	}
	logout, err := doRealJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/logout", "")
	if err != nil {
		t.Fatalf("logout 请求失败: %v", err)
	}
	if logout.code != http.StatusOK {
		t.Fatalf("logout 状态码 = %d, 期望 200", logout.code)
	}
	// VC-R12 回归护栏：logout 响应不得携带任何 Set-Cookie（只计数，不取值）。
	if logout.setCookies != 0 {
		t.Errorf("logout 响应携带 Set-Cookie 头 %d 条, 期望 0 条", logout.setCookies)
	}
	// 响应不清 Cookie：jar 中遗留的 vc_session 是惰性死 token。
	if realCookieValue(client, ts.URL, auth.SessionCookieName) == "" {
		t.Error("logout 不清 Cookie 时真实 cookiejar 中应遗留 vc_session（惰性死 token）")
	}
	// 登出证明落在服务端：同 jar 携带死 token 请求 session 必须 401。
	after, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if after != http.StatusUnauthorized {
		t.Errorf("logout 后 GET /api/v1/auth/session 状态码 = %d, 期望 401", after)
	}
}

// TestVC12TrustedDeviceCookieSurvivesPlainLogoutOverRealJar 正向证明 c：
// 普通 logout（VC-R12 定稿后响应不带任何 Set-Cookie）天然保留
// vc_trusted_device；真实 cookiejar 视角下该 Cookie 在 logout 后仍存在，
// 且随后仅凭密码 login 直接返回 200 + ACTIVE（跳过 TOTP）。与既有
// recorder 版 TestTrustedDeviceSkipsOnlyTOTPAndKeepsFixedExpiry 相比，
// 这里只保留真实 cookiejar 的增量断言，不重复固定到期时间与撤销流程。
func TestVC12TrustedDeviceCookieSurvivesPlainLogoutOverRealJar(t *testing.T) {
	ts, client := newRealAuthServer(t)
	realFullLogin(t, client, ts.URL, "alice", true)
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Fatal("trustDevice 登录后真实 cookiejar 缺少 vc_trusted_device")
	}
	logout, err := doRealJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/logout", "")
	if err != nil {
		t.Fatalf("logout 请求失败: %v", err)
	}
	if logout.code != http.StatusOK {
		t.Fatalf("logout 状态码 = %d, 期望 200", logout.code)
	}
	// VC-R12 回归护栏：logout 响应不得携带任何 Set-Cookie（只计数，不取值）。
	if logout.setCookies != 0 {
		t.Errorf("logout 响应携带 Set-Cookie 头 %d 条, 期望 0 条", logout.setCookies)
	}
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Error("普通 logout 后真实 cookiejar 中 vc_trusted_device 应保留")
	}
	// 仅凭密码重新登录：真实 jar 自动回传 vc_trusted_device，
	// 服务端应跳过 TOTP 直接建立会话（200 + ACTIVE）。
	code, body, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"`+testPassword+`"}`)
	if err != nil {
		t.Fatalf("trusted-device login 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("仅凭密码的 trusted-device login 状态码 = %d, 期望 200", code)
	}
	var identity sessionIdentityJSON
	if err := json.Unmarshal([]byte(body), &identity); err != nil {
		t.Fatalf("login 响应解析失败: %v", err)
	}
	if identity.NextStep != "ACTIVE" {
		t.Errorf("trusted-device login nextStep = %q, 期望 ACTIVE（跳过 TOTP）", identity.NextStep)
	}
	if realCookieValue(client, ts.URL, auth.SessionCookieName) == "" {
		t.Error("trusted-device login 后真实 cookiejar 缺少新的 vc_session")
	}
}
