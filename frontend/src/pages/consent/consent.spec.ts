// @vitest-environment happy-dom
// CONSENT (FR-AUTH-003): consent page glue test — renders the eight-type
// catalogue with effective statuses and routes grant/revoke through the store.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConsentPage from "./consent.vue";
import { ConsentHttpError } from "@/api/consent";
import { useConsentStore } from "@/stores/consent";

const EFFECTIVE = [
  {
    consentId: 12,
    consentType: "SERVICE_TERMS",
    version: "2026-08",
    granted: true,
    grantedAt: "2026-08-15T08:00:00Z",
  },
  {
    consentId: 13,
    consentType: "MODEL_TRAINING",
    version: "2026-08",
    granted: false,
    grantedAt: "2026-08-15T09:00:00Z",
  },
];

function stubFetch(failConsents: () => boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/consents") {
        if (failConsents()) {
          return { ok: false, status: 500, json: async () => null };
        }
        return { ok: true, status: 200, json: async () => EFFECTIVE };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function rowByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const rows = wrapper.findAll('[data-testid="consent-row"]');
  const row = rows.find((r) => r.text().includes(label));
  if (!row) throw new Error(`consent row not found: ${label}`);
  return row;
}

describe("consent page (FR-AUTH-003)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch(() => false);
  });

  it("renders the eight-type catalogue with effective statuses", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(8);

    const terms = rowByLabel(wrapper, "用户服务协议");
    expect(terms.find('[data-testid="consent-status"]').text()).toBe("已同意");
    expect(terms.find('[data-testid="consent-grant"]').attributes("disabled")).toBeDefined();
    expect(terms.find('[data-testid="consent-revoke"]').attributes("disabled")).toBeUndefined();

    const training = rowByLabel(wrapper, "模型训练/产品改进");
    expect(training.find('[data-testid="consent-status"]').text()).toBe("已撤回");
    expect(training.text()).toContain("撤回不影响基本聊天");
    expect(training.find('[data-testid="consent-grant"]').attributes("disabled")).toBeUndefined();

    wrapper.unmount();
  });

  it("shows the pinned version and 未记录 for never-recorded types", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.text()).toContain("版本 2026-08");
    const push = rowByLabel(wrapper, "消息推送");
    expect(push.find('[data-testid="consent-status"]').text()).toBe("未记录");
    expect(push.find('[data-testid="consent-revoke"]').attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("routes a grant through the store with the pinned version (no password gate)", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    const store = useConsentStore();
    const setSpy = vi.spyOn(store, "setConsent").mockResolvedValue(true);

    const training = rowByLabel(wrapper, "模型训练/产品改进");
    // ADR-0006 §7.7: the grant direction never shows a password panel.
    expect(training.find('[data-testid="consent-revoke-panel"]').exists()).toBe(false);
    await training.find('[data-testid="consent-grant"]').trigger("click");
    await flushPromises();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0].slice(1)).toEqual(["MODEL_TRAINING", "2026-08", true]);

    wrapper.unmount();
  });

  it("routes a revoke through the store with the re-entered password", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    const store = useConsentStore();
    const setSpy = vi.spyOn(store, "setConsent").mockResolvedValue(true);

    const terms = rowByLabel(wrapper, "用户服务协议");
    // Step 1: the revoke click opens the inline password panel (no request yet).
    await terms.find('[data-testid="consent-revoke"]').trigger("click");
    await flushPromises();
    const panel = terms.find('[data-testid="consent-revoke-panel"]');
    expect(panel.exists()).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();

    // Step 2: confirm with the current password.
    await panel.find('[data-testid="consent-revoke-password"]').setValue("Current-Pass-1!");
    await panel.find('[data-testid="consent-revoke-confirm"]').trigger("click");
    await flushPromises();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0].slice(1))
      .toEqual(["SERVICE_TERMS", "2026-08", false, "Current-Pass-1!"]);

    wrapper.unmount();
  });

  it("never sends a revoke without the password re-entry", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    const store = useConsentStore();
    const setSpy = vi.spyOn(store, "setConsent").mockResolvedValue(true);

    const terms = rowByLabel(wrapper, "用户服务协议");
    await terms.find('[data-testid="consent-revoke"]').trigger("click");
    const panel = terms.find('[data-testid="consent-revoke-panel"]');
    await panel.find('[data-testid="consent-revoke-confirm"]').trigger("click");
    await flushPromises();

    expect(setSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="consent-action-failed"]').text()).toContain("当前密码");
    // The panel stays open for a retry.
    expect(terms.find('[data-testid="consent-revoke-panel"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("keeps the revoke panel open when the server rejects the password (404)", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    const store = useConsentStore();
    vi.spyOn(store, "setConsent").mockRejectedValue(new ConsentHttpError(404));

    const terms = rowByLabel(wrapper, "用户服务协议");
    await terms.find('[data-testid="consent-revoke"]').trigger("click");
    const panel = terms.find('[data-testid="consent-revoke-panel"]');
    await panel.find('[data-testid="consent-revoke-password"]').setValue("wrong");
    await panel.find('[data-testid="consent-revoke-confirm"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="consent-action-failed"]').text())
      .toContain("当前密码不正确");
    expect(terms.find('[data-testid="consent-revoke-panel"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("shows the load-failed banner and recovers via retry", async () => {
    let fail = true;
    stubFetch(() => fail);
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="consent-load-failed"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(0);

    fail = false;
    await wrapper.find('[data-testid="consent-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="consent-load-failed"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(8);

    wrapper.unmount();
  });

  it("shows a plain error when the store rejects a toggle", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    const store = useConsentStore();
    vi.spyOn(store, "setConsent").mockRejectedValue(new Error("boom"));

    const push = rowByLabel(wrapper, "消息推送");
    await push.find('[data-testid="consent-grant"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="consent-action-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="consent-action-failed"]').text()).toContain("同意提交失败");

    wrapper.unmount();
  });

  it("EMERGENCY-CONTACT: renders the draft card and walks the verify flow (§20.14)", async () => {
    const draft = {
      id: "42",
      label: "妈妈",
      contact: "+86 138 0000 0000",
      status: "DRAFT",
      createdAt: "2026-08-19T08:00:00Z",
      updatedAt: "2026-08-19T08:00:00Z",
    };
    const verified = {
      ...draft,
      status: "VERIFIED",
      consentVersion: "2026-08",
      verifiedAt: "2026-08-19T09:00:00Z",
      verifiedMethod: "SIMULATED_EMAIL_LINK",
      verifiedExpiresAt: "2027-02-15T09:00:00Z",
    };
    const emergencyContact = { current: { ...draft } as typeof draft | typeof verified };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/consents") {
          return { ok: true, status: 200, json: async () => EFFECTIVE };
        }
        if (url === "/api/v1/emergency-contact" && (init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => emergencyContact.current };
        }
        if (url === "/api/v1/emergency-contact/verify-start") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "42",
              token: "a1b2c3d4e5f6",
              invitedAt: "2026-08-19T08:30:00Z",
            }),
          };
        }
        if (url === "/api/v1/emergency-contact/verify-confirm") {
          emergencyContact.current = verified;
          return { ok: true, status: 200, json: async () => verified };
        }
        if (url === "/api/v1/emergency-contact/revoke") {
          emergencyContact.current = draft;
          return { ok: true, status: 200, json: async () => ({ revoked: true }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    // The draft card renders with the explicit 未验证 warning.
    expect(wrapper.find('[data-testid="emc-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="emc-status"]').text()).toContain("草稿（未验证）");

    // Invite → the simulated token shows for manual relay.
    await wrapper.find('[data-testid="emc-invite"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="emc-invite-token"]').text()).toContain("a1b2c3d4e5f6");
    expect(wrapper.find('[data-testid="emc-invite-token"]').text()).toContain("模拟邀请");

    // The contact-side acceptance flips the card to 已验证.
    await wrapper.find('[data-testid="emc-confirm-token"]').setValue("a1b2c3d4e5f6");
    await wrapper.find('[data-testid="emc-confirm"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="emc-status"]').text()).toContain("已验证");
    expect(wrapper.find('[data-testid="emc-card"]').text()).toContain("SIMULATED_EMAIL_LINK");

    wrapper.unmount();
  });

  it("EMERGENCY-CONTACT: hides the whole section while the capability is off (403, §20.14)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/consents") {
          return { ok: true, status: 200, json: async () => EFFECTIVE };
        }
        if (url === "/api/v1/emergency-contact") {
          // Capability disabled on the deployment (§20.14 未完成评审宁可不启用).
          return {
            ok: false,
            status: 403,
            json: async () => ({ code: "BETA_OPERATIONS_NOT_READY" }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="emc-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="emc-save"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="emc-status"]').exists()).toBe(false);
    // The consent rows themselves keep working (the EMERGENCY_CONTACT consent
    // row stays — the hidden section is the capability, not the consent type).
    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(8);
    wrapper.unmount();
  });
});
