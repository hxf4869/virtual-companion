// @vitest-environment happy-dom
// 记忆管理页：自动记忆开关读写、已保存列表渲染与编辑/删除、待确认候选
// 的逐条确认；失败路径一律保留原内容。
import { flushPromises, mount, type DOMWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";

import { createAuthenticatedTransport } from "@/api/transport";
import { useAuthStore } from "@/stores/auth";
import { useMemoryStore } from "@/stores/memory";

import MemoryPage from "./memory.vue";

const RELATIONSHIPS = [
  {
    relationshipId: 42,
    personaRef: "gentle-listener",
    active: true,
    companionName: "林夏",
  },
];

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    memoryId: "m1",
    scope: "FACT",
    summary: "用户喜欢在晚上散步。",
    status: "ACCEPTED",
    conversationId: 7,
    createdAt: "2026-09-01T10:00:00Z",
    autoSaved: true,
    ...overrides,
  };
}

const DEFAULT_MEMORIES = [
  memoryRow(),
  memoryRow({
    memoryId: "m2",
    summary: "用户的生日在三月。",
    conversationId: null,
    autoSaved: false,
  }),
  memoryRow({
    memoryId: "p1",
    summary: "候选：用户最近在学吉他。",
    status: "PENDING_CONFIRMATION",
    createdAt: "2026-09-03T10:00:00Z",
  }),
];

function echoMemory(memoryId: string): Record<string, unknown> {
  const source = DEFAULT_MEMORIES.find((row) => row.memoryId === memoryId);
  return source ?? { ...memoryRow(), memoryId };
}

interface Gate {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface FetchOptions {
  relationships?: unknown[] | (() => unknown[]);
  /** R214：按关系 ID 区分的列表数据（B 的关系不经全局 memories 数组）。 */
  memoriesByRel?: Record<string, unknown[]>;
  /** R214：GET /auth/session 的身份读回（reconcile 换号链）。 */
  sessionIdentity?: () => Record<string, unknown>;
  /** 提供时，GET /auth/session 挂起直到手动 resolve（身份未定窗口观察）。 */
  sessionGate?: Gate;
  /** R214：PUT 开关返回精确 409 + ACCOUNT_CONTEXT_CHANGED（触发 reconcile）。 */
  prefPutConflict?: boolean | (() => boolean);
  memories?: unknown[] | (() => unknown[]);
  memoriesStatus?: number | (() => number);
  prefEnabled?: boolean | (() => boolean);
  prefStatus?: number | (() => number);
  /** 提供时，GET 回包用该 JSON 代替合法 { enabled }（模拟无效协议回包）。 */
  prefGetBody?: unknown;
  /** 提供时，pref GET 请求挂起直到手动 resolve（用于开关读取 loading 观察）。 */
  prefGate?: Gate;
  putParseFailed?: boolean;
  /** PUT 时模拟网络中断（fetch 抛 TypeError）：结果未知。 */
  putNetworkError?: boolean;
  patchStatus?: number | ((memoryId: string) => number);
  /** 按 memoryId 挂起对应 PATCH（多请求独立控制晚到顺序，与 patchGate 互斥使用）。 */
  patchGates?: Record<string, Gate>;
  patchParseFailed?: boolean;
  patchEcho?: Record<string, unknown>;
  /** 按 memoryId 挂起对应 DELETE（换号晚到场景，与 deleteGate 互斥使用）。 */
  deleteGates?: Record<string, Gate>;
  /** 按 memoryId 挂起对应 confirm（换号晚到场景，与 confirmGate 互斥使用）。 */
  confirmGates?: Record<string, Gate>;
  deleteStatus?: number;
  confirmStatus?: number | (() => number);
  rejectStatus?: number | (() => number);
  /** 提供时，confirm 请求挂起直到手动 resolve（用于断言提交中禁用）。 */
  confirmGate?: Gate;
  /** 提供时，对应请求挂起直到手动 resolve（用于晚到响应/跨账号场景）。 */
  memoriesGate?: Gate;
  patchGate?: Gate;
  deleteGate?: Gate;
}

function response(status: number, json: unknown, parseFailed = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: parseFailed
      ? async () => {
          throw new TypeError("unreadable body");
        }
      : async () => json,
  };
}

function stubFetch(options: FetchOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    if (url === "/api/v1/auth/session" && method === "GET") {
      if (options.sessionGate) return options.sessionGate.promise as never;
      if (options.sessionIdentity) return response(200, options.sessionIdentity());
      return response(200, {});
    }
    if (url === "/api/v1/relationships" && method === "GET") {
      const rows = typeof options.relationships === "function"
        ? options.relationships()
        : options.relationships ?? RELATIONSHIPS;
      return response(200, rows);
    }
    const memoriesMatch = url.match(/^\/api\/v1\/relationships\/([^/]+)\/memories$/);
    if (memoriesMatch && method === "GET") {
      if (memoriesMatch[1] !== "42") {
        return response(200, options.memoriesByRel?.[memoriesMatch[1]] ?? []);
      }
      if (options.memoriesGate) return options.memoriesGate.promise as never;
      const status = typeof options.memoriesStatus === "function"
        ? options.memoriesStatus()
        : options.memoriesStatus ?? 200;
      if (status !== 200) return response(status, null);
      const rows = typeof options.memories === "function" ? options.memories() : options.memories ?? DEFAULT_MEMORIES;
      return response(200, rows);
    }
    if (url === "/api/v1/memory-auto-save-pref") {
      if (method === "GET") {
        if (options.prefGate) return options.prefGate.promise as never;
        const status = typeof options.prefStatus === "function"
          ? options.prefStatus()
          : options.prefStatus ?? 200;
        if (options.prefGetBody !== undefined) return response(status, options.prefGetBody);
        const enabled = typeof options.prefEnabled === "function"
          ? options.prefEnabled()
          : options.prefEnabled ?? true;
        return response(status, status === 200 ? { enabled } : null);
      }
      if (method === "PUT") {
        const conflict = typeof options.prefPutConflict === "function"
          ? options.prefPutConflict()
          : options.prefPutConflict;
        if (conflict) return response(409, { code: "ACCOUNT_CONTEXT_CHANGED" });
        if (options.putNetworkError) throw new TypeError("Failed to fetch");
        if (options.putParseFailed) return response(200, null, true);
        const request = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { enabled?: boolean };
        return response(200, { enabled: request.enabled });
      }
    }
    const memoryMatch = url.match(/^\/api\/v1\/memories\/([^/]+)(\/(confirm|reject))?$/);
    if (memoryMatch) {
      const memoryId = memoryMatch[1];
      if (method === "PATCH") {
        if (options.patchGate) return options.patchGate.promise as never;
        const gate = options.patchGates?.[memoryId];
        if (gate) return gate.promise as never;
        const status = typeof options.patchStatus === "function"
          ? options.patchStatus(memoryId)
          : options.patchStatus ?? 200;
        if (status !== 200) return response(status, { code: "INVALID_REQUEST" });
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>;
        return response(200, options.patchParseFailed
          ? null
          : options.patchEcho ?? memoryRow({ memoryId, summary: body.summary, autoSaved: false }),
        options.patchParseFailed);
      }
      if (method === "DELETE") {
        if (options.deleteGate) return options.deleteGate.promise as never;
        const deleteGateById = options.deleteGates?.[memoryId];
        if (deleteGateById) return deleteGateById.promise as never;
        const status = options.deleteStatus ?? 200;
        return response(status, status === 200
          ? memoryRow({ memoryId, deletedAt: "2026-09-04T00:00:00Z" })
          : null);
      }
      if (method === "POST" && memoryMatch[3] === "confirm") {
        const echoed = echoMemory(memoryId);
        if (options.confirmGate) {
          return options.confirmGate.promise as never;
        }
        const confirmGateById = options.confirmGates?.[memoryId];
        if (confirmGateById) return confirmGateById.promise as never;
        const status = typeof options.confirmStatus === "function"
          ? options.confirmStatus()
          : options.confirmStatus ?? 200;
        return response(status, status === 200
          ? { ...echoed, status: "ACCEPTED", autoSaved: true }
          : null);
      }
      if (method === "POST" && memoryMatch[3] === "reject") {
        const status = typeof options.rejectStatus === "function"
          ? options.rejectStatus()
          : options.rejectStatus ?? 200;
        const echoed = echoMemory(memoryId);
        return response(status, status === 200
          ? { ...echoed, status: "REJECTED", autoSaved: true }
          : null);
      }
    }
    return response(200, {});
  }));
  return { calls };
}

function login(): void {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = "7";
  auth.role = "USER";
}

// ---- R214：换号身份交接的 B 侧装置（与 A 的关系 42 / 默认列表区分） ----

const RELATIONSHIP_B = [
  { relationshipId: 84, personaRef: "gentle-listener", active: true, companionName: "林夏" },
];

const B_MEMORIES_R214 = [
  memoryRow({ memoryId: "201", summary: "B：用户忌口香菜。", autoSaved: false }),
  memoryRow({ memoryId: "202", summary: "B：用户在准备马拉松。", autoSaved: false }),
];

/** GET /auth/session 读回的身份（asSessionIdentity 的合法回包形状）。 */
function sessionIdentityFor(accountId: string, sessionId: string): Record<string, unknown> {
  return {
    nextStep: "ACTIVE",
    accountId,
    sessionId,
    role: "USER",
    passwordMustChange: false,
    authenticatorEnabled: false,
    expiresInSeconds: 3600,
  };
}

function loginAs(accountId: string): void {
  const auth = useAuthStore();
  auth.accessToken = "session";
  auth.accountId = accountId;
  auth.role = "USER";
}

function mountPage() {
  return mount(MemoryPage, { attachTo: document.body });
}

/**
 * 以真实 KeepAlive 宿主装载页面：uni-h5 用 RouterView+KeepAlive 渲染页面，
 * 离开页面是 deactivated 缓存而非 unmount。切换 active 即真实的
 * deactivate/activate 生命周期（onActivated/onDeactivated 实际触发，
 * 对应"确认离开后页面被缓存、之后可能再激活"的框架边界），不改页面
 * ref、不卸载 Vue 实例、不经私有属性。
 */
function mountPageInKeepAlive() {
  const active = ref(true);
  const host = mount(
    defineComponent({
      setup: () => () =>
        h(KeepAlive, () => (active.value ? h(MemoryPage) : h("view", "已离开页面"))),
    }),
    { attachTo: document.body },
  );
  return { host, active };
}

function memoryRows(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('[data-testid="memory-row"]');
}

/** 按摘要片段定位待确认行（多候选场景）；找不到时直接抛错定位到此。 */
function pendingRowOf(wrapper: ReturnType<typeof mountPage>, summaryPart: string) {
  const row = wrapper
    .findAll('[data-testid="pending-row"]')
    .find((candidate) => candidate.text().includes(summaryPart));
  if (!row) throw new Error(`pending row not found: ${summaryPart}`);
  return row;
}

/**
 * R208：列表级反馈区（等待/失败/不确定/成功共用同一节点）当前阶段；
 * 未渲染时为 undefined。
 */
function listNoticeState(wrapper: ReturnType<typeof mountPage>): string | undefined {
  const notice = wrapper.find('[data-testid="memory-list-notice"]');
  return notice.exists() ? notice.attributes("data-state") : undefined;
}

function listGetCount(calls: Array<{ method: string; url: string }>): number {
  return calls.filter((call) => call.method === "GET" && call.url.includes("/memories")).length;
}

async function openEdit(wrapper: ReturnType<typeof mountPage>, testid: string) {
  await wrapper.get(`[data-testid="${testid}"]`).trigger("click");
}

type LeaveGuard = (to: { path: string }, from: { path: string }) => boolean | Promise<boolean>;

/**
 * 组件测试宿主没有 uni 注入的 getApp().$router：stub 假的 H5 路由边界，
 * 记录页面经 beforeEach 注册的守卫，并以 memory 页为起点模拟一次导航
 * （返回守卫是否放行），不引入真实 vue-router。
 */
function stubLeaveRouter() {
  const guards: LeaveGuard[] = [];
  vi.stubGlobal("getApp", () => ({
    $router: {
      beforeEach(guard: LeaveGuard) {
        guards.push(guard);
        return () => {
          const index = guards.indexOf(guard);
          if (index >= 0) guards.splice(index, 1);
        };
      },
    },
  }));
  async function attemptNavigate(toPath: string): Promise<boolean> {
    const results = await Promise.all(
      guards.map((guard) => guard({ path: toPath }, { path: "/pages/memory/memory" })),
    );
    return results.every(Boolean);
  }
  return { guards, attemptNavigate };
}

/** 派发可取消的 beforeunload 并返回事件，用 defaultPrevented 断言是否拦截。 */
function dispatchBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/**
 * WAI-ARIA 1.2 的 switch 只支持 true/false（mixed 非法，会被 user agent
 * 当作 false 宣告）：未知时显式为 button 角色（不依赖原生默认），无
 * aria-checked，名称含"状态待确认"，原生 disabled。
 */
function expectUnknownToggle(toggle: Omit<DOMWrapper<Element>, "exists">): void {
  expect(toggle.attributes("role")).toBe("button");
  expect(toggle.attributes("aria-checked")).toBeUndefined();
  expect(toggle.attributes("aria-label")).toContain("状态待确认");
  expect(toggle.attributes("disabled")).toBeDefined();
}

/** 已确认开关：role=switch + 真实 boolean 字符串 + 稳定可访问名称。 */
function expectKnownToggle(
  toggle: Omit<DOMWrapper<Element>, "exists">,
  checked: "true" | "false",
): void {
  expect(toggle.attributes("role")).toBe("switch");
  expect(toggle.attributes("aria-checked")).toBe(checked);
  expect(toggle.attributes("aria-label")).toBe("自动记忆");
}

describe("记忆管理页", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
      navigateBack: vi.fn(),
      redirectTo: vi.fn(),
    });
    login();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("首屏骨架后渲染开关与已保存列表（含自动保存标记与来源）", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="memory-loading"]').exists()).toBe(true);
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "GET",
      url: "/api/v1/memory-auto-save-pref",
    }));
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已开启");
    expect(wrapper.get('[data-testid="autosave-toggle"]').attributes("aria-checked")).toBe("true");
    expect(wrapper.get('[data-testid="autosave-note"]').text()).toContain("停止新的自动提取与保存");
    expect(wrapper.get('[data-testid="autosave-note"]').text()).toContain("仍会继续用于聊天");

    const rows = memoryRows(wrapper);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.get('[data-testid="memory-summary"]').text()).toContain("晚上散步");
    expect(rows[0]?.get('[data-testid="memory-badge"]').text()).toBe("自动保存");
    expect(rows[0]?.get('[data-testid="memory-source"]').text()).toContain("来自一段对话");
    expect(rows[1]?.get('[data-testid="memory-badge"]').text()).toBe("已确认");
    expect(rows[1]?.get('[data-testid="memory-source"]').text()).toContain("来源内容已不可用");
    expect(wrapper.get('[data-testid="memory-time"]').text()).toMatch(/保存$/);
    wrapper.unmount();
  });

  it("关闭开关真实写回服务端并说明影响", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "PUT",
      url: "/api/v1/memory-auto-save-pref",
      body: JSON.stringify({ enabled: false }),
    }));
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已关闭");
    wrapper.unmount();
  });

  it("开关提交结果未知时提示未确认并可重新读取", async () => {
    const { calls } = stubFetch({ putParseFailed: true });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="autosave-unknown"]').text()).toContain("未能确认");
    await wrapper.get('[data-testid="autosave-reload"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "GET" && call.url === "/api/v1/memory-auto-save-pref"))
      .toHaveLength(2);
    expect(wrapper.find('[data-testid="autosave-unknown"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("编辑已保存记忆成功后更新该行", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("用户改成清晨散步了。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "PATCH",
      url: "/api/v1/memories/m1",
      body: JSON.stringify({ summary: "用户改成清晨散步了。" }),
    }));
    expect(wrapper.text()).toContain("用户改成清晨散步了。");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("编辑确定失败（4xx）不退出编辑、取消不产生写入", async () => {
    const { calls } = stubFetch({ patchStatus: () => 400 });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("改一半的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-edit-error"]').text()).toContain("再试一次");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);

    const patchCalls = calls.filter((call) => call.method === "PATCH").length;
    await wrapper.get('[data-testid="memory-edit-cancel"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(patchCalls);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("晚上散步");
    wrapper.unmount();
  });

  it("编辑已保存记忆遇 404：保留草稿与编辑框、不诱导重试也不自动读取，明确放弃后才清编辑并读到权威缺失", async () => {
    let authoritative = false;
    const { calls } = stubFetch({
      patchStatus: () => 404,
      memories: () => (authoritative ? [] : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("用户周末想去公园。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    const errorText = wrapper.get('[data-testid="memory-edit-error"]').text();
    expect(errorText).toContain("这条记忆当前无法保存");
    expect(errorText).not.toContain("再试一次");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("用户周末想去公园。");
    // 404 不自动重读列表：仍只有首载那一次 GET。
    expect(listGetCount(calls)).toBe(1);

    // 用户明确选择放弃后才清编辑并按权威列表刷新：条目在服务端已不存在。
    authoritative = true;
    await wrapper.get('[data-testid="memory-edit-discard-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-edit-discard-refresh"]').exists()).toBe(false);
    expect(listGetCount(calls)).toBe(2);
    expect(wrapper.text()).not.toContain("用户喜欢在晚上散步。");
    wrapper.unmount();
  });

  it("待确认编辑遇 404 后放弃刷新：首次读取失败可在列表反馈区重试恢复，无假成功与残留编辑状态", async () => {
    const { attemptNavigate } = stubLeaveRouter();
    let listReads = 0;
    let authoritative = false;
    const { calls } = stubFetch({
      patchStatus: () => 404,
      // 第 2 次读取（放弃后的首次刷新）失败，之后恢复。
      memoriesStatus: () => {
        listReads += 1;
        return listReads === 2 ? 503 : 200;
      },
      memories: () => (authoritative ? [] : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "pending-edit");
    await wrapper.get('[data-testid="pending-edit-input"]').setValue("候选改成周末去公园。");
    await wrapper.get('[data-testid="pending-edit-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="pending-edit-error"]').text()).toContain("这条记忆当前无法保存");
    expect(wrapper.find('[data-testid="pending-edit-box"]').exists()).toBe(true);

    // 明确放弃并刷新：编辑状态先清；首次读取失败时旧列表保留，失败写进
    // R208 列表反馈区，给出现成的再试入口。
    authoritative = true;
    await wrapper.get('[data-testid="pending-edit-discard-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="pending-edit-box"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pending-edit-discard-refresh"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("用户最近在学吉他");
    expect(listNoticeState(wrapper)).toBe("failed");

    // 反馈区再试读到权威缺失：候选行消失；空窗口不给"已更新"假成功。
    const patchCalls = calls.filter((call) => call.method === "PATCH").length;
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("用户最近在学吉他");
    expect(listNoticeState(wrapper)).toBeUndefined();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(patchCalls);
    // 编辑已清：离开守卫不再以脏稿拦截导航。
    await expect(attemptNavigate("/pages/chat/chat")).resolves.toBe(true);
    wrapper.unmount();
  });

  it("T-58 编辑 A 在途切到 B 后 A 的 404 晚到：不把无法保存写到 B 的编辑上", async () => {
    const patchGate = gate();
    let gateArmed = false;
    stubFetch({
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    gateArmed = true;
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的编辑。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // A 的编辑框仍开着；保存在途不拦截切换（T-58），切到第二条并改出
    // B 的有效新草稿。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    const input = wrapper.get('[data-testid="memory-edit-input"]');
    expect((input.element as HTMLTextAreaElement).value).toBe("用户的生日在三月。");
    await input.setValue("B 的草稿。");

    // A 的 404 晚到：404 属于旧条目，B 不得被标成无法保存或露出放弃
    // 入口，草稿与可保存状态保持不变。
    gateArmed = false;
    patchGate.resolve(response(404, null));
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-edit-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-edit-discard-refresh"]').exists()).toBe(false);
    const inputAfter = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(inputAfter.value).toBe("B 的草稿。");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("换号后 A 的挂起 404 晚到：不解锁新账号在途保存，B 自己的结果正常收束", async () => {
    const gateA = gate();
    const gateB = gate();
    let phase: "a" | "b" = "a";
    stubFetch({
      relationships: () => (phase === "a" ? RELATIONSHIPS : RELATIONSHIP_B),
      memoriesByRel: { 84: B_MEMORIES_R214 },
      patchGates: { m1: gateA, 201: gateB },
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：编辑 m1 并提交，PATCH 挂起。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // 真实换号清理（退出经 session-cleanup 重置 memory store、ownerEpoch
    // 递增，同时清掉 editBusy）后 B 账号登录并自动重读到 B 的列表。
    useAuthStore().clear();
    await flushPromises();
    phase = "b";
    loginAs("8");
    await flushPromises();
    expect(wrapper.text()).toContain("B：用户忌口香菜。");

    // B：开自己的编辑并提交（201 挂起，editBusy 占用中）。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("B 的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // A 的 404 晚到：epoch 已变，不写任何提示，也不得解锁 B 的在途保存。
    gateA.resolve(response(404, null));
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-edit-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();
    const draft = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(draft.value).toBe("B 的修改。");

    // B 自己的成功回包正常收束：B 的草稿提交到 B 的条目并退出编辑。
    gateB.resolve(response(200, memoryRow({ memoryId: "201", summary: "B 的修改。", autoSaved: false })));
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("B 的修改。");
    expect(wrapper.text()).not.toContain("B：用户忌口香菜。");
    wrapper.unmount();
  });

  it("换号后 A 的挂起删除晚到：不解锁新账号在途删除，B 自己的结果正常收束", async () => {
    const gateA = gate();
    const gateB = gate();
    let phase: "a" | "b" = "a";
    stubFetch({
      relationships: () => (phase === "a" ? RELATIONSHIPS : RELATIONSHIP_B),
      memoriesByRel: { 84: B_MEMORIES_R214 },
      deleteGates: { m1: gateA, "201": gateB },
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：删除 m1，DELETE 挂起（deleteBusy 占用中）。
    await wrapper.findAll('[data-testid="memory-delete"]')[0].trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-delete-confirm"]').attributes("disabled")).toBeDefined();

    // 真实换号清理（ownerEpoch 递增，清理链已释放 deleteBusy）后 B 登录重读。
    useAuthStore().clear();
    await flushPromises();
    phase = "b";
    loginAs("8");
    await flushPromises();
    expect(wrapper.text()).toContain("B：用户忌口香菜。");

    // B：删除自己的 201（DELETE 挂起，deleteBusy 再次占用）。
    await wrapper.findAll('[data-testid="memory-delete"]')[0].trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-delete-confirm"]').attributes("disabled")).toBeDefined();

    // A 的删除晚到：epoch 已变，不得解锁 B 的在途删除。
    gateA.resolve(response(200, memoryRow({ memoryId: "m1", deletedAt: "2026-09-04T00:00:00Z" })));
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-delete-confirm"]').attributes("disabled")).toBeDefined();

    // B 自己的成功回包正常收束。
    gateB.resolve(response(200, memoryRow({ memoryId: "201", deletedAt: "2026-09-04T00:00:00Z" })));
    await flushPromises();
    expect(wrapper.text()).not.toContain("B：用户忌口香菜。");
    wrapper.unmount();
  });

  it("换号后 A 的挂起候选确认晚到：不解锁新账号在途候选操作", async () => {
    const gateA = gate();
    const gateB = gate();
    let phase: "a" | "b" = "a";
    const bListWithCandidate = [
      memoryRow({
        memoryId: "211",
        summary: "B：候选待确认。",
        status: "PENDING_CONFIRMATION",
        autoSaved: false,
        conversationId: null,
      }),
    ];
    stubFetch({
      relationships: () => (phase === "a" ? RELATIONSHIPS : RELATIONSHIP_B),
      memoriesByRel: { 84: bListWithCandidate },
      confirmGates: { p1: gateA, "211": gateB },
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：确认候选 p1，POST confirm 挂起（pendingBusyId 占用中）。
    await pendingRowOf(wrapper, "学吉他").get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="pending-row"] [data-testid="pending-confirm"]').attributes("disabled"))
      .toBeDefined();

    // 换号后 B 登录重读到 B 的候选。
    useAuthStore().clear();
    await flushPromises();
    phase = "b";
    loginAs("8");
    await flushPromises();
    expect(wrapper.text()).toContain("B：候选待确认。");

    // B：确认自己的候选 211（confirm 挂起，pendingBusyId 再次占用）。
    await pendingRowOf(wrapper, "B：候选待确认").get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="pending-row"] [data-testid="pending-confirm"]').attributes("disabled"))
      .toBeDefined();

    // A 的确认晚到：epoch 已变，不得解锁 B 的在途候选操作。
    gateA.resolve(response(200, { ...echoMemory("p1"), status: "ACCEPTED", autoSaved: true }));
    await flushPromises();
    expect(wrapper.get('[data-testid="pending-row"] [data-testid="pending-confirm"]').attributes("disabled"))
      .toBeDefined();

    // B 自己的成功回包正常收束。
    gateB.resolve(response(200, { ...echoMemory("211"), status: "ACCEPTED", autoSaved: true }));
    await flushPromises();
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it("操作结果未知时提供刷新核对入口，核对确认后退出编辑", async () => {
    let edited = false;
    const { calls } = stubFetch({
      patchParseFailed: true,
      memories: () => edited
        ? [memoryRow({ summary: "结果未知的内容。", autoSaved: false }), ...DEFAULT_MEMORIES.slice(1)]
        : DEFAULT_MEMORIES,
    });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("结果未知的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    // 结果未知：编辑框与草稿保留，等待核对。
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);

    edited = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.url.includes("/memories") && call.method === "GET"))
      .toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    // 核对确认编辑已生效后才退出编辑。
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("删除需要一次确认，确定失败（4xx）保留原条目", async () => {
    const { calls } = stubFetch({ deleteStatus: 400 });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    expect(wrapper.find('[data-testid="memory-delete-box"]').exists()).toBe(true);
    await wrapper.get('[data-testid="memory-delete-cancel"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "DELETE",
      url: "/api/v1/memories/m1",
    }));
    expect(wrapper.get('[data-testid="memory-delete-error"]').text()).toContain("没有删除成功");
    expect(wrapper.get('[data-testid="memory-delete-box"]').text()).toContain("原聊天记录不会一并删除");
    expect(memoryRows(wrapper)).toHaveLength(2);

    wrapper.unmount();
  });

  it("删除成功后只移除该行", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();

    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("用户的生日在三月。");
    wrapper.unmount();
  });

  it("待确认候选逐条确认后进入已保存，拒绝后消失", async () => {
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-pending"]').text()).toContain("学吉他");
    const pendingRow = wrapper.get('[data-testid="pending-row"]');
    await pendingRow.get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({
      method: "POST",
      url: "/api/v1/memories/p1/confirm",
    }));
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("学吉他");
    wrapper.unmount();
  });

  it("候选提交中禁用该条重复动作，确认后进入已保存", async () => {
    let resolveConfirm!: (value: unknown) => void;
    const confirmGate = {
      promise: new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
      resolve: (value: unknown) => resolveConfirm(value),
    };
    stubFetch({ confirmGate });
    const wrapper = mountPage();
    await flushPromises();

    const confirmButton = wrapper.get('[data-testid="pending-row"] [data-testid="pending-confirm"]');
    const rejectButton = wrapper.get('[data-testid="pending-row"] [data-testid="pending-reject"]');
    await confirmButton.trigger("click");

    expect(confirmButton.attributes("disabled")).toBeDefined();
    expect(rejectButton.attributes("disabled")).toBeDefined();

    confirmGate.resolve(response(200, {
      ...echoMemory("p1"),
      status: "ACCEPTED",
      autoSaved: true,
    }));
    await flushPromises();

    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("学吉他");
    wrapper.unmount();
  });

  it("候选拒绝确定失败（4xx）保留原条并可重试", async () => {
    const rejectStatuses = [400, 200];
    stubFetch({
      rejectStatus: () => rejectStatuses.shift() ?? 200,
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="pending-row"] [data-testid="pending-reject"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="pending-error"]').text()).toContain("再试一次");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);

    await wrapper.get('[data-testid="pending-row"] [data-testid="pending-reject"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it("候选确认遇 404（另一会话已处理）给诚实提示与就地刷新，按权威列表进入已保存", async () => {
    // 服务端只对已不在待确认态的候选返回 404：本页仍显示旧行，"再试一次"
    // 永不成功。另一会话已确认 → 权威列表里该条为 ACCEPTED（非自动保存）。
    let processedElsewhere = false;
    const { calls } = stubFetch({
      confirmStatus: 404,
      memories: () => (processedElsewhere
        ? DEFAULT_MEMORIES.map((row) => (row.memoryId === "p1"
          ? { ...row, status: "ACCEPTED", autoSaved: false }
          : row))
        : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(listGetCount(calls)).toBe(1);

    processedElsewhere = true;
    await wrapper.get('[data-testid="pending-row"] [data-testid="pending-confirm"]').trigger("click");
    await flushPromises();

    // 不宣称已确认/已拒绝，不是可重试的"再试一次"，也不进未知核对；旧行保留，
    // 不自动发列表请求。
    const error = wrapper.get('[data-testid="pending-error"]');
    expect(error.text()).toContain("无法按待确认操作");
    expect(error.text()).toContain("刷新列表确认");
    expect(error.text()).not.toContain("再试一次");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    expect(listGetCount(calls)).toBe(1);

    await wrapper.get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();

    // 权威重读（复用 retryList 与 R208 反馈区）：该条按真实列表数据进入已保存
    // （"已确认"徽标来自列表的 autoSaved=false，不是 confirm 回显），待确认区
    // 与行内提示都消失。
    expect(listGetCount(calls)).toBe(2);
    expect(listNoticeState(wrapper)).toBe("success");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pending-error"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="memory-saved-list"]').text()).toContain("学吉他");
    const savedRows = memoryRows(wrapper);
    expect(savedRows).toHaveLength(3);
    expect(savedRows.map((row) => row.get('[data-testid="memory-badge"]').text()))
      .toEqual(["自动保存", "已确认", "已确认"]);
    wrapper.unmount();
  });

  it("候选拒绝遇 404 后刷新失败保留入口，再次刷新按权威列表隐藏该条", async () => {
    // 另一会话已处理/删除该候选：权威列表不再含它。刷新失败不当成功、不
    // 卸载入口（复用 retryList 的 loading 门与 R208 失败反馈）；成功后按列表分区。
    let listHttpStatus = 200;
    let removedElsewhere = false;
    const { calls } = stubFetch({
      rejectStatus: 404,
      memoriesStatus: () => listHttpStatus,
      memories: () => (removedElsewhere
        ? DEFAULT_MEMORIES.filter((row) => row.memoryId !== "p1")
        : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    removedElsewhere = true;
    await wrapper.get('[data-testid="pending-row"] [data-testid="pending-reject"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="pending-error"]').text()).toContain("刷新列表确认");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);

    listHttpStatus = 503;
    await wrapper.get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="pending-error"]').text()).toContain("刷新列表确认");
    expect(wrapper.find('[data-testid="pending-refresh"]').exists()).toBe(true);

    listHttpStatus = 200;
    await wrapper.get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();
    // 初始加载 + 失败刷新 + 成功刷新；该条按权威列表离开待确认区，不出现
    // 任何"已拒绝"/"没有生效"宣称。
    expect(listGetCount(calls)).toBe(3);
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("学吉他");
    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    expect(memoryRows(wrapper)).toHaveLength(2);
    wrapper.unmount();
  });

  it("候选 404 刷新在途时另一候选 404：旧快照回包只清发起行，不清新行的提示与入口", async () => {
    // 待确认按钮不因列表 loading 禁用：A 的刷新 GET 挂起期间用户仍可操作 B。
    // B 的 404 不推进写版本，store 会把 A 发起时的旧快照（A 已 ACCEPTED、B
    // 仍 PENDING）当 ok 写回；这次重读在归属上只属于 A，不得把 B 刚写入的
    // 提示与刷新入口一起清掉。
    const candidateB = memoryRow({
      memoryId: "p2",
      summary: "候选：用户周末想去游泳。",
      status: "PENDING_CONFIRMATION",
      createdAt: "2026-09-03T11:00:00Z",
    });
    const initial = [...DEFAULT_MEMORIES, candidateB];
    const staleSnapshot = [
      ...DEFAULT_MEMORIES.map((row) => (row.memoryId === "p1"
        ? { ...row, status: "ACCEPTED", autoSaved: false }
        : row)),
      candidateB,
    ];
    const fetchOptions: FetchOptions = {
      confirmStatus: 404,
      rejectStatus: 404,
      memories: () => initial,
    };
    const { calls } = stubFetch(fetchOptions);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(2);

    // A 确认 404 → A 行出现刷新入口。
    await pendingRowOf(wrapper, "学吉他").get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();
    expect(pendingRowOf(wrapper, "学吉他").find('[data-testid="pending-refresh"]').exists()).toBe(true);

    // A 的刷新 GET 挂起（R208 反馈区进入等待）。
    let resolveList!: (value: unknown) => void;
    const listGate = {
      promise: new Promise((resolve) => {
        resolveList = resolve;
      }),
      resolve: (value: unknown) => resolveList(value),
    };
    fetchOptions.memoriesGate = listGate;
    await pendingRowOf(wrapper, "学吉他").get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("pending");
    expect(listGetCount(calls)).toBe(2);

    // 挂起期间 B 拒绝 404 → 提示与入口转到 B 行（A 行的随动作开始清掉）。
    await pendingRowOf(wrapper, "游泳").get('[data-testid="pending-reject"]').trigger("click");
    await flushPromises();
    expect(pendingRowOf(wrapper, "游泳").get('[data-testid="pending-error"]').text()).toContain("刷新列表确认");
    expect(pendingRowOf(wrapper, "游泳").find('[data-testid="pending-refresh"]').exists()).toBe(true);
    expect(pendingRowOf(wrapper, "学吉他").find('[data-testid="pending-error"]').exists()).toBe(false);

    // 旧快照回包：A 已 ACCEPTED 进入已保存；B 仍 PENDING，其提示与入口必须保留。
    listGate.resolve(response(200, staleSnapshot));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("success");
    expect(memoryRows(wrapper)).toHaveLength(3);
    expect(wrapper.get('[data-testid="memory-saved-list"]').text()).toContain("学吉他");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);
    expect(pendingRowOf(wrapper, "游泳").get('[data-testid="pending-error"]').text()).toContain("刷新列表确认");
    expect(pendingRowOf(wrapper, "游泳").find('[data-testid="pending-refresh"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);

    // B 自己的入口仍可用：权威列表已不含 B → 离开待确认区。
    fetchOptions.memoriesGate = undefined;
    fetchOptions.memories = () => staleSnapshot.filter((row) => row.memoryId !== "p2");
    await pendingRowOf(wrapper, "游泳").get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(3);
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("游泳");
    expect(memoryRows(wrapper)).toHaveLength(3);
    wrapper.unmount();
  });

  it("刷新失败保留已加载内容并给出重试", async () => {
    let failing = false;
    const { calls } = stubFetch({
      memoriesStatus: () => (failing ? 503 : 200),
      patchParseFailed: true,
    });
    const wrapper = mountPage();
    await flushPromises();
    expect(memoryRows(wrapper)).toHaveLength(2);

    // 借助一次"结果未知"的编辑触发列表刷新，并让刷新失败。
    failing = true;
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("结果未知的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(listNoticeState(wrapper)).toBe("failed");
    expect(wrapper.get('[data-testid="memory-list-notice"]').text()).toContain("没有加载出来");
    // 核对刷新失败：未知提示与旧数据保留。
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(memoryRows(wrapper)).toHaveLength(2);

    failing = false;
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();
    // 初始加载 + 失败的刷新 + 成功的重试。
    expect(calls.filter((call) => call.url.includes("/memories") && call.method === "GET"))
      .toHaveLength(3);
    // R208：手动重载成功后同一反馈区显示"已更新"，同一按钮保留为"再次刷新"；
    // 列表级成功不抹掉写入核对——未知提示仍等待"刷新核对"按预期值确认。
    expect(listNoticeState(wrapper)).toBe("success");
    expect(wrapper.get('[data-testid="memory-list-notice"]').text()).toContain("已更新");
    expect(wrapper.get('[data-testid="memory-list-retry"]').text()).toBe("再次刷新");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(memoryRows(wrapper)).toHaveLength(2);
    wrapper.unmount();
  });

  it("真实空态解释这里保存什么", async () => {
    stubFetch({ memories: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-empty"]').text()).toContain("这里还什么都没存");
    expect(wrapper.get('[data-testid="memory-empty"]').text()).toContain("帮陪伴记住你");
    wrapper.unmount();
  });

  it("合法 EXPIRED/PROPOSED 行不拖垮整页读取，也不进入活动视图", async () => {
    // V68 的 vc.list_memory 会把过期事件惰性改为 EXPIRED 并照常返回；
    // PROPOSED 也是契约合法状态。整页真实 fetch 初读必须成功，两类行
    // 只保留在完整 items 里（避免误确认/误删除核对），不进入已保存与
    // 待确认两个活动视图。
    stubFetch({
      memories: [
        ...DEFAULT_MEMORIES,
        memoryRow({
          memoryId: "x1",
          summary: "用户上个月预约了牙医。",
          status: "EXPIRED",
          eventAt: "2026-09-10T10:00:00Z",
          eventStatus: "PLANNED",
          eventExpiresAt: "2026-09-11T10:00:00Z",
        }),
        memoryRow({
          memoryId: "pr1",
          summary: "提案：用户在学尤克里里。",
          status: "PROPOSED",
          autoSaved: false,
        }),
      ],
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(listNoticeState(wrapper)).toBeUndefined();
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.get('[data-testid="memory-pending"]').text()).toContain("学吉他");
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(1);
    expect(wrapper.text()).not.toContain("预约了牙医");
    expect(wrapper.text()).not.toContain("尤克里里");

    // 完整列表保留合法行的身份：删除核对不得把解析缺失误当条目已不存在。
    expect(useMemoryStore().items.map((item) => `${item.memoryId}:${item.status}`))
      .toEqual([
        "m1:ACCEPTED",
        "m2:ACCEPTED",
        "p1:PENDING_CONFIRMATION",
        "x1:EXPIRED",
        "pr1:PROPOSED",
      ]);
    wrapper.unmount();
  });

  it("缺少默认陪伴时给出未就绪状态", async () => {
    stubFetch({ relationships: [] });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-missing"]').text()).toContain("还没准备好");
    wrapper.unmount();
  });

  function gate(): Gate {
    let resolve!: (value: unknown) => void;
    return {
      promise: new Promise((res) => {
        resolve = res;
      }),
      resolve: (value: unknown) => resolve(value),
    };
  }

  it("A 退出后 B 进入记忆页：加载中不显示 A 的记忆", async () => {
    const bGate = gate();
    let phaseB = false;
    stubFetch({
      get memoriesGate() {
        return phaseB ? bGate : undefined;
      },
    });
    const wrapperA = mountPage();
    await flushPromises();
    expect(memoryRows(wrapperA)).toHaveLength(2);

    // 退出 A（真实清理链路重置 memory store），B 登录后进入记忆页，列表请求挂起。
    wrapperA.unmount();
    useAuthStore().clear();
    login();
    phaseB = true;
    const wrapperB = mountPage();

    expect(wrapperB.find('[data-testid="memory-loading"]').exists()).toBe(true);
    expect(wrapperB.findAll('[data-testid="memory-row"]')).toHaveLength(0);
    expect(wrapperB.text()).not.toContain("晚上散步");
    expect(useMemoryStore().items).toEqual([]);

    bGate.resolve(response(200, []));
    await flushPromises();
    expect(wrapperB.find('[data-testid="memory-loading"]').exists()).toBe(false);
    expect(wrapperB.find('[data-testid="memory-empty"]').exists()).toBe(true);
    wrapperB.unmount();
  });

  it("B 加载失败时错误态属于 B，不显示 A 的内容", async () => {
    let phaseB = false;
    stubFetch({
      get memoriesStatus() {
        return phaseB ? 503 : 200;
      },
    });
    const wrapperA = mountPage();
    await flushPromises();
    expect(memoryRows(wrapperA)).toHaveLength(2);

    wrapperA.unmount();
    useAuthStore().clear();
    login();
    phaseB = true;
    const wrapperB = mountPage();
    await flushPromises();

    expect(wrapperB.find('[data-testid="memory-loading"]').exists()).toBe(false);
    expect(listNoticeState(wrapperB)).toBe("failed");
    expect(wrapperB.get('[data-testid="memory-list-notice"]').text()).toContain("没有加载出来");
    expect(wrapperB.findAll('[data-testid="memory-row"]')).toHaveLength(0);
    expect(wrapperB.text()).not.toContain("晚上散步");
    expect(useMemoryStore().items).toEqual([]);
    wrapperB.unmount();
  });

  it("A 的编辑响应在退出换号后晚到：不写入 B 的状态", async () => {
    const patchGate = gate();
    let gateArmed = false;
    let phaseB = false;
    const B_ROWS = [memoryRow({ memoryId: "b1", summary: "B 的记忆。", autoSaved: false })];
    stubFetch({
      memories: () => (phaseB ? B_ROWS : DEFAULT_MEMORIES),
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // 保存请求在途时退出并切换到 B：R214 换号清理作废旧页状态后，可见页
    // 自动按新确立身份重读（这里读到 B 的列表）。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的晚到编辑。");
    gateArmed = true;
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // 保存请求在途时退出并切换到 B：真实链路里 clear 与新身份读回之间隔着
    // session GET 的 await，这里同样分开 flush 让两次身份变更分别可见。
    useAuthStore().clear();
    await flushPromises();
    login();
    phaseB = true;
    await flushPromises();
    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");

    patchGate.resolve(response(200, memoryRow({ memoryId: "m1", summary: "A 的晚到编辑。", autoSaved: false })));
    await flushPromises();

    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");
    expect(wrapper.text()).not.toContain("A 的晚到编辑。");
    wrapper.unmount();
  });

  it("A 的删除响应在退出换号后晚到：不写入 B 的状态", async () => {
    const deleteGate = gate();
    let gateArmed = false;
    let phaseB = false;
    const B_ROWS = [memoryRow({ memoryId: "b1", summary: "B 的记忆。", autoSaved: false })];
    stubFetch({
      memories: () => (phaseB ? B_ROWS : DEFAULT_MEMORIES),
      get deleteGate() {
        return gateArmed ? deleteGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // 删除请求在途时退出并切换到 B：R214 换号清理后可见页自动重读到 B 的
    // 列表，A 的晚到删除不得移除 B 的条目。
    gateArmed = true;
    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-delete-confirm"]').attributes("disabled")).toBeDefined();

    // 删除请求在途时退出并切换到 B（clear 与新身份读回分开 flush）：R214
    // 换号清理后可见页自动重读到 B 的列表，A 的晚到删除不得移除 B 的条目。
    useAuthStore().clear();
    await flushPromises();
    login();
    phaseB = true;
    await flushPromises();
    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");

    deleteGate.resolve(response(200, memoryRow({ memoryId: "m1", deletedAt: "2026-09-04T00:00:00Z" })));
    await flushPromises();

    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");
    wrapper.unmount();
  });

  // ---- N-07 / F-07：写操作未知结果与开关状态确认 ----

  it("T-54 开关首次读取失败：显示状态待确认，不按默认值操作", async () => {
    let failing = true;
    const { calls } = stubFetch({ prefStatus: () => (failing ? 500 : 200) });
    const wrapper = mountPage();
    await flushPromises();

    const toggle = wrapper.get('[data-testid="autosave-toggle"]');
    expect(toggle.text()).toBe("状态待确认");
    expectUnknownToggle(toggle);

    // 不按 false 默认值误开启：点击不产生写入。
    await toggle.trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);

    failing = false;
    await wrapper.get('[data-testid="autosave-retry"]').trigger("click");
    await flushPromises();
    const confirmed = wrapper.get('[data-testid="autosave-toggle"]');
    expect(confirmed.text()).toBe("已开启");
    expectKnownToggle(confirmed, "true");
    wrapper.unmount();
  });

  it("T-54 开关首次读取回包缺 enabled：保持状态待确认，不显示已关闭也不产生写入", async () => {
    const { calls } = stubFetch({ prefGetBody: {} });
    const wrapper = mountPage();
    await flushPromises();

    const toggle = wrapper.get('[data-testid="autosave-toggle"]');
    expect(toggle.text()).toBe("状态待确认");
    expectUnknownToggle(toggle);

    // 不按 false 默认值误开启：点击不产生写入。
    await toggle.trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
    wrapper.unmount();
  });

  it("T-55 开关写入网络中断：结果未知，重新读取确认且不重复写", async () => {
    // PUT 实际已在服务端生效（enabled=false），但响应因网络中断丢失。
    let serverEnabled = true;
    const { calls } = stubFetch({ putNetworkError: true, prefEnabled: () => serverEnabled });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已开启");

    await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="autosave-unknown"]').text()).toContain("未能确认");
    expect(wrapper.get('[data-testid="autosave-toggle"]').attributes("disabled")).toBeDefined();

    // 未知状态下先核对：再次点击不产生第二次 PUT（不重复 toggle、不误开）。
    await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);

    // 重新读取：服务端确认 enabled=false（写入已生效），不自动反转重试。
    serverEnabled = false;
    await wrapper.get('[data-testid="autosave-reload"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="autosave-unknown"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="autosave-rejected"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已关闭");
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    wrapper.unmount();
  });

  it("T-55 未知写入后重新读取失败：挂起保持待确认，旧值不复活，读到真实值才恢复", async () => {
    let phase: "initial" | "refail" | "final" = "initial";
    const refailGate = gate();
    const { calls } = stubFetch({
      putParseFailed: true,
      prefEnabled: () => (phase === "initial" ? false : true),
      prefStatus: () => (phase === "refail" ? 503 : 200),
      get prefGate() {
        return phase === "refail" ? refailGate : undefined;
      },
    });
    const wrapper = mountPage();
    try {
      await flushPromises();

      // 先确认 false。
      const confirmed = wrapper.get('[data-testid="autosave-toggle"]');
      expect(confirmed.text()).toBe("已关闭");
      expectKnownToggle(confirmed, "false");

      // 用户开启：PUT 回包不可解析，结果未知。
      await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-testid="autosave-unknown"]').text()).toContain("未能确认");

      // 重新读取挂起：读取提示可见，旧 false 不得复活为"已关闭"。
      phase = "refail";
      await wrapper.get('[data-testid="autosave-reload"]').trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-testid="autosave-loading"]').text()).toContain("正在读取开关状态");
      const pendingToggle = wrapper.get('[data-testid="autosave-toggle"]');
      expect(pendingToggle.text()).toBe("状态待确认");
      expectUnknownToggle(pendingToggle);

      // 放行 503：进入错误态，仍保持待确认且禁用。
      refailGate.resolve(response(503, null));
      await flushPromises();
      expect(wrapper.find('[data-testid="autosave-loading"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="autosave-error"]').text()).toContain("没有加载出来");
      const toggle = wrapper.get('[data-testid="autosave-toggle"]');
      expect(toggle.text()).toBe("状态待确认");
      expectUnknownToggle(toggle);

      // 最终读到真实 true：显示已开启，全程只发过一次 PUT。
      phase = "final";
      await wrapper.get('[data-testid="autosave-retry"]').trigger("click");
      await flushPromises();
      const restored = wrapper.get('[data-testid="autosave-toggle"]');
      expect(restored.text()).toBe("已开启");
      expectKnownToggle(restored, "true");
      expect(wrapper.find('[data-testid="autosave-unknown"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="autosave-rejected"]').exists()).toBe(false);
      expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    } finally {
      // 用例中途失败时也要放行挂起的读取并卸载，避免残留 15s 请求定时器。
      refailGate.resolve(response(503, null));
      wrapper.unmount();
    }
  });

  it("T-55 重新读取发现写入未生效时给出确定提示", async () => {
    stubFetch({ putNetworkError: true, prefEnabled: true });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="autosave-unknown"]').exists()).toBe(true);

    await wrapper.get('[data-testid="autosave-reload"]').trigger("click");
    await flushPromises();

    // 权威值仍为 true，目标 false：修改确定未生效，不静默清除。
    expect(wrapper.get('[data-testid="autosave-rejected"]').text()).toContain("没有生效");
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已开启");
    wrapper.unmount();
  });

  it("T-56 编辑 5xx 结果未知：不宣布失败，保留草稿等待核对", async () => {
    stubFetch({ patchStatus: () => 500 });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("改到一半的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-edit-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("改到一半的内容。");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("T-56 删除 5xx 结果未知：保留条目并标注核对中，不写\"还在\"断言", async () => {
    stubFetch({ deleteStatus: 500 });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-delete-error"]').exists()).toBe(false);
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.get('[data-testid="memory-verifying"]').text()).toContain("核对中");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("T-56 删除未知结果经核对确认后移除条目", async () => {
    let deleted = false;
    stubFetch({
      deleteStatus: 500,
      memories: () => (deleted ? DEFAULT_MEMORIES.slice(1) : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(true);

    deleted = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("T-56 删除未知结果经核对发现未生效时提示并保留条目", async () => {
    stubFetch({ deleteStatus: 500 });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();

    // 列表仍返回该条目：删除确定未生效（权威数据）。
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-rejected"]').text()).toContain("没有生效");
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("删除未知核对回包残缺（含无法解析的行）时不误判删除完成", async () => {
    let phase: "initial" | "weird" | "verified" = "initial";
    const { calls } = stubFetch({
      deleteStatus: 500,
      memories: () => {
        if (phase === "initial") return DEFAULT_MEMORIES;
        if (phase === "weird") {
          // 核对回包里 m1 仍在，但 status=WEIRD 使该行无法按契约解析，
          // 其余行正常：残缺列表不得被当作权威数据。
          return [memoryRow({ status: "WEIRD" }), ...DEFAULT_MEMORIES.slice(1)];
        }
        return DEFAULT_MEMORIES.slice(1);
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-verifying"]').text()).toContain("核对中");

    phase = "weird";
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    // 读取失败：不得宣布删除完成/失败，也不重放 DELETE。
    expect(listNoticeState(wrapper)).toBe("failed");
    expect(wrapper.get('[data-testid="memory-list-notice"]').text()).toContain("没有加载出来");
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.text()).toContain("晚上散步");
    expect(wrapper.text()).toContain("用户的生日在三月。");
    expect(wrapper.get('[data-testid="memory-verifying"]').text()).toContain("核对中");
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");
    expect(wrapper.find('[data-testid="memory-refresh"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);

    // 读到真实完整且确实无 m1 的权威列表后，同一核对入口才移除条目。
    phase = "verified";
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("用户的生日在三月。");
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    wrapper.unmount();
  });

  it("T-57 存在性隐藏被适配为空列表时未知提示与条目保留", async () => {
    let hidden = false;
    stubFetch({
      deleteStatus: 500,
      memoriesStatus: () => (hidden ? 404 : 200),
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(true);

    hidden = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    // 404 被适配为空列表：空值不证明删除成功，未知提示与条目都保留。
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-verifying"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("T-58 编辑 A 在途时切到编辑 B：A 成功回调不关闭也不覆盖 B 的草稿", async () => {
    const patchGate = gate();
    let gateArmed = false;
    stubFetch({
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    gateArmed = true;
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的编辑。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // A 的编辑框仍开着；切到第二条（B）编辑。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    const input = wrapper.get('[data-testid="memory-edit-input"]');
    expect((input.element as HTMLTextAreaElement).value).toBe("用户的生日在三月。");
    await input.setValue("B 的草稿。");

    // A 的成功响应晚到：不得关闭 B 的编辑框或覆盖 B 的草稿。
    gateArmed = false;
    patchGate.resolve(response(200, memoryRow({ memoryId: "m1", summary: "A 的编辑。", autoSaved: false })));
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const inputAfter = wrapper.get('[data-testid="memory-edit-input"]');
    expect((inputAfter.element as HTMLTextAreaElement).value).toBe("B 的草稿。");
    expect(wrapper.text()).toContain("A 的编辑。");
    wrapper.unmount();
  });

  it("R192 保存 A 在途时继续输入 B：A 成功写回列表但保留 B 草稿，再保存实际提交 B", async () => {
    const patchGate = gate();
    let gateArmed = false;
    const { calls } = stubFetch({
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：进入编辑、填入 A 并保存；首笔 PATCH 被挂起，按钮进入忙态。
    gateArmed = true;
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R192提交内容A");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();
    let patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toBe(JSON.stringify({ summary: "R192提交内容A" }));

    // 忙态期间同一编辑框继续输入后续草稿 B（textarea 仍可编辑）。
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R192后续草稿B");

    // 释放 A 的成功响应：列表写回 A，但 B 草稿保留、编辑框不关、可再次保存。
    gateArmed = false;
    patchGate.resolve(response(200, memoryRow({ memoryId: "m1", summary: "R192提交内容A", autoSaved: false })));
    await flushPromises();

    expect(wrapper.get('[data-testid="memory-summary"]').text()).toContain("R192提交内容A");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R192后续草稿B");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="memory-edit-save"]').text()).toBe("保存");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    // 再次保存：第二笔 PATCH 实际携带 B，成功回读 B 并退出编辑。
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]?.body).toBe(JSON.stringify({ summary: "R192后续草稿B" }));
    expect(wrapper.get('[data-testid="memory-summary"]').text()).toContain("R192后续草稿B");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("R193 核对未知编辑结果时后续草稿不丢：确认 A 收束提示但保留 B，再保存实际提交 B", async () => {
    // 首笔 PATCH 服务端已存 A 但 200 回包不可解析（结果未知）；第二笔正常成功。
    let patchUnknown = true;
    let stored = DEFAULT_MEMORIES;
    const { calls } = stubFetch({
      get patchParseFailed() {
        return patchUnknown;
      },
      memories: () => stored,
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：保存后结果未知，编辑框与草稿保留等待核对。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R193未知提交A");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    // 服务端实际已存 A；用户在同一编辑框继续输入后续草稿 B。
    stored = [memoryRow({ summary: "R193未知提交A", autoSaved: false }), ...DEFAULT_MEMORIES.slice(1)];
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R193核对前新增草稿B");

    // 刷新核对：权威列表确认 A，未知提示收束；B 草稿与编辑框保留且可再保存，
    // 核对本身不代发 PATCH。
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-summary"]').text()).toContain("R193未知提交A");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R193核对前新增草稿B");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeUndefined();
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    // 再次保存：第二笔 PATCH 实际携带 B，成功回读 B 后正常退出编辑。
    patchUnknown = false;
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]?.body).toBe(JSON.stringify({ summary: "R193核对前新增草稿B" }));
    expect(wrapper.get('[data-testid="memory-summary"]').text()).toContain("R193核对前新增草稿B");
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("首载存在性隐藏（404）不伪装成确定空态：提示暂时无法确认并可重读", async () => {
    let hidden = true;
    stubFetch({
      memoriesStatus: () => (hidden ? 404 : 200),
      memories: [],
    });
    const wrapper = mountPage();
    await flushPromises();

    // 存在性隐藏被适配为空列表：空值不可信，不得显示确定空态。
    expect(wrapper.find('[data-testid="memory-empty"]').exists()).toBe(false);
    const inconclusive = wrapper.get('[data-testid="memory-list-inconclusive"]');
    expect(inconclusive.text()).toContain("暂时无法确认");
    expect(wrapper.get('[data-testid="memory-inconclusive-retry"]').text()).toContain("重新读取");

    // 重读拿到权威数据（这里为权威空列表）后恢复确定视图。
    hidden = false;
    await wrapper.get('[data-testid="memory-inconclusive-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-list-inconclusive"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="memory-empty"]').text()).toContain("这里还什么都没存");
    wrapper.unmount();
  });

  it("读取结果不确定但已有内容：保留旧数据并给出轻量不确定提示", async () => {
    let hidden = false;
    stubFetch({ memoriesStatus: () => (hidden ? 404 : 200) });
    const wrapper = mountPage();
    await flushPromises();
    expect(memoryRows(wrapper)).toHaveLength(2);

    // 同一会话内重新进入页面（store 共享），这次存在性隐藏。
    wrapper.unmount();
    hidden = true;
    const remounted = mountPage();
    await flushPromises();

    expect(memoryRows(remounted)).toHaveLength(2);
    expect(remounted.find('[data-testid="memory-empty"]').exists()).toBe(false);
    expect(listNoticeState(remounted)).toBe("inconclusive");
    expect(remounted.get('[data-testid="memory-list-notice"]').text())
      .toContain("可能不是当前列表");
    expect(remounted.get('[data-testid="memory-list-retry"]').text()).toBe("重新读取");
    remounted.unmount();
  });

  it("同一条目前次保存未知、再次保存成功后核对不误报\"没有生效\"", async () => {
    let patchCount = 0;
    let edited = false;
    stubFetch({
      patchStatus: () => (patchCount++ === 0 ? 500 : 200),
      memories: () => edited
        ? [memoryRow({ summary: "第二次的修改。", autoSaved: false }), ...DEFAULT_MEMORIES.slice(1)]
        : DEFAULT_MEMORIES,
    });
    const wrapper = mountPage();
    await flushPromises();

    // 第一次保存结果未知：进入核对流程。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第一次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");

    // 不退出编辑，继续修改并保存成功：服务端已确认第二次的修改。
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第二次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("第二次的修改。");

    // 核对读到权威列表（第二次的修改）：不得用旧期望误报"没有生效"。
    edited = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("没有生效");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("同一条目连续两次保存未知：保留单一未知提示并按最新期望核对", async () => {
    let editedTwice = false;
    stubFetch({
      patchStatus: () => 500,
      memories: () => editedTwice
        ? [memoryRow({ summary: "第二次的修改。", autoSaved: false }), ...DEFAULT_MEMORIES.slice(1)]
        : DEFAULT_MEMORIES,
    });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第一次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");

    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第二次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    // 单一未知提示，不叠加、不误报失败；草稿保留等待核对。
    expect(wrapper.findAll('[data-testid="memory-unknown"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("第二次的修改。");

    // 服务端已有第二次的修改（最新期望值）：核对通过后提示清除。
    editedTwice = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("核对读取在途时同条目再次保存又未知：旧期望失效，不误报\"没有生效\"", async () => {
    const listGate = gate();
    let gateArmed = false;
    let applied = false;
    stubFetch({
      patchParseFailed: true,
      memories: () => applied
        ? [memoryRow({ summary: "第二次的修改。", autoSaved: false }), ...DEFAULT_MEMORIES.slice(1)]
        : DEFAULT_MEMORIES,
      get memoriesGate() {
        return gateArmed ? listGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // 第一次保存结果未知：进入核对流程（期望＝第一次的修改）。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第一次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");

    // 核对读取挂起期间，用户对同一条目再次保存，同样结果未知：
    // saveEdit 已把未知结果的期望更新为"第二次的修改"（旧期望失效）。
    gateArmed = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第二次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();

    // 读取返回权威列表（服务端已生效第二次的修改）：不得用挂起前的旧
    // 期望把已生效的写入误报为"没有生效"，也不得清掉更新后的未知状态。
    gateArmed = false;
    listGate.resolve(response(200, [
      memoryRow({ summary: "第二次的修改。", autoSaved: false }),
      ...DEFAULT_MEMORIES.slice(1),
    ]));
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("没有生效");
    // 更新后的未知状态（期望＝第二次的修改）保留，仍可正常核对清除。
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    applied = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("核对读取在途时另一条目产生新未知结果：读取返回不误清新未知提示", async () => {
    // M1 的未知结果保留草稿，切到 M2 前需要用户确认丢弃（R191）：
    // 这里 mock 用户明确选择切换。
    vi.stubGlobal("confirm", vi.fn(() => true));
    const listGate = gate();
    let gateArmed = false;
    stubFetch({
      patchParseFailed: true,
      get memoriesGate() {
        return gateArmed ? listGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // M1 编辑保存结果未知：进入核对流程。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("第一次的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="memory-unknown"]').text()).toContain("未能确认结果");

    // 核对读取挂起期间，用户切到 M2 编辑保存，同样结果未知：
    // unknownAction 已被 M2 的未知结果取代。
    gateArmed = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    // M1 的编辑框因未知结果保留，剩余的编辑按钮属于 M2。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("M2 的修改。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);

    // 读取返回：M1 与挂起前的期望一致（写入实际已生效）。不得据此清掉
    // M2 的"未能确认结果"提示。
    gateArmed = false;
    listGate.resolve(response(200, [
      memoryRow({ summary: "第一次的修改。" }),
      ...DEFAULT_MEMORIES.slice(1),
    ]));
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("T-58 编辑 A 的未知结果晚到时不影响已切换到 B 的编辑", async () => {
    const patchGate = gate();
    let gateArmed = false;
    stubFetch({
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    gateArmed = true;
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的编辑。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");

    // A 的编辑框仍开着；切到第二条（B）编辑。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("B 的草稿。");

    // A 的响应不可解析（结果未知）且晚到：不触碰 B 的编辑框与草稿。
    gateArmed = false;
    patchGate.resolve(response(200, null, true));
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("B 的草稿。");
    wrapper.unmount();
  });

  it("R191 切换编辑时保护未保存草稿：取消保留、确认切换、未改动不确认，全程不发 PATCH", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    // A：进入编辑并留下未保存草稿。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R191 的未保存草稿。");

    // 有未保存改动时切到 B：先弹原生确认；取消则保留 A 的草稿与编辑状态。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    let input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R191 的未保存草稿。");

    // 确认切换：草稿被 B 的当前 summary 取代（页面上的草稿不保留）。
    confirmMock.mockReturnValue(true);
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    expect(confirmMock).toHaveBeenCalledTimes(2);
    input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("用户的生日在三月。");

    // B 未改动切回 A：不弹确认，直接切换。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    expect(confirmMock).toHaveBeenCalledTimes(2);
    input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("用户喜欢在晚上散步。");

    // 只发生了页面内切换，全程不产生任何 PATCH。
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    wrapper.unmount();
  });

  it("R194 脏稿离开页面先确认：取消留在本页，确认放行，全程不发 PATCH", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { attemptNavigate } = stubLeaveRouter();
    const { calls } = stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R194 的未保存草稿。");

    // 取消离开：导航被拦，草稿与编辑状态留在本页。
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R194 的未保存草稿。");

    // 确认离开：放行导航。
    confirmMock.mockReturnValue(true);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(2);

    // 守卫只做确认，绝不代发 PATCH。
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    wrapper.unmount();
  });

  it("R194 未编辑/未改动/显式取消后离开不确认；登录目标与退出身份放行", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { attemptNavigate } = stubLeaveRouter();
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    // 未编辑：直接放行。
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);

    // 编辑但未改动：直接放行。
    await openEdit(wrapper, "memory-edit");
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);

    // 显式取消编辑后：直接放行。
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("改动后又取消。");
    await wrapper.get('[data-testid="memory-edit-cancel"]').trigger("click");
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);

    // 有脏稿也不阻登录目标。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("登录前的脏稿。");
    await expect(attemptNavigate("/pages/login/login")).resolves.toBe(true);

    // 退出身份（真实 AuthStore.clear 已重置 memory.items）：非登录目标也
    // 放行，旧账号草稿不拦换号/登录链路。
    useAuthStore().clear();
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);

    expect(confirmMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("R194 刷新只拦当前脏稿，卸载后移除路由守卫与 beforeunload 监听", async () => {
    const { guards } = stubLeaveRouter();
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();
    expect(guards).toHaveLength(1);

    // 未编辑：刷新不拦。
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    // 脏稿：刷新拦下；显式取消编辑后恢复不拦。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R194 的未保存草稿。");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    await wrapper.get('[data-testid="memory-edit-cancel"]').trigger("click");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    // 卸载（真实离开页面）：注册的守卫与监听一并移除，脏稿不再拦截。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("卸载前的脏稿。");
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    wrapper.unmount();
    expect(guards).toHaveLength(0);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("R194 确认离开且真正 deactivated 才移除守卫；重进只读/再激活不弹旧确认", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { guards, attemptNavigate } = stubLeaveRouter();
    stubFetch();
    const { host, active } = mountPageInKeepAlive();
    await flushPromises();

    // A：在 KeepAlive 宿主（同 uni-h5 页面容器）内编辑留下脏稿。
    await host.get('[data-testid="memory-edit"]').trigger("click");
    await host.get('[data-testid="memory-edit-input"]').setValue("R194 返回前需保留的草稿。");
    expect(guards).toHaveLength(1);

    // 取消离开：导航被拦，守卫与 beforeunload 保持有效——deactivated 未
    // 发生，任何早于路由判定的页面退出时序都不得提前解除保护。
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(guards).toHaveLength(1);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    // 确认离开：放行导航 ≠ 页面已 deactivated；缓存失活后守卫才移除。
    confirmMock.mockReturnValue(true);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);
    expect(guards).toHaveLength(1);
    active.value = false;
    await nextTick();
    expect(guards).toHaveLength(0);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    // 重进的新只读实例（未编辑）页面返回：不弹旧实例的脏稿确认。
    const wrapperB = mountPage();
    await flushPromises();
    expect(wrapperB.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(2);

    // 再激活缓存旧实例：未保存草稿原样保留并重新受保护（取消仍留本页），
    // 不是待清理的旧状态——因此 deactivated 时无需清草稿。
    confirmMock.mockReturnValue(false);
    active.value = true;
    await nextTick();
    expect(guards).toHaveLength(2);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(3);
    const input = host.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R194 返回前需保留的草稿。");

    host.unmount();
    wrapperB.unmount();
  });

  it("R233 权威刷新移除正在编辑行（空窗口）：恢复框保留草稿可复制，离开需确认，明确放弃不发读写", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { attemptNavigate } = stubLeaveRouter();
    let refreshed = false;
    const { calls } = stubFetch({
      confirmStatus: () => 404,
      memories: () => (refreshed ? [] : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    // Root 复现路径：编辑已保存行留下脏稿（不保存），源行仍可渲染时
    // 不出现恢复框。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R233 刷新后仍应能复制的草稿。");
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(false);

    // 候选被远端处理：确认 404 → 行内"刷新列表" → 权威回包不含被编辑行。
    await wrapper.get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();
    refreshed = true;
    await wrapper.get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();

    // 整页进入空态，行内编辑器随行卸载；恢复框挂在空态/分区链之外，
    // 继续承载同一份草稿（可见可复制）。
    expect(wrapper.find('[data-testid="memory-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(true);
    let input = wrapper.get('[data-testid="memory-orphan-draft-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R233 刷新后仍应能复制的草稿。");
    expect(wrapper.get('[data-testid="memory-orphan-draft-note"]').text()).toContain("已不在当前列表中");

    // 离开保护：取消留在本页且草稿原样，确认放行。
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    input = wrapper.get('[data-testid="memory-orphan-draft-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R233 刷新后仍应能复制的草稿。");
    confirmMock.mockReturnValue(true);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledTimes(2);

    // 明确放弃：清稿即收起恢复框，不发任何读写，之后离开不再确认。
    const getsBeforeDiscard = listGetCount(calls);
    confirmMock.mockClear();
    await wrapper.get('[data-testid="memory-orphan-draft-discard"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(false);
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(listGetCount(calls)).toBe(getsBeforeDiscard);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    wrapper.unmount();
  });

  it("R233 恢复框存在时切换编辑可见行：先确认，取消保留孤儿草稿", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    let refreshed = false;
    const { calls } = stubFetch({
      confirmStatus: () => 404,
      memories: () => (refreshed
        ? DEFAULT_MEMORIES.filter((row) => row.memoryId === "m2")
        : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    // 编辑 m1 留脏稿；候选 404 的行内刷新把权威列表收窄到只剩可见的 m2。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R233 恢复框里的孤儿草稿。");
    await wrapper.get('[data-testid="pending-confirm"]').trigger("click");
    await flushPromises();
    refreshed = true;
    await wrapper.get('[data-testid="pending-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(true);
    expect(memoryRows(wrapper)).toHaveLength(1);

    // 切到可见行 m2：恢复框里的草稿同样有丢失风险，先确认；取消则保留。
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(true);
    const orphanInput = wrapper.get('[data-testid="memory-orphan-draft-input"]').element as HTMLTextAreaElement;
    expect(orphanInput.value).toBe("R233 恢复框里的孤儿草稿。");

    // 确认切换：恢复框消失，m2 行内编辑框载入 m2 的已保存内容。
    confirmMock.mockReturnValue(true);
    await wrapper.findAll('[data-testid="memory-edit"]')[0].trigger("click");
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(false);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("用户的生日在三月。");

    // 全程只有初始读取、候选 404 后的一次刷新，切换本身不发 PATCH。
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    wrapper.unmount();
  });

  it("R233 待确认行被远端 REJECTED（仍在 items 却不可渲染）：刷新后恢复框保留草稿并维持离开保护", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { attemptNavigate } = stubLeaveRouter();
    let refreshed = false;
    stubFetch({
      patchStatus: () => 500,
      memories: () => (refreshed
        ? [
            ...DEFAULT_MEMORIES.filter((row) => row.memoryId !== "p1"),
            memoryRow({
              memoryId: "p1",
              summary: "候选：用户最近在学吉他。",
              status: "REJECTED",
              createdAt: "2026-09-03T10:00:00Z",
            }),
          ]
        : DEFAULT_MEMORIES),
    });
    const wrapper = mountPage();
    await flushPromises();

    // 编辑候选 p1 → 保存 5xx 结果未知：草稿留在行内编辑框等待核对。
    await openEdit(wrapper, "pending-edit");
    await wrapper.get('[data-testid="pending-edit-input"]').setValue("候选改成周末去公园。");
    await wrapper.get('[data-testid="pending-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="pending-edit-box"]').exists()).toBe(true);

    // 刷新核对：权威回包里 p1 仍在 items（远端已 REJECTED）但不再可渲染。
    refreshed = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-pending"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="pending-row"]')).toHaveLength(0);
    expect(useMemoryStore().items.some((item) => item.memoryId === "p1" && item.status === "REJECTED")).toBe(true);
    expect(wrapper.find('[data-testid="memory-orphan-draft"]').exists()).toBe(true);
    const orphanInput = wrapper.get('[data-testid="memory-orphan-draft-input"]').element as HTMLTextAreaElement;
    expect(orphanInput.value).toBe("候选改成周末去公园。");
    // 核对按预期值比较：编辑确实未生效，给出确定提示；草稿与恢复框保留。
    expect(wrapper.get('[data-testid="memory-rejected"]').text()).toContain("没有生效");

    // 行不在视图但草稿非空：离开仍需确认。
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("R204 键盘激活编辑后焦点落入编辑框，不因按钮被替换掉回 body", async () => {
    stubFetch();
    const wrapper = mountPage();
    await flushPromises();

    // 键盘用户先聚焦"编辑"按钮再激活（Enter/Space 走 click）。
    const editButton = wrapper.get('[data-testid="memory-edit"]');
    (editButton.element as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(editButton.element);

    await editButton.trigger("click");
    await flushPromises();

    // 激活后"编辑"按钮所在操作区被编辑框替换，焦点掉回 body（实机证据：
    // activeElement=BODY）：编辑打开后缺少明确输入焦点，下一次 Tab 才落入
    // 本条 textarea，键盘用户需补一次 Tab 且无输入位置宣告。修复后激活
    // 即聚焦 textarea，可立即开始改写。
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);
    wrapper.unmount();
  });

  it("R208 键盘重试列表：等待中同一反馈区与按钮保留焦点并挡重复 GET，再次失败与成功都不卸载按钮", async () => {
    const retryGate = gate();
    let gateArmed = false;
    let failing = false;
    const { calls } = stubFetch({
      memoriesStatus: () => (failing ? 503 : 200),
      get memoriesGate() {
        return gateArmed ? retryGate : undefined;
      },
    });
    const first = mountPage();
    await flushPromises();
    expect(memoryRows(first)).toHaveLength(2);

    // 同一会话内重新进入页面（store 共享已有两条），这次列表 503：旧两行
    // 保留并出现"重新加载"（实机路径：编辑后刷新核对 GET 503 落到同一状态）。
    first.unmount();
    failing = true;
    const wrapper = mountPage();
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(listGetCount(calls)).toBe(2);

    // 键盘用户聚焦"重新加载"后按 Enter（走 click）；这次 GET 挂起。
    const retry = wrapper.get('[data-testid="memory-list-retry"]');
    const retryElement = retry.element as HTMLButtonElement;
    retryElement.focus();
    expect(document.activeElement).toBe(retryElement);
    gateArmed = true;
    await retry.trigger("click");
    await flushPromises();

    // 修复前：listStatus 同步变 loading 使整块错误提示连按钮一起卸载，
    // activeElement=BODY、role=status 为空、挂起期间没有等待反馈。修复后
    // 同一节点承载"正在重新加载"，按钮 aria-disabled/aria-busy，焦点仍在
    // 同一按钮，旧行不动，也不落回首载骨架。
    expect(listGetCount(calls)).toBe(3);
    expect(listNoticeState(wrapper)).toBe("pending");
    const notice = wrapper.get('[data-testid="memory-list-notice"]');
    expect(notice.attributes("role")).toBe("status");
    expect(notice.text()).toContain("正在重新加载");
    expect(wrapper.get('[data-testid="memory-list-retry"]').element).toBe(retryElement);
    expect(retry.attributes("aria-disabled")).toBe("true");
    expect(retry.attributes("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retryElement);
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-loading"]').exists()).toBe(false);

    // 等待期间再次 Enter：aria-disabled 不拦键盘事件，由 listStatus loading
    // 门挡住，不发第二个 GET。
    await retry.trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(3);

    // 放行 503：回到失败态，仍是同一按钮且焦点没有掉回 body。
    gateArmed = false;
    retryGate.resolve(response(503, null));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    expect(wrapper.get('[data-testid="memory-list-retry"]').element).toBe(retryElement);
    expect(retry.attributes("aria-disabled")).toBe("false");
    expect(retry.attributes("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(retryElement);
    expect(memoryRows(wrapper)).toHaveLength(2);

    // 服务恢复后再次 Enter：同一反馈区显示"已更新"，同一按钮变"再次刷新"，
    // 焦点仍留在该按钮；"再次刷新"复用同一读取。
    failing = false;
    await retry.trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(4);
    expect(listNoticeState(wrapper)).toBe("success");
    expect(wrapper.get('[data-testid="memory-list-notice"]').text()).toContain("已更新");
    expect(wrapper.get('[data-testid="memory-list-retry"]').element).toBe(retryElement);
    expect(retry.text()).toBe("再次刷新");
    expect(document.activeElement).toBe(retryElement);
    expect(memoryRows(wrapper)).toHaveLength(2);

    await retry.trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(5);
    expect(listNoticeState(wrapper)).toBe("success");
    wrapper.unmount();
  });

  it("R208 等待期间用户移走焦点：重载成功后不抢回，旧行、编辑框与草稿保留", async () => {
    const retryGate = gate();
    let gateArmed = false;
    let failing = false;
    stubFetch({
      memoriesStatus: () => (failing ? 503 : 200),
      get memoriesGate() {
        return gateArmed ? retryGate : undefined;
      },
    });
    const first = mountPage();
    await flushPromises();
    first.unmount();
    failing = true;
    const wrapper = mountPage();
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");

    // 失败态下打开编辑并留下草稿（R204 把焦点送进输入框）。
    await openEdit(wrapper, "memory-edit");
    await flushPromises();
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("R208 重载期间的草稿。");

    // 回到"重新加载"按 Enter；等待中用户把焦点移到自动记忆开关。
    const retry = wrapper.get('[data-testid="memory-list-retry"]');
    (retry.element as HTMLButtonElement).focus();
    gateArmed = true;
    await retry.trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("pending");
    const toggle = wrapper.get('[data-testid="autosave-toggle"]').element as HTMLButtonElement;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // 成功回包：反馈区变"已更新"，焦点留在用户移到的开关上不被抢回；
    // 旧行、编辑框与草稿都保留。
    gateArmed = false;
    retryGate.resolve(response(200, DEFAULT_MEMORIES));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("success");
    expect(document.activeElement).toBe(toggle);
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("R208 重载期间的草稿。");
    wrapper.unmount();
  });

  it("R208 刷新核对在途时重复点击不发第二个 GET；手动重载的\"已更新\"不延续到之后的存在性隐藏读取", async () => {
    const verifyGate = gate();
    let gateArmed = false;
    let phase: "ok" | "fail" | "hidden" = "ok";
    const { calls } = stubFetch({
      patchParseFailed: true,
      memoriesStatus: () => (phase === "fail" ? 503 : phase === "hidden" ? 404 : 200),
      get memoriesGate() {
        return gateArmed ? verifyGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // 编辑结果未知 → 刷新核对 503 → 列表失败态 → 手动"重新加载"成功：
    // "已更新"与写入核对入口并存（列表级成功不替代按预期值的核对）。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("结果未知的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    phase = "fail";
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    phase = "ok";
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("success");
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(listGetCount(calls)).toBe(3);

    // 刷新核对的 GET 挂起期间再点一次：被同一 listStatus loading 门挡住。
    gateArmed = true;
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(4);
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(listGetCount(calls)).toBe(4);

    // 这次核对读到存在性隐藏（404 适配为空列表）：不得仍显示"已更新"；
    // 未知提示、旧行与编辑草稿保留，核对算法不变（不误判生效/未生效）。
    gateArmed = false;
    verifyGate.resolve(response(404, null));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBeUndefined();
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="memory-rejected"]').exists()).toBe(false);
    expect(memoryRows(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    expect(listGetCount(calls)).toBe(4);
    wrapper.unmount();
  });

  it("R208 手动重载等待中发生真实 owner 清理：旧 pending 清掉，旧响应不回填也不清新 owner 的 pending", async () => {
    const gateA = gate();
    const gateB = gate();
    let armed: "A" | "B" | null = null;
    let phase: "a" | "fail" | "b" = "a";
    const B_MEMORIES = [memoryRow({ memoryId: "b1", summary: "B 的记忆。", autoSaved: false })];
    const { calls } = stubFetch({
      patchParseFailed: true,
      memoriesStatus: () => (phase === "fail" ? 503 : 200),
      memories: () => (phase === "b" ? B_MEMORIES : DEFAULT_MEMORIES),
      get memoriesGate() {
        if (armed === "A") return gateA;
        if (armed === "B") return gateB;
        return undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    // A：编辑结果未知 → 刷新核对 503 → 列表失败态 → "重新加载"等待中（GET 挂起）。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("结果未知的内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    phase = "fail";
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    armed = "A";
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("pending");
    expect(listGetCount(calls)).toBe(3);

    // 真实 owner 清理（退出：auth.clear 经 session-cleanup 重置 memory store、
    // ownerEpoch 递增）：旧 pending 随即清掉，不得停成永久"正在重新加载"——
    // A 的响应会按 epoch 丢弃，不会再回来收尾。
    useAuthStore().clear();
    await flushPromises();
    expect(listNoticeState(wrapper)).toBeUndefined();
    expect(memoryRows(wrapper)).toHaveLength(0);

    // R214：换号清理同时收走旧 unknownAction（"刷新核对"入口不恢复旧保存
    // 意图）；新 owner 在同一缓存实例上由身份 watch 自动重读到 B 的列表
    //（自动读不再挂 gate：armed 复位，gateA 仍持有 A 的旧手动响应）。
    armed = null;
    login();
    phase = "b";
    await flushPromises();
    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");
    expect(listGetCount(calls)).toBe(4);

    // 新 owner 建立自己的未知操作与失败读取，再发起自己的"重新加载"等待
    //（GET 挂起）——与 A 阶段同一 manualListRefresh 对象语义。
    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("B 的未知内容。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    phase = "fail";
    await wrapper.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("failed");
    armed = "B";
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("pending");
    expect(listGetCount(calls)).toBe(6);

    // A 的旧手动响应此时晚到：按已有 epoch 比较丢弃——不回填 A 的列表，
    // 也不清新 owner 刚发起的 pending。
    gateA.resolve(response(200, DEFAULT_MEMORIES));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("pending");
    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).not.toContain("晚上散步");

    // 新 owner 自己的读取回来：正常收尾为"已更新"。
    gateB.resolve(response(200, B_MEMORIES));
    await flushPromises();
    expect(listNoticeState(wrapper)).toBe("success");
    expect(memoryRows(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain("B 的记忆。");
    expect(listGetCount(calls)).toBe(6);
    wrapper.unmount();
  });

  // ---- R214：记忆页前台身份交接恢复 ----

  it("R214 可见页 409 换号：读回 B 后按新关系自动重读一次，不落真空态", async () => {
    const sessionGate = gate();
    let phase: "a" | "b" = "a";
    const { calls } = stubFetch({
      relationships: () => (phase === "a" ? RELATIONSHIPS : RELATIONSHIP_B),
      memoriesByRel: { 84: B_MEMORIES_R214 },
      prefEnabled: () => phase !== "b",
      prefPutConflict: true,
      sessionIdentity: () => sessionIdentityFor("8", "9002"),
      sessionGate,
    });
    const { host } = mountPageInKeepAlive();
    await flushPromises();
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    expect(host.get('[data-testid="autosave-toggle"]').text()).toBe("已开启");

    // 真实 transport 链：PUT 开关 → 精确 409 ACCOUNT_CONTEXT_CHANGED → 页面
    // 回调 reconcile 同步 clear（作废本地身份、重置共享 store）→ GET
    // /auth/session 读回挂起。
    await host.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();

    // 身份未定窗口：停在加载骨架，不落"空列表 + 开关待确认且无恢复入口"的
    // 真空终态；期间不读新账号数据，也不自动重放任何写。
    expect(host.find('[data-testid="memory-loading"]').exists()).toBe(true);
    expect(host.find('[data-testid="memory-empty"]').exists()).toBe(false);
    expect(host.find('[data-testid="autosave-toggle"]').exists()).toBe(false);
    expect(calls.filter((call) => call.url.includes("/relationships/84"))).toHaveLength(0);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);

    // 读回 B：可见页自动按新身份读关系（active 84）→ B 的记忆 → 开关，全部
    // 按 B 数据渲染，且每个读取只发生一次。
    phase = "b";
    sessionGate.resolve(response(200, sessionIdentityFor("8", "9002")));
    await flushPromises();

    expect(host.find('[data-testid="memory-loading"]').exists()).toBe(false);
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    expect(host.text()).toContain("忌口香菜");
    expect(host.text()).not.toContain("晚上散步");
    const toggle = host.get('[data-testid="autosave-toggle"]');
    expect(toggle.text()).toBe("已关闭");
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(calls.filter((call) => call.method === "GET" && call.url === "/api/v1/relationships/84/memories")).toHaveLength(1);
    host.unmount();
  });

  it("R214 隐藏缓存页换号不抢跑：激活后才按新身份读取", async () => {
    let phase: "a" | "b" = "a";
    const { calls } = stubFetch({
      relationships: () => (phase === "a" ? RELATIONSHIPS : RELATIONSHIP_B),
      memoriesByRel: { 84: B_MEMORIES_R214 },
      prefEnabled: () => phase !== "b",
      sessionIdentity: () => sessionIdentityFor("8", "9002"),
    });
    const { host, active } = mountPageInKeepAlive();
    await flushPromises();
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    const callsWhenHidden = calls.length;

    // 页面被压栈隐藏后，共享 Cookie 在别处换到 B（真实清理链 + 新身份确立）：
    // 隐藏页只清本地状态，不发起任何 B 的读取。
    active.value = false;
    await nextTick();
    useAuthStore().clear();
    loginAs("8");
    phase = "b";
    await flushPromises();
    expect(calls.length).toBe(callsWhenHidden);
    expect(useMemoryStore().items).toEqual([]);

    // 再激活：按当前确立身份读取 B 的关系与记忆（仅一次），A 内容不再回显。
    active.value = true;
    await flushPromises();
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    expect(host.text()).toContain("忌口香菜");
    expect(host.text()).not.toContain("晚上散步");
    expect(calls.filter((call) => call.method === "GET" && call.url === "/api/v1/relationships/84/memories")).toHaveLength(1);
    host.unmount();
  });

  it("R214 换号读回同一账号：旧草稿与未知意图全清理，晚到读取不覆盖恢复数据", async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    const { attemptNavigate } = stubLeaveRouter();
    const sessionGate = gate();
    const staleGate = gate();
    let staleArmed = false;
    const { calls } = stubFetch({
      patchParseFailed: true,
      get memoriesGate() {
        return staleArmed ? staleGate : undefined;
      },
      prefPutConflict: true,
      sessionIdentity: () => sessionIdentityFor("7", "9002"),
      sessionGate,
    });
    const { host } = mountPageInKeepAlive();
    await flushPromises();
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);

    // A：未保存草稿 + 一次未知保存（memory-refresh 核对入口）+ 挂起的核对
    // 读取，随后 PUT 开关触发 409 换号（读回仍是账号 7 的新会话）。
    await host.get('[data-testid="memory-edit"]').trigger("click");
    await host.get('[data-testid="memory-edit-input"]').setValue("A 的未保存草稿。");
    await host.get('[data-testid="memory-edit-save"]').trigger("click");
    await flushPromises();
    expect(host.find('[data-testid="memory-refresh"]').exists()).toBe(true);
    staleArmed = true;
    await host.get('[data-testid="memory-refresh"]').trigger("click");
    await flushPromises();
    await host.get('[data-testid="autosave-toggle"]').trigger("click");
    await flushPromises();

    // 身份未定窗口：草稿、未知入口与编辑框全部清掉，停在骨架而非真空态。
    expect(host.find('[data-testid="memory-loading"]').exists()).toBe(true);
    expect(host.find('[data-testid="memory-refresh"]').exists()).toBe(false);
    expect(host.find('[data-testid="memory-edit-box"]').exists()).toBe(false);

    // 读回同一账号：自动重读恢复权威数据；挂起的旧核对随后晚到，不得覆盖。
    staleArmed = false;
    sessionGate.resolve(response(200, sessionIdentityFor("7", "9002")));
    await flushPromises();
    expect(host.find('[data-testid="memory-loading"]').exists()).toBe(false);
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    const listGetsAfterRecovery = listGetCount(calls);

    staleGate.resolve(response(200, [memoryRow({ memoryId: "m1", summary: "晚到的旧快照。", autoSaved: false })]));
    await flushPromises();
    expect(host.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    expect(host.text()).not.toContain("晚到的旧快照。");
    expect(listGetCount(calls)).toBe(listGetsAfterRecovery);

    // 恢复后的账号可继续编辑，离开守卫对新的脏稿仍然生效。
    await host.get('[data-testid="memory-edit"]').trigger("click");
    await host.get('[data-testid="memory-edit-input"]').setValue("恢复后要保护的新草稿。");
    await expect(attemptNavigate("/pages/account/account")).resolves.toBe(false);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    host.unmount();
  });

  it("R214 同账号重认证不构成换号：未保存草稿保留且不重复加载", async () => {
    const { calls } = stubFetch({
      sessionIdentity: () => sessionIdentityFor("7", "9003"),
    });
    const wrapper = mountPage();
    await flushPromises();
    const listGetsBefore = listGetCount(calls);

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("同账号要保留的草稿。");

    // 会话续期/同账号读回：accountId 不变，不触发换号清理——草稿保留，
    // 也不发起重复读取。
    const auth = useAuthStore();
    const sessionTransport = createAuthenticatedTransport({
      getAccessToken: () => auth.accessToken,
      getAccountId: () => auth.accountId,
      getSessionId: () => auth.getSessionId(),
      getSessionRevision: () => auth.getSessionRevision(),
      onUnauthorized: () => auth.onUnauthorized(),
    });
    await auth.tryRefresh(sessionTransport);
    await flushPromises();

    expect(wrapper.find('[data-testid="memory-edit-box"]').exists()).toBe(true);
    const input = wrapper.get('[data-testid="memory-edit-input"]').element as HTMLTextAreaElement;
    expect(input.value).toBe("同账号要保留的草稿。");
    expect(listGetCount(calls)).toBe(listGetsBefore);
    wrapper.unmount();
  });

  it("R214 匿名进入经会话发现身份：首次发现不重复加载", async () => {
    useAuthStore().clear();
    const { calls } = stubFetch({
      sessionIdentity: () => sessionIdentityFor("7", "9001"),
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="memory-row"]')).toHaveLength(2);
    expect(listGetCount(calls)).toBe(1);
    wrapper.unmount();
  });
});
