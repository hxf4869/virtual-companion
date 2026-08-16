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
});
