// @vitest-environment happy-dom
// TASK-0186: chat page component glue test — verifies the send-flow UI renders
// the message input, send button, status region (role=status + aria-live) and
// that the send button is disabled until the user types. The page no longer
// auto-starts a stream on mount (TASK-0185 demo mode removed); instead it
// creates a conversation on mount and waits for user input.
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./chat.vue";

/** Stub fetch to satisfy the mount-time conversation creation + history load. */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/conversations") {
        return { ok: true, status: 200, json: async () => ({ conversationId: 1 }) };
      }
      if (url.includes("/messages")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function mountPage() {
  return mount(ChatPage, { attachTo: document.body });
}

describe("chat page glue (TASK-0186 send flow)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
  });

  it("renders the message input and send button", () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="send"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the status region with role=status and aria-live=polite", () => {
    const wrapper = mountPage();
    const status = wrapper.find('[data-testid="status"]');
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    wrapper.unmount();
  });

  it("disables the send button when the input is empty", () => {
    const wrapper = mountPage();
    const send = wrapper.find('button[data-testid="send"]');
    expect(send.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("enables the send button after the user types", async () => {
    const wrapper = mountPage();
    const input = wrapper.find('input[data-testid="message-input"]');
    const send = wrapper.find('button[data-testid="send"]');

    await input.setValue("Hello world");
    expect(send.attributes("disabled")).toBeUndefined();

    wrapper.unmount();
  });

  it("renders the message history container", () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="history"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
