package httpapi

// VC-R15 证据阶段：改密「迟到响应」与新登录的服务端竞态。
//
// 修复前基线：handleChangePassword（auth.go）在 ChangePasswordHash（服务端
// 原子完成改密、撤销该账号全部 opaque session 与 trusted device）之后调用
// clearAllAuthCookies，对 vc_session/vc_csrf/vc_trusted_device 各写一条
// Max-Age=-1 的 Set-Cookie 再返回 200。若该 200 响应迟到（网络延迟），而
// 同一浏览器在此期间完成了较新一次登录，迟到的过期 Set-Cookie 会按 Cookie
// 名/path 删掉较新登录刚装好的凭据——与 VC-R12 普通 logout 修过的同型竞态
// 一致。VC-R15 定稿后该响应不再携带任何 Set-Cookie，本文件转为回归护栏。
// 取证沿用 auth_logout_race_test.go 的真实 HTTP 视角
// （httptest.NewServer + net/http/cookiejar）：
//
//   - 竞态护栏（核心）：改密的服务端撤销先完成、响应被闸门延迟，期间同一
//     浏览器完成一次新登录（含新 trusted device）；迟到的响应不得影响较新
//     登录。修复前，改密响应携带 Max-Age=-1 的 Set-Cookie，会在真实
//     cookiejar 上删掉较新登录的 vc_session 与 vc_trusted_device（红证据）；
//     定稿后响应无 Set-Cookie，较新登录必须保持登录态，同时旧 token 的
//     服务端撤销语义必须保持。
//   - 正向证明：正常（无闸门）改密后，旧 token 与旧 trusted-device 在
//     服务端被拒绝；旧密码不得建立会话；新密码登录回到 TOTP 流程；
//     TOTP 完成后可重新建立会话与新 trusted device。
//
// 安全约束：任何 cookie/token/CSRF/密码的值都不进入日志与断言消息；
// 断言只使用状态码、布尔、条数与字段存在性，失败消息不打印响应体原文。

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

// passwordGate 仅拦截 POST /api/v1/auth/password：先把请求交给真实 handler
// 写入 ResponseRecorder（此刻服务端 ChangePasswordHash 已完成；响应头是
// handler 实际生成的内容——修复前含过期 Set-Cookie，定稿后无任何
// Set-Cookie），向测试发出「服务端已改密」信号，阻塞等待 release，最后把
// Recorder 的状态码、全部响应头（含可能存在的多条 Set-Cookie）与响应体
// 原样转发给真实客户端。技术与 auth_logout_race_test.go 的 logoutGate
// 相同，仅匹配的路径不同。
type passwordGate struct {
	inner     http.Handler
	committed chan struct{}
	release   chan struct{}
	once      sync.Once
}

func newPasswordGate(inner http.Handler) *passwordGate {
	return &passwordGate{
		inner:     inner,
		committed: make(chan struct{}, 1),
		release:   make(chan struct{}),
	}
}

func (g *passwordGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/api/v1/auth/password" {
		g.inner.ServeHTTP(w, r)
		return
	}
	rec := httptest.NewRecorder()
	// 真实 handler 同步执行完毕：改密与撤销的决定已经做出。
	g.inner.ServeHTTP(rec, r)
	// 通知测试「服务端已完成改密」，非阻塞发送，channel 容量为 1。
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

// letThrough 放行被闸门阻塞的改密响应；sync.Once 保证幂等，
// t.Cleanup 兜底调用，避免异常路径下 httptest.Server.Close 卡死。
func (g *passwordGate) letThrough() {
	g.once.Do(func() { close(g.release) })
}

// realLoginWithExplicitTrustedDeviceCookie 用显式 Cookie 头（不走 cookiejar）
// 携带指定 trusted-device token 发送 login 请求：用于验证被服务端撤销的
// trusted-device 凭据不再能跳过 TOTP。返回状态码与响应体。
func realLoginWithExplicitTrustedDeviceCookie(base, value, password string) (int, string, error) {
	body := `{"account":"alice@example.com","password":"` + password + `"}`
	req, err := http.NewRequest(http.MethodPost, base+"/api/v1/auth/login", strings.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://vc.test")
	req.Header.Set("Cookie", auth.TrustedDeviceCookieName+"="+value)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, "", err
	}
	return resp.StatusCode, string(b), nil
}

// TestVC15LatePasswordChangeResponseDropsNewerLoginCookies 是 VC-R15 竞态
// 护栏（取证阶段为 RED 核心）：改密的服务端撤销先完成、响应被闸门延迟，
// 期间同一浏览器完成一次新登录（含新 trusted device）；修复前，迟到的改密
// 响应携带 Max-Age=-1 的 Set-Cookie，会在真实 cookiejar 上删掉较新登录的
// vc_session/vc_csrf/vc_trusted_device，使 GET session 变成 401（红证据）。
// 定稿后改密响应不带任何 Set-Cookie，期望转为绿的回归护栏：较新登录必须
// 保持登录态，且改密的服务端撤销语义（旧 token 401）不受影响。
func TestVC15LatePasswordChangeResponseDropsNewerLoginCookies(t *testing.T) {
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	gate := newPasswordGate(s.Handler())
	ts := httptest.NewServer(gate)
	t.Cleanup(ts.Close)
	t.Cleanup(gate.letThrough)

	client := newRealBrowserClient(t)

	// 1) alice 完整登录并信任设备，真实 jar 持有 A 的
	//    vc_session/vc_csrf/vc_trusted_device。
	realFullLogin(t, client, ts.URL, "alice", true)
	aliceToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if aliceToken == "" {
		t.Fatal("alice 登录后真实 cookiejar 缺少 vc_session")
	}

	// 2) 后台 goroutine 经真实 client 发出改密请求（闸门拦截其响应）。
	type changeResult struct {
		code       int
		setCookies int
		err        error
	}
	changeDone := make(chan changeResult, 1)
	go func() {
		res, err := doRealJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/password",
			`{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`)
		changeDone <- changeResult{code: res.code, setCookies: res.setCookies, err: err}
	}()

	// 3) 等待「服务端已完成改密」信号：此刻改密与服务端撤销（全部 session
	//    与 trusted device）已完成，响应（修复前含过期 Set-Cookie、定稿后
	//    不含任何 Set-Cookie）已被闸门捕获但尚未到达客户端。
	select {
	case <-gate.committed:
	case <-time.After(5 * time.Second):
		t.Fatal("改密请求未到达服务端（闸门未触发）")
	}

	// 4) 同一 jar 完成一次新登录（第二账号 bob，含新 trusted device），
	//    换取新的会话与可信设备凭据。
	realFullLogin(t, client, ts.URL, "bob", true)
	bobToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if bobToken == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_session")
	}
	if bobToken == aliceToken {
		t.Fatal("新登录未换发新的 vc_session（新旧值相同）")
	}
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_trusted_device")
	}

	// 5) 放行闸门，等待改密响应送达客户端（应为 200）。
	gate.letThrough()
	select {
	case res := <-changeDone:
		if res.err != nil {
			t.Fatalf("改密请求失败: %v", res.err)
		}
		if res.code != http.StatusOK {
			t.Fatalf("改密状态码 = %d, 期望 200", res.code)
		}
		// 取证信息（仅计数，不含任何凭据值）：修复前基线为 3 条过期
		// Set-Cookie（红证据）；VC-R15 定稿后改密响应不带任何 Set-Cookie，
		// 响应头计数必须为 0，出现即回归失败。
		if res.setCookies != 0 {
			t.Errorf("迟到的改密响应携带 Set-Cookie 头 %d 条，期望 0 条", res.setCookies)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("等待改密响应超时")
	}

	// 6) 竞态护栏断言：迟到的改密响应不得影响较新登录——VC-R15 修复前
	//    迟到响应携带的过期 Set-Cookie 会删掉较新登录的 vc_session，
	//    使 GET session 变成 401（红）；修复后必须保持 200。
	code, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("竞态回归护栏：改密迟到响应影响了较新登录；"+
			"GET /api/v1/auth/session 状态码 = %d, 期望 200", code)
	}

	// 7) 对照（应当满足）：alice 的旧 token 在服务端确实已撤销——
	//    用显式 Cookie 头（不走 jar）携带旧值请求 session，必须 401。
	//    证明改密的撤销语义落在服务端，不受本次竞态修复影响。
	codeA, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if codeA != http.StatusUnauthorized {
		t.Errorf("改密后旧会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeA)
	}

	// 8) 较新登录的新 trusted device 也不得被迟到响应清掉（修复前红）。
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Error("竞态回归护栏：改密迟到响应清掉了较新登录的 vc_trusted_device")
	}
}

// TestVC15PasswordChangeRevocationSemanticsOverRealJar 正向证明：无闸门的
// 正常改密保持完整撤销语义——
//   - 旧会话 token 以显式 Cookie 头重放必须 401（撤销发生在服务端）；
//   - 旧密码登录不得建立会话（实际失败状态码为 404 NOT_FOUND_OR_FORBIDDEN）；
//   - 新密码登录：改密同时撤销了旧 trusted device，即使显式重放旧
//     trusted-device token，也必须回到 TOTP 流程；因账号 authenticator
//     在改密后保持启用，实际 nextStep 为 TOTP_REQUIRED（而非首次注册的
//     AUTHENTICATOR_SETUP_REQUIRED），不得 200 ACTIVE 跳过 TOTP；
//   - 用新密码经 TOTP 重新登录（trustDevice=true 装新设备）成功，
//     新会话 GET session 为 200。
func TestVC15PasswordChangeRevocationSemanticsOverRealJar(t *testing.T) {
	ts, client := newRealAuthServer(t)
	realFullLogin(t, client, ts.URL, "alice", true)
	oldToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if oldToken == "" {
		t.Fatal("登录后真实 cookiejar 缺少 vc_session")
	}
	oldDevice := realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName)
	if oldDevice == "" {
		t.Fatal("trustDevice 登录后真实 cookiejar 缺少 vc_trusted_device")
	}

	// 正常改密（无闸门）成功。
	code, _, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/password",
		`{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`)
	if err != nil {
		t.Fatalf("改密请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Fatalf("改密状态码 = %d, 期望 200", code)
	}

	// 旧会话 token 显式重放必须 401：撤销落在服务端而非仅靠清 Cookie。
	replay, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, oldToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if replay != http.StatusUnauthorized {
		t.Errorf("改密后旧会话 token 重放状态码 = %d, 期望 401", replay)
	}

	// 旧密码登录不得建立会话：实际失败状态码为 404（NOT_FOUND_OR_FORBIDDEN）。
	code, _, err = realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"`+testPassword+`"}`)
	if err != nil {
		t.Fatalf("旧密码 login 请求失败: %v", err)
	}
	if code == http.StatusOK || code == http.StatusAccepted {
		t.Errorf("旧密码 login 状态码 = %d, 不得建立会话（非 200 非 202）", code)
	}
	if code != http.StatusNotFound {
		t.Errorf("旧密码 login 状态码 = %d, 期望 404（NOT_FOUND_OR_FORBIDDEN）", code)
	}

	// 新密码登录：显式重放被撤销的旧 trusted-device token（服务端已撤销，
	// 必须走 TOTP），实际 nextStep 为 TOTP_REQUIRED，不得 200 ACTIVE。
	newCode, newBody, err := realLoginWithExplicitTrustedDeviceCookie(ts.URL, oldDevice, "test-pass-2")
	if err != nil {
		t.Fatalf("新密码 login（显式旧 trusted-device token）请求失败: %v", err)
	}
	if newCode != http.StatusAccepted {
		t.Fatalf("新密码 login（显式旧 trusted-device token）状态码 = %d, 期望 202 回到 TOTP 流程", newCode)
	}
	var next authNextStepJSON
	if err := json.Unmarshal([]byte(newBody), &next); err != nil {
		t.Fatalf("login 响应解析失败: %v", err)
	}
	if next.NextStep != "TOTP_REQUIRED" || !validChallengeID(next.ChallengeID) {
		t.Errorf("新密码 login 下一步 = %q, 期望 TOTP_REQUIRED 且带有效 challengeId（不得 200 ACTIVE 跳过 TOTP）", next.NextStep)
	}

	// 用新密码在真实 jar 上重新完整登录：login → TOTP 验证（trustDevice=true
	// 装新设备）。因 authenticator 保持启用，走 verify 流（非
	// realFullLogin 的 enroll 流）。
	code, body, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"test-pass-2"}`)
	if err != nil {
		t.Fatalf("新密码 login 请求失败: %v", err)
	}
	if code != http.StatusAccepted {
		t.Fatalf("新密码 login 状态码 = %d, 期望 202", code)
	}
	if err := json.Unmarshal([]byte(body), &next); err != nil {
		t.Fatalf("login 响应解析失败: %v", err)
	}
	if next.NextStep != "TOTP_REQUIRED" || !validChallengeID(next.ChallengeID) {
		t.Fatalf("新密码 login 下一步 = %q, 期望 TOTP_REQUIRED 且带有效 challengeId", next.NextStep)
	}
	code, verifyBody, err := realJSON(client, ts.URL, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/totp",
		`{"code":"123456","trustDevice":true}`)
	if err != nil {
		t.Fatalf("TOTP 验证请求失败: %v", err)
	}
	// The page learns its newly established identity from the same response.
	realNoteLoginAccount(client, verifyBody)
	if code != http.StatusOK {
		t.Fatalf("TOTP 验证状态码 = %d, 期望 200", code)
	}
	if realCookieValue(client, ts.URL, auth.SessionCookieName) == "" {
		t.Fatal("重新登录后真实 cookiejar 缺少新的 vc_session")
	}
	if realCookieValue(client, ts.URL, auth.TrustedDeviceCookieName) == "" {
		t.Error("trustDevice 重新登录后真实 cookiejar 缺少新的 vc_trusted_device")
	}
	after, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if after != http.StatusOK {
		t.Errorf("重新登录后 GET /api/v1/auth/session 状态码 = %d, 期望 200", after)
	}
}
