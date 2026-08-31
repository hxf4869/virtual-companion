// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentHttpError } from "@/api/consent";
import { useConsentStore } from "@/stores/consent";

import ConsentPage from "./consent.vue";

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

function stubFetch(failConsents: () => boolean): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/v1/consents") {
      if (failConsents()) {
        return { ok: false, status: 500, json: async () => null };
      }
      return { ok: true, status: 200, json: async () => EFFECTIVE };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function rowByLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const row = wrapper.findAll('[data-testid="consent-row"]')
    .find((candidate) => candidate.text().includes(label));
  if (!row) throw new Error(`consent row not found: ${label}`);
  return row;
}

describe("consent page (FR-AUTH-003)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch(() => false);
  });

  it("renders the admission shell and the effective consent catalogue", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="page-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(8);

    const terms = rowByLabel(wrapper, "用户服务协议");
    expect(terms.find('[data-testid="consent-status"]').text()).toBe("已同意");
    expect(terms.find('[data-testid="consent-grant"]').attributes("disabled")).toBeDefined();
    expect(terms.find('[data-testid="consent-revoke"]').attributes("disabled")).toBeUndefined();

    const training = rowByLabel(wrapper, "模型训练/产品改进");
    expect(training.find('[data-testid="consent-status"]').text()).toBe("已撤回");
    expect(training.text()).toContain("撤回不影响基本聊天");
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

  it("routes a grant through the store without a password gate", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();
    const setSpy = vi.spyOn(useConsentStore(), "setConsent").mockResolvedValue(true);
    const training = rowByLabel(wrapper, "模型训练/产品改进");

    expect(training.find('[data-testid="consent-revoke-panel"]').exists()).toBe(false);
    await training.find('[data-testid="consent-grant"]').trigger("click");
    await flushPromises();
    expect(setSpy.mock.calls[0]?.slice(1)).toEqual(["MODEL_TRAINING", "2026-08", true]);
    wrapper.unmount();
  });

  it("requires the current password before revoking consent", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();
    const setSpy = vi.spyOn(useConsentStore(), "setConsent").mockResolvedValue(true);
    const terms = rowByLabel(wrapper, "用户服务协议");

    await terms.find('[data-testid="consent-revoke"]').trigger("click");
    const panel = terms.find('[data-testid="consent-revoke-panel"]');
    expect(panel.exists()).toBe(true);
    await panel.find('[data-testid="consent-revoke-confirm"]').trigger("click");
    expect(setSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="consent-action-failed"]').text()).toContain("当前密码");

    await panel.find('[data-testid="consent-revoke-password"]').setValue("Current-Pass-1!");
    await panel.find('[data-testid="consent-revoke-confirm"]').trigger("click");
    await flushPromises();
    expect(setSpy.mock.calls[0]?.slice(1))
      .toEqual(["SERVICE_TERMS", "2026-08", false, "Current-Pass-1!"]);
    wrapper.unmount();
  });

  it("keeps the revoke panel open when the password is rejected", async () => {
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();
    vi.spyOn(useConsentStore(), "setConsent").mockRejectedValue(new ConsentHttpError(404));
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

  it("shows a load failure and recovers via retry", async () => {
    let fail = true;
    stubFetch(() => fail);
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('[data-testid="consent-load-failed"]').exists()).toBe(true);

    fail = false;
    await wrapper.find('[data-testid="consent-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="consent-load-failed"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="consent-row"]')).toHaveLength(8);
    wrapper.unmount();
  });

  it("does not render or call the retired emergency-contact capability", async () => {
    const fetchMock = stubFetch(() => false);
    const wrapper = mount(ConsentPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="emc-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="emc-save"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="emc-status"]').exists()).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/emergency-contact")))
      .toBe(false);
    wrapper.unmount();
  });
});
