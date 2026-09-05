// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";

import AdminReviewPage from "./admin.vue";

const pendingAccount = {
  accountId: "7",
  email: "new@example.com",
  username: "new-user",
  displayName: "新用户",
  role: "USER",
  status: "PENDING_REVIEW",
  emailVerified: true,
  authenticatorEnabled: false,
  createdAt: "2026-09-01T00:00:00Z",
};

function loginAdmin() {
  const auth = useAuthStore();
  auth.accountId = "1";
  auth.accessToken = "session";
  auth.role = "ADMIN";
}

describe("registration review page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loginAdmin();
  });

  it("renders a factual queue and explains the post-approval authenticator step", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, [pendingAccount])));
    const wrapper = mount(AdminReviewPage);
    await flushPromises();

    expect(wrapper.get('[data-testid="admin-review"]').text()).toContain("new@example.com");
    expect(wrapper.text()).toContain("邮箱已验证");
    expect(wrapper.text()).toContain("首次登录仍需绑定身份验证器");
    expect(wrapper.text()).not.toContain("风险分");
    expect(wrapper.text()).not.toContain("审核时限");
    wrapper.unmount();
  });

  it("reauthenticates and approves one selected application", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/api/v1/admin/accounts" && method === "GET") return response(200, [pendingAccount]);
      if (url === "/api/v1/auth/reauth") return response(200, { ok: true });
      if (url === "/api/v1/admin/accounts/7/review") return response(200, { ok: true, status: "ACTIVE" });
      return response(404, null);
    }));
    const wrapper = mount(AdminReviewPage);
    await flushPromises();

    await wrapper.get('[data-testid="review-approve"]').trigger("click");
    await wrapper.get('[data-testid="review-password"]').setValue("Admin-Pass-1!");
    await wrapper.get('[data-testid="review-confirm-submit"]').trigger("click");
    await flushPromises();

    expect(calls).toContainEqual(expect.objectContaining({ method: "POST", url: "/api/v1/auth/reauth" }));
    expect(calls).toContainEqual(expect.objectContaining({
      method: "POST",
      url: "/api/v1/admin/accounts/7/review",
      body: JSON.stringify({ decision: "APPROVE" }),
    }));
    expect(wrapper.find('[data-testid="review-empty"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows an honest empty state when registration has no pending applications", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, [])));
    const wrapper = mount(AdminReviewPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="review-empty"]').text()).toContain("暂时没有待审核申请");
    wrapper.unmount();
  });

  it("does not enable approval when email verification is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, [{ ...pendingAccount, emailVerified: false }])));
    const wrapper = mount(AdminReviewPage);
    await flushPromises();
    expect(wrapper.get('[data-testid="review-approve"]').attributes()).toHaveProperty("disabled");
    wrapper.unmount();
  });
});

function response(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    headers: new Headers(),
  };
}
