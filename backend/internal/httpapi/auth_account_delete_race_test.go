package httpapi

// VC-R16 证据阶段：注销「迟到响应」与新登录的服务端竞态。
//
// 修复前基线：handleDeleteAccount（account.go）在 Store.DeleteAccount
// （服务端完成注销）之后调用 clearSessionCookies，对 vc_session/vc_csrf
// 各写一条 Max-Age=-1 的 Set-Cookie 再返回 200。若该 200 响应迟到
// （网络延迟），而同一浏览器在此期间完成了另一账号 B 的较新登录，迟到的
// 过期 Set-Cookie 按名/path 寻址、无法区分新旧值，会删掉 B 刚装好的
// vc_session/vc_csrf，使 B 的 GET /api/v1/auth/session 变成 401。这与
// VC-R12（logout）、VC-R15（改密）已修复的同型竞态一致：两者的定稿方案
// 都是响应不再携带任何 Set-Cookie。本轮先为注销把真实 HTTP 红证据固定
// 下来，取证沿用 auth_logout_race_test.go 的真实 HTTP 视角
// （httptest.NewServer + net/http/cookiejar）。
//
// fixture 声明（ownerScopedDeletionStore）：rights_memstore_test.go 的
// memStore 用全局 m.deleting/m.deleted 旗标实现注销语义，不区分 owner——
// 任一账号注销后所有账号的 LookupIdentity/LookupOpaqueSession 都会失败，
// 双账号场景根本建不起来（假红）。本文件用结构体嵌入 *memStore 复用其余
// 行为，仅把注销相关方法覆写为按 owner 生效。该 fixture 只模拟注销在
// 认证侧的效果（被删 owner 的会话/身份失效，其他账号不受影响），
// 不能也不冒充完整 SQL cascade（vc_user 及关联行级联删除等）的验证——
// 那不是本测试的 claim。
//
// 安全约束：任何 cookie/token/CSRF/密码的值都不进入日志与断言消息；
// 断言只使用状态码、布尔、条数与字段存在性，失败消息不打印响应体原文。

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// ownerScopedDeletionStore 把 memStore 的注销语义改为按 owner 生效：
// 注销意图、已完成注销的账号集合都是 per-owner 状态，绝不触碰嵌入
// memStore 的全局 deleting/deleted 旗标，从而保证 alice 注销后 bob 的
// 身份查找与会话认证不受影响。只覆写注销链路与认证查找相关的方法，
// 其余行为（挑战、trusted device、relationship 等）原样继承。
type ownerScopedDeletionStore struct {
	*memStore
	mu            sync.Mutex
	deleteIntents map[int64]bool
	deletedOwners map[int64]bool
}

func newOwnerScopedDeletionStore(inner *memStore) *ownerScopedDeletionStore {
	return &ownerScopedDeletionStore{
		memStore:      inner,
		deleteIntents: map[int64]bool{},
		deletedOwners: map[int64]bool{},
	}
}

func (s *ownerScopedDeletionStore) ownerDeleted(accountID int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deletedOwners[accountID]
}

// RequestAccountDeletion 只记录该 owner 的注销意图，不置全局旗标；
// 对已完成注销的 owner 重复请求保持基线语义（ErrNotFound）。
func (s *ownerScopedDeletionStore) RequestAccountDeletion(_ context.Context, accountID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deletedOwners[accountID] {
		return postgres.ErrNotFound
	}
	s.deleteIntents[accountID] = true
	return nil
}

// DeletionIntentActive 返回该 owner 的意图状态（基线读全局旗标，
// 这里改为按 owner）。
func (s *ownerScopedDeletionStore) DeletionIntentActive(_ context.Context, accountID int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.deleteIntents[accountID], nil
}

// DeleteAccount 校验该 owner 已有意图（否则 ErrNotFound，保持 handler
// 顺序语义）→ 撤销该 owner 的全部 opaque session 与 trusted device
// （复用嵌入的按 owner 生效的 RevokeAllOpaqueSessions）→ 记入已删除
// 集合；绝不置全局旗标。
func (s *ownerScopedDeletionStore) DeleteAccount(ctx context.Context, accountID int64) error {
	s.mu.Lock()
	if !s.deleteIntents[accountID] || s.deletedOwners[accountID] {
		s.mu.Unlock()
		return postgres.ErrNotFound
	}
	s.deletedOwners[accountID] = true
	s.mu.Unlock()
	_, err := s.memStore.RevokeAllOpaqueSessions(ctx, accountID)
	return err
}

// LookupIdentity：被删除账号的用户名一律视为不存在（known=false，
// 登录与 requireCurrentPassword 都会走到 404 NOT_FOUND_OR_FORBIDDEN），
// 其他账号不受影响；其余查找行为原样继承嵌入实现。
func (s *ownerScopedDeletionStore) LookupIdentity(ctx context.Context, username string) (postgres.Identity, bool, error) {
	ident, known, err := s.memStore.LookupIdentity(ctx, username)
	if err != nil || !known {
		return ident, known, err
	}
	if s.ownerDeleted(ident.AccountID) {
		return postgres.Identity{}, false, nil
	}
	return ident, true, nil
}

// LookupOpaqueSession：被删除账号的会话一律视为不存在；其余行为
// （撤销/过期判定、principal 组装）原样继承嵌入实现。
func (s *ownerScopedDeletionStore) LookupOpaqueSession(ctx context.Context, tokenHash string) (*auth.Principal, error) {
	p, err := s.memStore.LookupOpaqueSession(ctx, tokenHash)
	if err != nil || p == nil {
		return p, err
	}
	if s.ownerDeleted(p.AccountID) {
		return nil, nil
	}
	return p, nil
}

// Lookup 镜像基线实现（委托 LookupOpaqueSession），但指向本类型的
// 覆写版本：嵌入的 memStore.Lookup 内部直连 memStore.LookupOpaqueSession，
// 不会经过上面的 owner 检查，故需一并覆写。
func (s *ownerScopedDeletionStore) Lookup(ctx context.Context, token string) (*auth.Principal, error) {
	return s.LookupOpaqueSession(context.Background(), auth.TokenHash(token))
}

// deleteGate 仅拦截 DELETE /api/v1/auth/account：先把请求交给真实
// handler 写入 ResponseRecorder（此刻服务端注销已完整完成，含
// Store.DeleteAccount 与撤销；响应头是 handler 实际生成的内容——基线
// 含两条 Max-Age=-1 的过期 Set-Cookie），向测试发出「服务端已注销」
// 信号，阻塞等待 release，最后把 Recorder 的状态码、全部响应头（含
// 可能存在的多条 Set-Cookie）与响应体原样转发给真实客户端。技术与
// auth_password_race_test.go 的 passwordGate 相同，仅匹配的路径不同。
type deleteGate struct {
	inner     http.Handler
	committed chan struct{}
	release   chan struct{}
	once      sync.Once
}

func newDeleteGate(inner http.Handler) *deleteGate {
	return &deleteGate{
		inner:     inner,
		committed: make(chan struct{}, 1),
		release:   make(chan struct{}),
	}
}

func (g *deleteGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/auth/account" {
		g.inner.ServeHTTP(w, r)
		return
	}
	rec := httptest.NewRecorder()
	// 真实 handler 同步执行完毕：注销与撤销的决定已经做出。
	g.inner.ServeHTTP(rec, r)
	// 通知测试「服务端已完成注销」，非阻塞发送，channel 容量为 1。
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

// letThrough 放行被闸门阻塞的注销响应；sync.Once 保证幂等，
// t.Cleanup 兜底调用，避免异常路径下 httptest.Server.Close 卡死。
func (g *deleteGate) letThrough() {
	g.once.Do(func() { close(g.release) })
}

// TestVC16LateAccountDeletionResponseDropsNewerLoginCookies 是 VC-R16
// 竞态护栏（取证阶段为 RED 核心）：注销的服务端撤销先完成、响应被闸门
// 延迟，期间同一浏览器完成另一账号 bob 的较新登录；基线上迟到的注销
// 响应携带 Max-Age=-1 的 Set-Cookie，会在真实 cookiejar 上删掉较新登录
// 的 vc_session/vc_csrf，使 GET session 变成 401（红证据）。定稿后注销
// 响应不带任何 Set-Cookie，本断言转为绿的回归护栏；同时被删账号的
// 服务端撤销语义（旧 token 401、重新登录不得建立会话）必须保持。
func TestVC16LateAccountDeletionResponseDropsNewerLoginCookies(t *testing.T) {
	store := newOwnerScopedDeletionStore(newMemStore())
	s := newCoreServer(t, "full", store)
	gate := newDeleteGate(s.Handler())
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

	// 2) 后台 goroutine 经真实 client 发出注销请求（闸门拦截其响应）。
	type deleteResult struct {
		code       int
		setCookies int
		err        error
	}
	deleteDone := make(chan deleteResult, 1)
	go func() {
		res, err := doRealJSON(client, ts.URL, http.MethodDelete, "/api/v1/auth/account",
			`{"currentPassword":"`+testPassword+`"}`)
		deleteDone <- deleteResult{code: res.code, setCookies: res.setCookies, err: err}
	}()

	// 3) 等待「服务端已完成注销」信号：此刻 DeleteAccount（含该 owner
	//    全部会话与 trusted device 的撤销）已完成，响应（基线含两条过期
	//    Set-Cookie）已被闸门捕获但尚未到达客户端。
	select {
	case <-gate.committed:
	case <-time.After(5 * time.Second):
		t.Fatal("注销请求未到达服务端（闸门未触发）")
	}

	// 4) 同一 jar 完成另一账号 bob 的较新登录（含新 trusted device），
	//    换取新的会话凭据。
	realFullLogin(t, client, ts.URL, "bob", true)
	bobToken := realCookieValue(client, ts.URL, auth.SessionCookieName)
	if bobToken == "" {
		t.Fatal("bob 登录后真实 cookiejar 缺少 vc_session")
	}
	if bobToken == aliceToken {
		t.Fatal("新登录未换发新的 vc_session（新旧值相同）")
	}

	// 5) 放行闸门，等待注销响应送达客户端（应为 200）。
	gate.letThrough()
	select {
	case res := <-deleteDone:
		if res.err != nil {
			t.Fatalf("注销请求失败: %v", res.err)
		}
		if res.code != http.StatusOK {
			t.Fatalf("注销状态码 = %d, 期望 200", res.code)
		}
		// 取证信息（仅计数，不含任何凭据值）：基线为 2 条过期 Set-Cookie
		// （vc_session/vc_csrf，红证据）；定稿后注销响应不带任何
		// Set-Cookie，响应头计数必须为 0，出现即回归失败。
		if res.setCookies != 0 {
			t.Errorf("迟到的注销响应携带 Set-Cookie 头 %d 条，期望 0 条", res.setCookies)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("等待注销响应超时")
	}

	// 6) 竞态护栏断言（RED 点）：迟到的注销响应不得影响较新登录——基线上
	//    迟到响应携带的过期 Set-Cookie 会删掉较新登录的 vc_session，
	//    使 GET session 变成 401（红）；定稿后必须保持 200。
	code, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("竞态回归护栏：注销迟到响应影响了较新登录；"+
			"GET /api/v1/auth/session 状态码 = %d, 期望 200", code)
	}

	// 7) 对照（应当满足）：alice 的旧 token 在服务端确实已撤销——
	//    用显式 Cookie 头（不走 jar）携带旧值请求 session，必须 401。
	//    证明注销的撤销语义落在服务端，不受本次竞态修复影响。
	codeA, err := realGetWithExplicitCookie(ts.URL, auth.SessionCookieName, aliceToken)
	if err != nil {
		t.Fatalf("旧 token 显式请求失败: %v", err)
	}
	if codeA != http.StatusUnauthorized {
		t.Errorf("注销后旧会话 token 服务端撤销检查：状态码 = %d, 期望 401", codeA)
	}

	// 8) 对照（应当满足）：被删账号用正确密码重新 login 不得建立会话
	//    （fixture 将其身份视为不存在，按既有语义期望 404
	//    NOT_FOUND_OR_FORBIDDEN）。
	relogin, _, err := realJSON(client, ts.URL, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"`+testPassword+`"}`)
	if err != nil {
		t.Fatalf("被删账号重新 login 请求失败: %v", err)
	}
	if relogin != http.StatusNotFound {
		t.Errorf("被删账号重新 login 状态码 = %d, 期望 404（不得建立会话）", relogin)
	}
}

// TestVC16WrongPasswordDeleteKeepsSessionAlive 对照：错误密码的注销
// 请求被 requireCurrentPassword 拒绝（404，既有 rights_test.go 已覆盖
// 状态码本身），此处补真实 jar 视角的增量断言——原会话必须保持登录态
// （GET session 200），且 fixture 不记录任何注销意图。
func TestVC16WrongPasswordDeleteKeepsSessionAlive(t *testing.T) {
	store := newOwnerScopedDeletionStore(newMemStore())
	s := newCoreServer(t, "full", store)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	client := newRealBrowserClient(t)

	realFullLogin(t, client, ts.URL, "alice", false)
	if realCookieValue(client, ts.URL, auth.SessionCookieName) == "" {
		t.Fatal("alice 登录后真实 cookiejar 缺少 vc_session")
	}

	res, err := doRealJSON(client, ts.URL, http.MethodDelete, "/api/v1/auth/account",
		`{"currentPassword":"definitely-wrong"}`)
	if err != nil {
		t.Fatalf("错误密码注销请求失败: %v", err)
	}
	if res.code != http.StatusNotFound {
		t.Fatalf("错误密码注销状态码 = %d, 期望 404", res.code)
	}

	// 原会话不受失败尝试影响。
	after, _, err := realJSON(client, ts.URL, http.MethodGet, "/api/v1/auth/session", "")
	if err != nil {
		t.Fatalf("GET session 请求失败: %v", err)
	}
	if after != http.StatusOK {
		t.Errorf("错误密码注销后 GET /api/v1/auth/session 状态码 = %d, 期望 200", after)
	}

	// handler 在密码校验处即返回：不记录注销意图。
	active, err := store.DeletionIntentActive(t.Context(), 1)
	if err != nil {
		t.Fatalf("查询注销意图失败: %v", err)
	}
	if active {
		t.Error("错误密码注销不得记录注销意图")
	}
}
