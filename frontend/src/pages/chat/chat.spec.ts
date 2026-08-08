// @vitest-environment happy-dom
// TASK-0106 (P2-19): chat page component glue test -- the status region
// carries role=status + aria-live, the cancel button aria-busy while
// streaming, and a failed resume surfaces the typed "恢复失败，请重试" text
// instead of an empty/disconnected-looking stream.
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./chat.vue";

function mountPage() {
  return mount(ChatPage, { attachTo: document.body });
}

describe("chat page glue (P2-19 component test)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    // The page starts a resume on mount; stub fetch so no real network call
    // happens. A plain rejection exercises the exhausted path (P1-07): the
    // page shows a typed failure, never a fake terminal or empty stream.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
  });

  it("renders the status region with role=status and aria-live=polite", () => {
    const wrapper = mountPage();
    const status = wrapper.find('[data-testid="status"]');
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    wrapper.unmount();
  });

  it("binds aria-busy on the cancel button to the streaming state", async () => {
    const wrapper = mountPage();
    const cancel = wrapper.find('button[data-testid="cancel"]');
    // The page starts a run on mount; while the (stubbed, failing) stream is
    // in flight the button is busy, and after the typed failure it settles.
    expect(cancel.attributes("aria-busy")).toBe("true");
    await vi.waitFor(() => {
      expect(cancel.attributes("aria-busy")).toBe("false");
    });
    wrapper.unmount();
  });

  it("surfaces a typed failure instead of an empty stream", async () => {
    const wrapper = mountPage();
    const status = wrapper.find('[data-testid="status"]');
    await vi.waitFor(() => {
      expect(status.text()).toContain("恢复失败");
    });
    expect(status.text()).toContain("请重试");
    wrapper.unmount();
  });
});
