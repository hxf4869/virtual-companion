// @vitest-environment happy-dom
// 记忆管理页：自动记忆开关读写、已保存列表渲染与编辑/删除、待确认候选
// 的逐条确认；失败路径一律保留原内容。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  relationships?: unknown[];
  memories?: unknown[] | (() => unknown[]);
  memoriesStatus?: number | (() => number);
  prefEnabled?: boolean | (() => boolean);
  prefStatus?: number | (() => number);
  putParseFailed?: boolean;
  /** PUT 时模拟网络中断（fetch 抛 TypeError）：结果未知。 */
  putNetworkError?: boolean;
  patchStatus?: number | ((memoryId: string) => number);
  patchParseFailed?: boolean;
  patchEcho?: Record<string, unknown>;
  deleteStatus?: number;
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

    if (url === "/api/v1/relationships" && method === "GET") {
      return response(200, options.relationships ?? RELATIONSHIPS);
    }
    if (url === "/api/v1/relationships/42/memories" && method === "GET") {
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
        const status = typeof options.prefStatus === "function"
          ? options.prefStatus()
          : options.prefStatus ?? 200;
        const enabled = typeof options.prefEnabled === "function"
          ? options.prefEnabled()
          : options.prefEnabled ?? true;
        return response(status, status === 200 ? { enabled } : null);
      }
      if (method === "PUT") {
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
        return response(200, { ...echoed, status: "ACCEPTED", autoSaved: true });
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

function mountPage() {
  return mount(MemoryPage, { attachTo: document.body });
}

function memoryRows(wrapper: ReturnType<typeof mountPage>) {
  return wrapper.findAll('[data-testid="memory-row"]');
}

async function openEdit(wrapper: ReturnType<typeof mountPage>, testid: string) {
  await wrapper.get(`[data-testid="${testid}"]`).trigger("click");
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

    expect(wrapper.get('[data-testid="memory-list-error"]').text()).toContain("没有加载出来");
    // 核对刷新失败：未知提示与旧数据保留。
    expect(wrapper.find('[data-testid="memory-unknown"]').exists()).toBe(true);
    expect(memoryRows(wrapper)).toHaveLength(2);

    failing = false;
    await wrapper.get('[data-testid="memory-list-retry"]').trigger("click");
    await flushPromises();
    // 初始加载 + 失败的刷新 + 成功的重试。
    expect(calls.filter((call) => call.url.includes("/memories") && call.method === "GET"))
      .toHaveLength(3);
    expect(wrapper.find('[data-testid="memory-list-error"]').exists()).toBe(false);
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
    expect(wrapperB.get('[data-testid="memory-list-error"]').text()).toContain("没有加载出来");
    expect(wrapperB.findAll('[data-testid="memory-row"]')).toHaveLength(0);
    expect(wrapperB.text()).not.toContain("晚上散步");
    expect(useMemoryStore().items).toEqual([]);
    wrapperB.unmount();
  });

  it("A 的编辑响应在退出换号后晚到：不写入 B 的状态", async () => {
    const patchGate = gate();
    let gateArmed = false;
    stubFetch({
      get patchGate() {
        return gateArmed ? patchGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    await openEdit(wrapper, "memory-edit");
    await wrapper.get('[data-testid="memory-edit-input"]').setValue("A 的晚到编辑。");
    await wrapper.get('[data-testid="memory-edit-save"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-edit-save"]').attributes("disabled")).toBeDefined();

    // 保存请求在途时退出并切换到 B。
    useAuthStore().clear();
    login();

    patchGate.resolve(response(200, memoryRow({ memoryId: "m1", summary: "A 的晚到编辑。", autoSaved: false })));
    await flushPromises();

    expect(useMemoryStore().items).toEqual([]);
    expect(memoryRows(wrapper)).toHaveLength(0);
    expect(wrapper.text()).not.toContain("A 的晚到编辑。");
    wrapper.unmount();
  });

  it("A 的删除响应在退出换号后晚到：不写入 B 的状态", async () => {
    const deleteGate = gate();
    let gateArmed = false;
    stubFetch({
      get deleteGate() {
        return gateArmed ? deleteGate : undefined;
      },
    });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-testid="memory-delete"]').trigger("click");
    await wrapper.get('[data-testid="memory-delete-confirm"]').trigger("click");
    expect(wrapper.get('[data-testid="memory-delete-confirm"]').attributes("disabled")).toBeDefined();

    // 删除请求在途时退出并切换到 B。
    useAuthStore().clear();
    login();

    deleteGate.resolve(response(200, memoryRow({ memoryId: "m1", deletedAt: "2026-09-04T00:00:00Z" })));
    await flushPromises();

    expect(useMemoryStore().items).toEqual([]);
    expect(memoryRows(wrapper)).toHaveLength(0);
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
    expect(toggle.attributes("aria-checked")).toBe("mixed");
    expect(toggle.attributes("disabled")).toBeDefined();

    // 不按 false 默认值误开启：点击不产生写入。
    await toggle.trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);

    failing = false;
    await wrapper.get('[data-testid="autosave-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="autosave-toggle"]').text()).toBe("已开启");
    expect(wrapper.get('[data-testid="autosave-toggle"]').attributes("aria-checked")).toBe("true");
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
    expect(remounted.get('[data-testid="memory-list-inconclusive-notice"]').text())
      .toContain("可能不是当前列表");
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
});
