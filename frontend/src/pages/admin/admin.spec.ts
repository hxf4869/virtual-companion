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
