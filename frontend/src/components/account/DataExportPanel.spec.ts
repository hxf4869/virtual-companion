// @vitest-environment happy-dom
// VC-R07 聊天与记忆副本面板：完整成功流（服务器原始字节不经解析落盘）、
// 各失败态诚实文案、忙碌防重复、密码即用即清、折叠保态、卸载守卫与
// 界面不泄露 exportId/token/URL。vi.mock 冻结契约 @/api/data-export。
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataExportHttpError,
  DataExportProtocolError,
  createDataExport,
  downloadDataExport,
  getDataExportStatus,
  type DataExportCreatedView,
  type DataExportRequestView,
  type DataExportTransport,
} from "@/api/data-export";

import DataExportPanel from "./DataExportPanel.vue";

vi.mock("@/api/data-export", () => {
  class DataExportHttpError extends Error {
    readonly status: number;
    readonly kind: "unauthorized" | "server" | "client";
    constructor(status: number, kind: "unauthorized" | "server" | "client") {
      super(`HTTP ${status}`);
      this.name = "DataExportHttpError";
      this.status = status;
      this.kind = kind;
    }
  }
  class DataExportProtocolError extends Error {
    readonly status: number;
    constructor(status: number) {
      super(`protocol ${status}`);
      this.name = "DataExportProtocolError";
      this.status = status;
    }
  }
  return {
    DataExportHttpError,
    DataExportProtocolError,
    classifyDataExportCreateError: (caught: unknown): "rejected" | "unknown" => (
      caught instanceof DataExportHttpError && caught.kind === "client" ? "rejected" : "unknown"
    ),
    createDataExport: vi.fn(),
    getDataExportStatus: vi.fn(),
    downloadDataExport: vi.fn(),
  };
});

const createDataExportMock = vi.mocked(createDataExport);
const getDataExportStatusMock = vi.mocked(getDataExportStatus);
const downloadDataExportMock = vi.mocked(downloadDataExport);

// 原始 JSON 文本常量：含超过 Number.MAX_SAFE_INTEGER 的 int64 ID，先以字符串
// 字面量持有，逐字节比对 Blob，绝不 JSON.parse/stringify 重构。
const EXPORT_JSON_TEXT = '{"format":"vc-export-v1","requestedAt":"2026-10-20T09:05:00Z",'
  + '"messages":[{"messageId":9007199254740993,"role":"user","content":"晚上好"}],'
  + '"memories":[{"memoryId":9007199254740995,"summary":"用户喜欢在晚上散步。"}]}';
const REQUESTED_AT = "2026-10-20T09:05:00Z";
const DOWNLOAD_URL = "/api/v1/exports/exp-1/download?token=one-time";

function createdView(overrides: Partial<DataExportCreatedView> = {}): DataExportCreatedView {
  return {
    exportId: "exp-1",
    status: "PENDING",
    requestedAt: REQUESTED_AT,
    downloadUrl: DOWNLOAD_URL,
    ...overrides,
  };
}

function readyView(overrides: Partial<DataExportRequestView> = {}): DataExportRequestView {
  return {
    exportId: "exp-1",
    status: "READY",
    requestedAt: REQUESTED_AT,
    completedAt: "2026-10-20T09:06:00Z",
    expiresAt: "2026-10-27T09:05:00Z",
    ...overrides,
  };
}

function exportBlob(): Blob {
  return new Blob([EXPORT_JSON_TEXT], { type: "application/json" });
}

function expectedFileName(requestedAt: string): string {
  const date = new Date(Date.parse(requestedAt));
  const pad = (part: number) => String(part).padStart(2, "0");
  return `聊天与记忆副本-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

const transport = { request: vi.fn() };
const downloadFetch = vi.fn();

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchors: HTMLAnchorElement[];
let storageWrites: string[];

function mountPanel() {
  return mount(DataExportPanel, {
    props: { transport: transport as DataExportTransport, downloadFetch },
    attachTo: document.body,
  });
}

type PanelWrapper = ReturnType<typeof mountPanel>;

async function openPanel(wrapper: PanelWrapper) {
  await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
}

async function submitCreate(wrapper: PanelWrapper, passwordValue = "Current-Pass-1!") {
  await wrapper.get('[data-testid="data-copy-password"]').setValue(passwordValue);
  await wrapper.get('[data-testid="data-copy-create"]').trigger("click");
  await flushPromises();
}

async function driveToReady(wrapper: PanelWrapper) {
  createDataExportMock.mockResolvedValue(createdView());
  getDataExportStatusMock.mockResolvedValue(readyView());
  downloadDataExportMock.mockResolvedValue(exportBlob());
  await openPanel(wrapper);
  await submitCreate(wrapper);
  await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
  await flushPromises();
}

describe("DataExportPanel", () => {
  beforeEach(() => {
    createObjectURL = vi.fn((_blob: Blob) => "blob:copy-1");
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    clickedAnchors = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function handleClick(this: HTMLAnchorElement) {
        clickedAnchors.push(this);
      },
    );
    storageWrites = [];
    vi.stubGlobal("localStorage", {
      setItem: (k: string, v: string) => storageWrites.push(`local:${k}=${v}`),
      getItem: () => null,
    });
    vi.stubGlobal("sessionStorage", {
      setItem: (k: string, v: string) => storageWrites.push(`session:${k}=${v}`),
      getItem: () => null,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders the collapsed copy row by default and expands on toggle", async () => {
    const wrapper = mountPanel();
    const toggle = wrapper.get('[data-testid="data-copy-toggle"]');
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.text()).toContain("聊天与记忆副本");
    expect(wrapper.find('[data-testid="data-copy-panel"]').isVisible()).toBe(false);

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[data-testid="data-copy-panel"]').isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("walks the full create→progress→download flow with byte-exact blob handoff", async () => {
    createDataExportMock.mockResolvedValue(createdView());
    getDataExportStatusMock.mockResolvedValue(readyView());
    downloadDataExportMock.mockResolvedValue(exportBlob());
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    expect(createDataExportMock).toHaveBeenCalledTimes(1);
    expect(createDataExportMock).toHaveBeenCalledWith(transport, "Current-Pass-1!");
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("正在整理你的副本。");
    expect(wrapper.find('[data-testid="data-copy-progress"]').exists()).toBe(true);

    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();
    expect(getDataExportStatusMock).toHaveBeenCalledWith(transport, "exp-1");
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(true);
    // 未下载的 READY 提示仍是“可以下载”；交接后由下方断言切换为“已发起”。
    expect(wrapper.get('[data-testid="data-copy-panel"]').text())
      .toContain("副本已整理好，可以下载保存到此设备。");

    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();
    expect(downloadDataExportMock).toHaveBeenCalledWith(downloadFetch, DOWNLOAD_URL);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(EXPORT_JSON_TEXT);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].getAttribute("href")).toBe("blob:copy-1");
    expect(clickedAnchors[0].getAttribute("download")).toBe(expectedFileName(REQUESTED_AT));
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:copy-1");
    expect(wrapper.get('[data-testid="data-copy-panel"]').text())
      .toContain("已交给浏览器下载，请在本设备的下载内容中查看。");
    // 交接后状态标题不再声称“可以下载”，如实反映已发起。
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("本次下载已发起。");
    expect(wrapper.get('[data-testid="data-copy-panel"]').text())
      .not.toContain("副本已整理好，可以下载保存到此设备。");
    // 一次性链接已交接：主动作收敛为“重新申请”，不再保留可复点的一次性下载。
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-copy-reapply"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="data-copy-note"]').attributes("role")).toBe("status");
    expect(downloadDataExportMock).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="data-copy-reapply"]').trigger("click");
    expect(wrapper.find('[data-testid="data-copy-password"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("clears the password input after a failed attempt and keeps the form", async () => {
    createDataExportMock.mockRejectedValue(new DataExportHttpError(404, "client"));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    const input = wrapper.get('[data-testid="data-copy-password"]').element as HTMLInputElement;
    expect(input.value).toBe("");
    expect(wrapper.find('[data-testid="data-copy-create"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("states the wrong password without leaking status codes on create 404", async () => {
    createDataExportMock.mockRejectedValue(new DataExportHttpError(404, "client"));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    const text = wrapper.get('[data-testid="data-copy-panel"]').text();
    expect(text).toContain("当前密码不正确，没有创建副本。");
    expect(text).not.toContain("404");
    wrapper.unmount();
  });

  it("keeps the create 400 copy honest instead of asserting a precise reason", async () => {
    createDataExportMock.mockRejectedValue(new DataExportHttpError(400, "client"));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    const text = wrapper.get('[data-testid="data-copy-panel"]').text();
    expect(text).toContain("可能已有一份副本在整理中");
    expect(text).not.toContain("当前密码不正确");
    wrapper.unmount();
  });

  it("reports an unknown create outcome honestly and never auto-resends", async () => {
    createDataExportMock.mockRejectedValue(new DataExportHttpError(503, "server"));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);
    await flushPromises();

    expect(wrapper.get('[data-testid="data-copy-error"]').text())
      .toContain("申请没有完成，结果不确定；请稍后再查看或重新申请。");
    expect(createDataExportMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("treats a protocol error on create as an unknown outcome", async () => {
    createDataExportMock.mockRejectedValue(new DataExportProtocolError(200));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    expect(wrapper.get('[data-testid="data-copy-error"]').text())
      .toContain("申请没有完成，结果不确定");
    wrapper.unmount();
  });

  it("adds no panel copy on create 401 (auth transport already took over)", async () => {
    createDataExportMock.mockRejectedValue(new DataExportHttpError(401, "unauthorized"));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    expect(wrapper.find('[data-testid="data-copy-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-copy-create"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers a retryable plain-language notice when the progress check fails", async () => {
    createDataExportMock.mockResolvedValue(createdView());
    getDataExportStatusMock
      .mockRejectedValueOnce(new DataExportHttpError(503, "server"))
      .mockResolvedValue(readyView());
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);

    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="data-copy-error"]').text()).toContain("进度暂时没有查到，请再试一次。");
    expect(wrapper.find('[data-testid="data-copy-progress"]').exists()).toBe(true);

    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers re-application when the finished copy turns out FAILED", async () => {
    createDataExportMock.mockResolvedValue(createdView());
    getDataExportStatusMock.mockResolvedValue(readyView({ status: "FAILED" }));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);
    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("这次没有整理成功，可以重新申请。");
    await wrapper.get('[data-testid="data-copy-reapply"]').trigger("click");
    expect(wrapper.find('[data-testid="data-copy-password"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers re-application when the copy status turns out EXPIRED", async () => {
    createDataExportMock.mockResolvedValue(createdView());
    getDataExportStatusMock.mockResolvedValue(readyView({ status: "EXPIRED" }));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await submitCreate(wrapper);
    await wrapper.get('[data-testid="data-copy-progress"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("下载链接已过期，可以重新申请。");
    await wrapper.get('[data-testid="data-copy-reapply"]').trigger("click");
    expect(wrapper.find('[data-testid="data-copy-password"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("replaces the download action with re-application after a one-shot 404", async () => {
    const wrapper = mountPanel();
    await driveToReady(wrapper);
    downloadDataExportMock.mockRejectedValue(new DataExportHttpError(404, "client"));

    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="data-copy-error"]').text()).toContain("下载链接已失效，可以重新申请。");
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-copy-reapply"]').exists()).toBe(true);

    await wrapper.get('[data-testid="data-copy-reapply"]').trigger("click");
    expect(wrapper.find('[data-testid="data-copy-password"]').exists()).toBe(true);
    expect(downloadDataExportMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("reports an uncertain download outcome honestly and never auto-repeats", async () => {
    const wrapper = mountPanel();
    await driveToReady(wrapper);
    downloadDataExportMock.mockRejectedValue(new DataExportHttpError(504, "server"));

    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="data-copy-error"]').text())
      .toContain("下载没有完成，结果不确定；链接可能已失效。");
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    await flushPromises();
    expect(downloadDataExportMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("submits only once while busy even under repeated clicks", async () => {
    let resolveCreate!: (value: DataExportCreatedView) => void;
    createDataExportMock.mockReturnValue(new Promise<DataExportCreatedView>((resolve) => {
      resolveCreate = resolve;
    }));
    const wrapper = mountPanel();
    await openPanel(wrapper);
    await wrapper.get('[data-testid="data-copy-password"]').setValue("Current-Pass-1!");

    await wrapper.get('[data-testid="data-copy-create"]').trigger("click");
    const createButton = wrapper.get('[data-testid="data-copy-create"]');
    expect(createButton.text()).toContain("申请中…");
    expect(createButton.attributes("disabled")).toBeDefined();
    await createButton.trigger("click");
    await createButton.trigger("click");
    expect(createDataExportMock).toHaveBeenCalledTimes(1);

    resolveCreate(createdView());
    await flushPromises();
    expect(wrapper.get('[data-testid="data-copy-panel"]').text()).toContain("正在整理你的副本。");
    wrapper.unmount();
  });

  it("keeps the downloadable state across collapse and re-expand", async () => {
    const wrapper = mountPanel();
    await driveToReady(wrapper);

    await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
    expect(wrapper.get('[data-testid="data-copy-toggle"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-testid="data-copy-panel"]').isVisible()).toBe(false);
    expect(wrapper.find('[data-testid="data-copy-download"]').exists()).toBe(true);

    await wrapper.get('[data-testid="data-copy-toggle"]').trigger("click");
    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickedAnchors).toHaveLength(1);
    wrapper.unmount();
  });

  it("discards a late create response after unmount and starts the next mount clean", async () => {
    let resolveCreate!: (value: DataExportCreatedView) => void;
    createDataExportMock.mockReturnValue(new Promise<DataExportCreatedView>((resolve) => {
      resolveCreate = resolve;
    }));
    const first = mountPanel();
    await openPanel(first);
    await first.get('[data-testid="data-copy-password"]').setValue("Current-Pass-1!");
    await first.get('[data-testid="data-copy-create"]').trigger("click");
    first.unmount();

    resolveCreate(createdView());
    await flushPromises();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    const second = mountPanel();
    await openPanel(second);
    expect(second.get('[data-testid="data-copy-panel"]').text()).toContain("申请副本");
    expect(second.find('[data-testid="data-copy-progress"]').exists()).toBe(false);
    second.unmount();
  });

  it("never renders exportId, tokens, URLs or raw payloads, and never writes storage", async () => {
    const wrapper = mountPanel();
    await driveToReady(wrapper);
    await wrapper.get('[data-testid="data-copy-download"]').trigger("click");
    await flushPromises();

    const text = wrapper.text();
    expect(text).not.toContain("exp-1");
    expect(text).not.toContain("one-time");
    expect(text).not.toContain("blob:copy-1");
    expect(text).not.toContain("/api/v1/exports");
    expect(text).not.toContain("9007199254740993");
    expect(storageWrites).toEqual([]);
    wrapper.unmount();
  });
});
