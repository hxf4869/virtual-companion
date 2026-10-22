package httpapi

// VC-R17 证据阶段：撤销会话「迟到响应」与新登录的服务端竞态。
//
// 修复前基线（auth.go handleRevokeSession/handleRevokeAllSessions）：撤销单个
// 会话成功且目标为当前会话时 clearSessionCookies 写 2 条 Max-Age=-1 的
// Set-Cookie（vc_session/vc_csrf）；revoke-all 成功时 clearAllAuthCookies
// 写 3 条（vc_session/vc_csrf/vc_trusted_device）。与 VC-R12（logout）、
// VC-R15（改密）、VC-R16（注销）已修复的同型竞态一致：过期 Set-Cookie 按
// 名/path 寻址、无法区分新旧值，若撤销响应迟到而同一浏览器在此期间完成
// 了另一账号的较新登录，会删掉较新登录刚装好的 Cookie。
//
// 目标行为：撤销的成功响应不携带任何 Set-Cookie，撤销语义留在服务端
// （single 只撤销 owner 指定的会话，不动独立 trusted-device；revoke-all
// 撤销发起账号全部 opaque sessions 与 trusted-device）。本轮先以真实 HTTP
// 视角固定红证据，取证沿用 auth_logout_race_test.go /
// auth_account_delete_race_test.go 的 helper 与闸门模式。
//
// claim 边界：本文件只覆盖认证响应归属行为（真实 cookiejar 视角），
// 不冒充 SQL/RLS 集成验收。
//
// 安全约束：任何 cookie/token/CSRF/密码的值都不进入日志与断言消息；
// 断言只使用状态码、布尔、条数与 nextStep 枚举，不打印响应体原文。
// owner 越界/不存在 session 的 404 分支由 store 层 ErrNotFound 语义保证，
// 非本轮目标，不在此新增。

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// revokeGate 仅拦截 match 命中的撤销请求：先把请求交给真实 handler 写入
// ResponseRecorder（此刻服务端撤销已完成、响应头已捕获），向测试发出
// 「服务端已撤销」信号，阻塞等待 release，最后把 Recorder 的状态码、
// 全部响应头（含多条 Set-Cookie）与响应体原样转发给真实客户端。技术与
// auth_account_delete_race_test.go 的 deleteGate 相同；因单个撤销的目标
// path 含运行期才可知的 sessionId，改为 method+path 匹配函数。
type revokeGate struct {
	inner     http.Handler
	match     func(method, path string) bool
	committed chan struct{}
	release   chan struct{}
	once      sync.Once
}

func newRevokeGate(inner http.Handler, match func(method, path string) bool) *revokeGate {
	return &revokeGate{
		inner:     inner,
		match:     match,
		committed: make(chan struct{}, 1),
		release:   make(chan struct{}),
	}
}

func (g *revokeGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !g.match(r.Method, r.URL.Path) {
		g.inner.ServeHTTP(w, r)
		return
	}
	rec := httptest.NewRecorder()
	// 真实 handler 同步执行完毕：服务端撤销与清除 Cookie 的决定已经做出。
	g.inner.ServeHTTP(rec, r)
	// 通知测试「服务端已撤销」，非阻塞发送，channel 容量为 1。
	select {
	case g.committed <- struct{}{}:
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

// letThrough 放行被闸门阻塞的撤销响应；sync.Once 保证幂等，
// t.Cleanup 兜底调用，避免异常路径下 httptest.Server.Close 卡死。
func (g *revokeGate) letThrough() {
	g.once.Do(func() { close(g.release) })
}

// newRealCookieClient 返回使用独立真实 cookiejar 的 client。
func newRealCookieClient(t *testing.T) *http.Client {
	t.Helper()
	return newRealBrowserClient(t)
}

// realSubsequentLogin 用真实 client 完成「已 enrollment 账号」的后续登录：
// 密码步返回 202 TOTP_REQUIRED，再以固定测试验证码走 totp 确认步。
// realFullLogin 只覆盖首登（AUTHENTICATOR_SETUP_REQUIRED），此处补第二会话。
func realSubsequentLogin(t *testing.T, client *http.Client, base, username string, trustDevice bool) {
	t.Helper()
	email := username
	if !strings.Contains(email, "@") {
		email += "@example.com"
	}
	code, body, err := realJSON(client, base, http.MethodPost, "/api/v1/auth/login",
		`{"account":"`+email+`","password":"`+testPassword+`"}`)
	if err != nil {
		t.Fatalf("后续登录 login 请求失败: %v", err)
	}
	if code != http.StatusAccepted {
		t.Fatalf("后续登录第一步状态码 = %d, 期望 202", code)
	}
	var next authNextStepJSON
	if err := json.Unmarshal([]byte(body), &next); err != nil {
		t.Fatalf("后续登录响应解析失败: %v", err)
	}
	if next.NextStep != "TOTP_REQUIRED" || !validChallengeID(next.ChallengeID) {
		t.Fatalf("后续登录下一步 = %q, 期望 TOTP_REQUIRED 且带有效 challengeId", next.NextStep)
	}
	trust := "false"
	if trustDevice {
		trust = "true"
	}
	code, body, err = realJSON(client, base, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/totp",
		`{"code":"123456","trustDevice":`+trust+`}`)
	if err != nil {
		t.Fatalf("后续登录 totp 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("后续登录 totp 状态码 = %d, 期望 200", code)
	}
	// 登录完成：页面已知账号更新为响应中的 accountId。
	realNoteLoginAccount(client, body)
}

// realCurrentSessionID 返回 client 当前会话在 GET /api/v1/auth/sessions
// 列表中的 id（current=true 项），用于构造撤销单个会话的目标 path。
func realCurrentSessionID(t *testing.T, client *http.Client, base string) string {
	t.Helper()
	code, body, err := realJSON(client, base, http.MethodGet, "/api/v1/auth/sessions", "")
	if err != nil {
		t.Fatalf("GET sessions 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("GET sessions 状态码 = %d, 期望 200", code)
	}
	var sessions []sessionJSON
	if err := json.Unmarshal([]byte(body), &sessions); err != nil {
		t.Fatalf("GET sessions 响应解析失败: %v", err)
	}
	for _, item := range sessions {
		if item.Current {
			return item.ID
		}
	}
	t.Fatal("GET sessions 未返回 current 会话")
	return ""
}

// realLoginWithExplicitTrustedCookie 用显式 Cookie 头（不经过 cookiejar）
// 发送仅密码的 login，用于验证某个 trusted-device token 在服务端的可用性：
// token 有效 → 200 + ACTIVE（跳过 TOTP）；token 已撤销 → 202 +
// TOTP_REQUIRED。返回状态码与 nextStep，不打印任何凭据值。
func realLoginWithExplicitTrustedCookie(base, email, trustedValue string) (int, string, error) {
	req, err := http.NewRequest(http.MethodPost, base+"/api/v1/auth/login",
		strings.NewReader(`{"account":"`+email+`","password":"`+testPassword+`"}`))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://vc.test")
	req.Header.Set("Cookie", auth.TrustedDeviceCookieName+"="+trustedValue)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, "", err
	}
	var identity sessionIdentityJSON
	if err := json.Unmarshal(b, &identity); err != nil {
		return resp.StatusCode, "", err
	}
	return resp.StatusCode, identity.NextStep, nil
}

// TestVC17LateSelfRevokeResponseDropsNewerLoginCookies 是 VC-R17 single
// 竞态护栏（取证阶段为 RED 核心）：撤销自己当前会话的服务端撤销先完成、
// 响应被闸门延迟，期间同一浏览器完成另一账号 bob 的较新登录；基线上迟到
// 响应携带 2 条 Max-Age=-1 的 Set-Cookie（vc_session/vc_csrf），会在真实
// cookiejar 上删掉较新登录的会话 Cookie，使 GET session 变成 401（红
// 证据）。定稿后撤销成功响应不带任何 Set-Cookie，本断言转为绿的回归
// 护栏。对照：旧 token 服务端已撤销（显式重放 401）；alice 非目标的另
// 一会话与独立 trusted-device 均不受单个撤销影响。
func TestVC17LateSelfRevokeResponseDropsNewerLoginCookies(t *testing.T) {
	s := newCoreServer(t, "full", newMemStore())
	// /api/v1/auth/sessions 前缀下唯一的 DELETE 路由就是
	// DELETE /api/v1/auth/sessions/{sessionId}；revoke-all 是 POST。
	gate := newRevokeGate(s.Handler(), func(method, path string) bool {
		return method == http.MethodDelete && strings.HasPrefix(path, "/api/v1/auth/sessions/")
	})
	ts := httptest.NewServer(gate)
	t.Cleanup(ts.Close)
	t.Cleanup(gate.letThrough)

	client := newRealCookieClient(t)
	client2 := newRealCookieClient(t)

	// 1) alice 完整登录并信任设备，真实 jar 持有 A 的
	//    vc_session/vc_csrf/vc_trusted_device。
	realFullLogin(t, client, ts.URL, "alice", true)
	aliceToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	aliceTrusted := realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName)
	if aliceToken == "" {
		t.Fatal("alice 登录后真实 cookiejar 缺少 vc_session")
	}
	if aliceTrusted == "" {
		t.Fatal("alice trustDevice 登录后真实 cookiejar 缺少 vc_trusted_device")
	}

	// 2) alice 的另一会话（独立 jar，非撤销目标）。
	realSubsequentLogin(t, client2, ts.URL, "alice", false)
	aliceOtherToken := realCookieValue(client2, ts.URL, auth.SessionCookieName)
	if aliceOtherToken == "" {
		t.Fatal("alice 第二会话登录后真实 cookiejar 缺少 vc_session")
	}
	if aliceOtherToken == aliceToken {
		t.Fatal("alice 两个会话的 vc_session 值相同")
	}

	// 3) 取当前会话 ID，构造自撤销目标。
	sid := realCurrentSessionID(t, client, ts.URL)

	// 4) 后台 goroutine 经真实 client 发出撤销自己当前会话的请求。
	type revokeResult struct {
		code       int
		setCookies int
		err        error
	}
	revokeDone := make(chan revokeResult, 1)
	go func() {
		res, err := doRealJSON(client, ts.URL, http.MethodDelete, "/api/v1/auth/sessions/"+sid, "")
		revokeDone <- revokeResult{code: res.code, setCookies: res.setCookies, err: err}
	}()

	// 5) 等待「服务端已撤销」信号：此刻 RevokeOpaqueSession 已完成，
	//    响应（基线含 2 条过期 Set-Cookie）已被闸门捕获但尚未到达客户端。
	select {
	case <-gate.committed:
	case <-time.After(5 * time.Second):
		t.Fatal("撤销请求未到达服务端（闸门未触发）")
	}

	// 6) 同一 jar 完成另一账号 bob 的较新登录，换取新的会话 Cookie。
	realFullLogin(t, client, ts.URL, "bob", false)
	bobToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if bobToken == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_session")
	}
	if bobToken == aliceToken {
		t.Fatal("新登录未换发新的 vc_session（新旧值相同）")
	}

	// 7) 放行闸门，等待撤销响应送达客户端（应为 200）。
	gate.letThrough()
	var res revokeResult
	select {
	case res = <-revokeDone:
		if res.err != nil {
			t.Fatalf("撤销单个会话请求失败: %v", res.err)
		}
		if res.code != http.StatusOK {
			t.Fatalf("撤销单个会话状态码 = %d, 期望 200", res.code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("等待撤销响应超时")
	}
	// 目标行为（取证阶段为红）：撤销的成功响应不得携带任何 Set-Cookie，
	// 撤销留在服务端；基线为 2 条过期 Set-Cookie（vc_session/vc_csrf）。
	if res.setCookies != 0 {
		t.Errorf("撤销单个会话的成功响应携带 Set-Cookie 头 %d 条, 期望 0 条（撤销留在服务端）", res.setCookies)
	}

	// 8) 竞态护栏断言（RED 核心）：迟到的撤销响应不得影响较新登录——
	//    基线上其携带的过期 Set-Cookie 会删掉较新登录的 vc_session，
	//    使 GET session 变成 401（红证据）；定稿后必须保持 200。
	code, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("竞态回归护栏：撤销单个会话的迟到响应影响了较新登录；"+
			"GET /api/v1/auth/session 状态码 = %d, 期望 200；迟到响应携带 Set-Cookie 头 %d 条,"+
			" bob 的 vc_session 已被从真实 cookiejar 清除 = %v",
			code, res.setCookies, realCookieValue(client, ts.URL, auth.SessionCookieName) == "")
	}

	// 9) 对照（应当满足）：alice 被撤销的旧 token 在服务端确实已撤销——
	//    用显式 Cookie 头（不走 jar）携带旧值请求 session，必须 401。
	codeA, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if codeA != http.StatusUnauthorized {
		t.Errorf("撤销后旧会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeA)
	}

	// 10) 对照（应当满足）：alice 非目标的另一会话不受单个撤销影响。
	codeOther, _, err := realJSON(client2, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("alice 第二会话 GET session 请求失败: %v", err)
	}
	if codeOther != http.StatusOK {
		t.Errorf("撤销单个会话后 alice 非目标另一会话：GET /api/v1/auth/session 状态码 = %d, 期望 200", codeOther)
	}

	// 11) 对照（应当满足）：alice 的独立 trusted-device 不随单个会话撤销——
	//     携带旧 trusted 值的仅密码 login 仍应 200 + ACTIVE（免 TOTP）。
	loginCode, nextStep, err := realLoginWithExplicitTrustedCookie(ts.URL, "alice@example.com", aliceTrusted)
	if err != nil {
		t.Fatalf("trusted-device login 请求失败: %v", err)
	}
	if loginCode != http.StatusOK || nextStep != "ACTIVE" {
		t.Errorf("撤销单个会话后 alice 的 trusted-device login：状态码 = %d, nextStep = %q, 期望 200/ACTIVE（免 TOTP）",
			loginCode, nextStep)
	}
}

// TestVC17LateRevokeAllResponseDropsNewerLoginCookies 是 VC-R17 all 竞态
// 护栏（取证阶段为 RED 核心）：revoke-all 的服务端撤销先完成、响应被闸门
// 延迟，期间同一浏览器完成另一账号 bob 的较新登录（含 trusted-device）；
// 基线上迟到响应携带 3 条 Max-Age=-1 的 Set-Cookie
// （vc_session/vc_csrf/vc_trusted_device），会在真实 cookiejar 上删掉较新
// 登录的全部凭据，使 GET session 变成 401、bob 的 trusted Cookie 消失
// （红证据）。定稿后撤销成功响应不带任何 Set-Cookie，本断言转为绿的
// 回归护栏。对照：alice 的两个旧会话 token 均被服务端拒绝（401），
// 旧 trusted 不再免 TOTP（再登录回 202 TOTP_REQUIRED），且 bob 的
// trusted 不受 alice 的 revoke-all 影响（服务端按账号隔离）。
func TestVC17LateRevokeAllResponseDropsNewerLoginCookies(t *testing.T) {
	s := newCoreServer(t, "full", newMemStore())
	gate := newRevokeGate(s.Handler(), func(method, path string) bool {
		return method == http.MethodPost && path == "/api/v1/auth/sessions/revoke-all"
	})
	ts := httptest.NewServer(gate)
	t.Cleanup(ts.Close)
	t.Cleanup(gate.letThrough)

	client := newRealCookieClient(t)
	client2 := newRealCookieClient(t)

	// 1) alice 完整登录并信任设备，真实 jar 持有 A 的
	//    vc_session/vc_csrf/vc_trusted_device。
	realFullLogin(t, client, ts.URL, "alice", true)
	aliceToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	aliceTrusted := realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName)
	if aliceToken == "" {
		t.Fatal("alice 登录后真实 cookiejar 缺少 vc_session")
	}
	if aliceTrusted == "" {
		t.Fatal("alice trustDevice 登录后真实 cookiejar 缺少 vc_trusted_device")
	}

	// 2) alice 的另一会话（同账号第二个 opaque session）。
	realSubsequentLogin(t, client2, ts.URL, "alice", false)
	aliceOtherToken := realCookieValue(client2, ts.URL, auth.SessionCookieName)
	if aliceOtherToken == "" {
		t.Fatal("alice 第二会话登录后真实 cookiejar 缺少 vc_session")
	}
	if aliceOtherToken == aliceToken {
		t.Fatal("alice 两个会话的 vc_session 值相同")
	}

	// 3) 后台 goroutine 经真实 client 发出 revoke-all 请求。
	type revokeResult struct {
		code       int
		setCookies int
		err        error
	}
	revokeDone := make(chan revokeResult, 1)
	go func() {
		res, err := doRealJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/sessions/revoke-all", "")
		revokeDone <- revokeResult{code: res.code, setCookies: res.setCookies, err: err}
	}()

	// 4) 等待「服务端已撤销」信号：此刻 alice 全部 opaque sessions 与
	//    trusted-device 已在服务端撤销，响应（基线含 3 条过期
	//    Set-Cookie）已被闸门捕获但尚未到达客户端。
	select {
	case <-gate.committed:
	case <-time.After(5 * time.Second):
		t.Fatal("revoke-all 请求未到达服务端（闸门未触发）")
	}

	// 5) 同一 jar 完成另一账号 bob 的较新登录（含新 trusted-device）。
	realFullLogin(t, client, ts.URL, "bob", true)
	bobToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	bobTrusted := realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName)
	if bobToken == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_session")
	}
	if bobToken == aliceToken {
		t.Fatal("新登录未换发新的 vc_session（新旧值相同）")
	}
	if bobTrusted == "" {
		t.Fatal("bob trustDevice 登录后真实 cookiejar 缺少 vc_trusted_device")
	}

	// 6) 放行闸门，等待 revoke-all 响应送达客户端（应为 200）。
	gate.letThrough()
	var res revokeResult
	select {
	case res = <-revokeDone:
		if res.err != nil {
			t.Fatalf("revoke-all 请求失败: %v", res.err)
		}
		if res.code != http.StatusOK {
			t.Fatalf("revoke-all 状态码 = %d, 期望 200", res.code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("等待 revoke-all 响应超时")
	}
	// 目标行为（取证阶段为红）：撤销的成功响应不得携带任何 Set-Cookie；
	// 基线为 3 条过期 Set-Cookie（vc_session/vc_csrf/vc_trusted_device）。
	if res.setCookies != 0 {
		t.Errorf("revoke-all 的成功响应携带 Set-Cookie 头 %d 条, 期望 0 条（撤销留在服务端）", res.setCookies)
	}

	// 7) 竞态护栏断言（RED 核心）：迟到的 revoke-all 响应不得影响较新
	//    登录——基线上其携带的过期 Set-Cookie 会删掉较新登录的
	//    vc_session，使 GET session 变成 401（红证据）；定稿后必须 200。
	code, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("竞态回归护栏：revoke-all 迟到响应影响了较新登录；"+
			"GET /api/v1/auth/session 状态码 = %d, 期望 200；迟到响应携带 Set-Cookie 头 %d 条,"+
			" bob 的 vc_session 已被从真实 cookiejar 清除 = %v",
			code, res.setCookies, realCookieValue(client, ts.URL, auth.SessionCookieName) == "")
	}

	// 8) 竞态护栏断言（RED 补充）：bob 的 trusted Cookie 也不得被 alice 的
	//    revoke-all 迟到响应删除（服务端按账号隔离，响应更无权清别人的
	//    Cookie）。基线上第 3 条过期 Set-Cookie 会把它从真实 jar 清掉。
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Errorf("竞态回归护栏：revoke-all 迟到响应删除了较新登录的 vc_trusted_device；"+
			"迟到响应携带 Set-Cookie 头 %d 条", res.setCookies)
	}

	// 9) 对照（应当满足）：alice 的两个旧会话 token 均在服务端被撤销——
	//    用显式 Cookie 头（不走 jar）携带旧值请求 session，必须 401。
	codeA, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceToken)
	if err != nil {
		t.Fatalf("alice 旧 token 显式请求失败: %v", err)
	}
	if codeA != http.StatusUnauthorized {
		t.Errorf("revoke-all 后 alice 当前会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeA)
	}
	codeOther, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceOtherToken)
	if err != nil {
		t.Fatalf("alice 第二会话旧 token 显式请求失败: %v", err)
	}
	if codeOther != http.StatusUnauthorized {
		t.Errorf("revoke-all 后 alice 另一会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeOther)
	}

	// 10) 对照（应当满足）：alice 的旧 trusted 已被服务端撤销——携带旧
	//     trusted 值的仅密码 login 不得再免 TOTP，应回 202 TOTP_REQUIRED。
	loginCode, nextStep, err := realLoginWithExplicitTrustedCookie(ts.URL, "alice@example.com", aliceTrusted)
	if err != nil {
		t.Fatalf("alice trusted-device login 请求失败: %v", err)
	}
	if loginCode != http.StatusAccepted || nextStep != "TOTP_REQUIRED" {
		t.Errorf("revoke-all 后 alice 的 trusted-device login：状态码 = %d, nextStep = %q, 期望 202/TOTP_REQUIRED（回 TOTP）",
			loginCode, nextStep)
	}
}
