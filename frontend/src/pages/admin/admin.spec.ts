// @vitest-environment happy-dom
// ADMIN-UI: admin account provisioning page glue test. The form POSTs the
// account body through the authenticated transport and shows the created
// account; a non-OK response maps to one generic failure message (existence
// never disclosed); non-ADMIN sessions see the notice instead of the form.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminPage from "./admin.vue";
import { useAuthStore } from "@/stores/auth";

function stubCreateAccount(ok: boolean, json: unknown = null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      json: async () => json,
    })),
  );
}

function mountPage() {
  return mount(AdminPage, { attachTo: document.body });
}

async function fillForm(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  await wrapper.find('[data-testid="account-username"]').setValue("alice");
  await wrapper.find('[data-testid="account-password"]').setValue("pw-1");
  await wrapper.find('[data-testid="account-display-name"]').setValue("Alice");
}

describe("admin account page (ADMIN-UI)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    const auth = useAuthStore();
    auth.role = "ADMIN";
    auth.accessToken = "token";
    auth.accountId = "1";
  });

  it("loads the account registry on mount and renders rows (ADMIN-ACCTS)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/admin/accounts" && (init?.method ?? "GET") === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { accountId: "1", username: "root", role: "ADMIN", status: "ACTIVE", displayName: "Root" },
              { accountId: "7", username: "alice", role: "USER", status: "ACTIVE", displayName: "Alice" },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="account-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("root");
    expect(rows[1].text()).toContain("alice");
    // The admin's own row has no disable button (no self-disable).
    const disableButtons = wrapper.findAll('[data-testid="disable-account"]');
    expect(disableButtons).toHaveLength(1);
    wrapper.unmount();
  });

  it("renders the usage summary and audit trail on mount (ADMIN-OPS)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/admin/accounts" && (init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/auth/admin/usage")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { day: "2026-08-16", generations: 3, inputTokens: 1200, outputTokens: 800, cost: 0.012 },
            ],
          };
        }
        if (url.startsWith("/api/v1/auth/admin/safety-events")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9",
                ownerId: "7",
                generationId: "55",
                stage: "INPUT",
                riskLevel: "R4_IMMINENT",
                ruleId: "input-imminent-self-harm",
                createdAt: "2026-08-19T08:00:00Z",
                ageHours: 0.1,
                slaBreached: false,
              },
            ],
          };
        }
        if (url.startsWith("/api/v1/auth/admin/audit")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "500",
                eventType: "ACCOUNT_CREATE",
                accountId: "7",
                username: "alice",
                occurredAt: "2026-08-16T08:00:00Z",
              },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="usage-table"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="usage-row"]').text()).toContain("3 轮");
    expect(wrapper.find('[data-testid="audit-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="audit-row"]').text()).toContain("ACCOUNT_CREATE");
    expect(wrapper.find('[data-testid="audit-load-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("ENT-SNAP: renders the assignment registry and assigns a class", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/admin/accounts" && (init?.method ?? "GET") === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { accountId: "1", username: "root", role: "ADMIN", status: "ACTIVE", displayName: "Root" },
              { accountId: "7", username: "alice", role: "USER", status: "ACTIVE", displayName: "Alice" },
            ],
          };
        }
        if (url === "/api/v1/auth/admin/service-classes") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { accountId: "1", username: "root", serviceClass: "ECONOMY" },
              { accountId: "7", username: "alice", serviceClass: "PREMIUM", assignedAt: "2026-08-16T08:00:00Z" },
            ],
          };
        }
        if (url === "/api/v1/auth/admin/service-class" && init?.method === "POST") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ accountId: "7", serviceClass: "ECONOMY" }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="sc-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].text()).toContain("PREMIUM");

    // Assign ECONOMY to alice and confirm the result line.
    await wrapper.find('[data-testid="sc-account"]').setValue("7");
    await wrapper.find('[data-testid="sc-class"]').setValue("ECONOMY");
    await wrapper.find('[data-testid="sc-assign"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="sc-result"]').text()).toContain("alice");
    expect(wrapper.find('[data-testid="sc-result"]').text()).toContain("ECONOMY");
    wrapper.unmount();
  });

  it("creates an account and shows the created account", async () => {
    stubCreateAccount(true, {
      accountId: "9",
      username: "alice",
      role: "USER",
      status: "ACTIVE",
    });
    const wrapper = mountPage();
    await fillForm(wrapper);
    await wrapper.find('[data-testid="create-account"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="account-result"]').text()).toContain("alice");
    expect(wrapper.find('[data-testid="account-failed"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows one generic failure for a non-OK response (no existence disclosure)", async () => {
    stubCreateAccount(false);
    const wrapper = mountPage();
    await fillForm(wrapper);
    await wrapper.find('[data-testid="create-account"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="account-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("hides the form for non-admin sessions", async () => {
    const auth = useAuthStore();
    auth.role = "USER";
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="admin-not-allowed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="create-account"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("disables submit until the required fields are filled", async () => {
    stubCreateAccount(true, {
      accountId: "9",
      username: "alice",
      role: "USER",
      status: "ACTIVE",
    });
    const wrapper = mountPage();
    await flushPromises();

    const submit = wrapper.find('[data-testid="create-account"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await fillForm(wrapper);
    expect(submit.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
  it("SAFETY-QUEUE: renders the read-only safety queue on mount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/admin/accounts" && (init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/auth/admin/safety-events")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9",
                ownerId: "7",
                generationId: "55",
                stage: "INPUT",
                riskLevel: "R4_IMMINENT",
                ruleId: "input-imminent-self-harm",
                createdAt: "2026-08-19T08:00:00Z",
                ageHours: 0.1,
                slaBreached: false,
              },
              {
                id: "10",
                ownerId: "8",
                generationId: "56",
                stage: "FINAL",
                riskLevel: "R3_HIGH",
                ruleId: "output-ai-identity-human-claim",
                createdAt: "2026-08-18T08:00:00Z",
                ageHours: 48.2,
                slaBreached: true,
              },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="safety-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("R4_IMMINENT");
    expect(rows[0].text()).toContain("input-imminent-self-harm");
    expect(rows[0].text()).toContain("账号 7");
    // METRICS-ALERT: the fact age renders for every row; the deployment
    // threshold marks only the breached row.
    const slaCells = wrapper.findAll('[data-testid="safety-sla"]');
    expect(slaCells[0].text()).toContain("0.1h");
    expect(slaCells[0].text()).not.toContain("SLA 超时");
    expect(slaCells[1].text()).toContain("48.2h");
    expect(slaCells[1].text()).toContain("SLA 超时");
    // Read-only queue: no triage/dispose action is offered.
    expect(wrapper.text()).not.toMatch(/处置|标记已处理|关闭工单/);
    wrapper.unmount();
  });
  it("ADMIN-BETA: renders the four read-only console queues on mount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/admin/accounts" && (init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url.startsWith("/api/v1/auth/admin/reports")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9003",
                ownerId: "7",
                messageId: "10",
                reason: "UNSAFE_CONTENT",
                note: "内容让我不安",
                status: "SUBMITTED",
                createdAt: "2026-08-19T08:00:00Z",
              },
            ],
          };
        }
        if (url.startsWith("/api/v1/auth/admin/age-appeals")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9102",
                ownerId: "8",
                reason: "系统误判为未成年",
                status: "SUBMITTED",
                createdAt: "2026-08-19T07:00:00Z",
              },
            ],
          };
        }
        if (url.startsWith("/api/v1/auth/admin/export-tasks")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9202",
                ownerId: "8",
                status: "READY",
                createdAt: "2026-08-19T06:00:00Z",
                completedAt: "2026-08-19T06:05:00Z",
              },
            ],
          };
        }
        if (url.startsWith("/api/v1/auth/admin/memory-sampling")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9304",
                ownerId: "7",
                relationshipId: "1",
                scope: "RELATIONSHIP",
                summary: "待确认候选",
                status: "PENDING_CONFIRMATION",
                deletedAt: null,
                createdAt: "2026-08-19T05:00:00Z",
              },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    const reportRows = wrapper.findAll('[data-testid="beta-report-row"]');
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0].text()).toContain("UNSAFE_CONTENT");
    expect(reportRows[0].text()).toContain("SUBMITTED");

    const appealRows = wrapper.findAll('[data-testid="beta-appeal-row"]');
    expect(appealRows).toHaveLength(1);
    expect(appealRows[0].text()).toContain("系统误判为未成年");

    const exportRows = wrapper.findAll('[data-testid="beta-export-row"]');
    expect(exportRows).toHaveLength(1);
    expect(exportRows[0].text()).toContain("READY");
    expect(exportRows[0].text()).toContain("2026-08-19T06:05:00Z");

    const samplingRows = wrapper.findAll('[data-testid="beta-sampling-row"]');
    expect(samplingRows).toHaveLength(1);
    expect(samplingRows[0].text()).toContain("PENDING_CONFIRMATION");
    expect(samplingRows[0].text()).toContain("待确认候选");
    // Read-only console: no disposition action anywhere on the page.
    expect(wrapper.text()).not.toMatch(/处置|标记已处理|关闭工单/);
    wrapper.unmount();
  });
  it("INVITE: mints a code and renders the registry with a disable action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/v1/auth/admin/accounts" && method === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/auth/admin/invites" && method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "9",
                code: "INVITE-ABC123XYZ",
                status: "ACTIVE",
                createdAt: "2026-08-19T08:00:00Z",
                usedAt: null,
                expiresAt: "2026-09-02T00:00:00Z",
                usedByAccount: null,
              },
            ],
          };
        }
        if (url === "/api/v1/auth/admin/invites" && method === "POST") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "10",
              code: "INVITE-NEWCODE99",
              expiresAt: "2026-09-02T00:00:00Z",
            }),
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.findAll('[data-testid="invite-row"]')).toHaveLength(1);

    await wrapper.find('[data-testid="invite-create"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="invite-created"]').text()).toContain("INVITE-NEWCODE99");
    expect(wrapper.find('[data-testid="invite-disable-INVITE-ABC123XYZ"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
