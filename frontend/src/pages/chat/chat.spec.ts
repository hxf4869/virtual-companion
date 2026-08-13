// @vitest-environment happy-dom
// TASK-0186/TASK-0187: chat page component glue test. TASK-0187 wires the
// relationship selector: the page loads the owner's relationships on mount and
// creates a conversation under the active one, or shows the selector when none
// is active. The send-flow UI (input/send/status/history) renders only after a
// relationship is selected.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "./chat.vue";

const ACTIVE_RELATIONSHIP = {
  relationshipId: 1,
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-13T01:00:00Z",
};

/** Stub fetch to satisfy the mount-time relationship load + conversation create. */
function stubFetch(opts: { relationships?: unknown[] } = {}): void {
  const relationships = opts.relationships ?? [ACTIVE_RELATIONSHIP];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => relationships };
      }
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

describe("chat page glue (TASK-0186 send flow + TASK-0187 relationship gate)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
    stubFetch();
  });

  it("renders the message input and send button once a relationship is active", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="send"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("renders the status region with role=status and aria-live=polite", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const status = wrapper.find('[data-testid="status"]');
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    wrapper.unmount();
  });

  it("disables the send button when the input is empty", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const send = wrapper.find('button[data-testid="send"]');
    expect(send.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("enables the send button after the user types", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const input = wrapper.find('input[data-testid="message-input"]');
    const send = wrapper.find('button[data-testid="send"]');

    await input.setValue("Hello world");
    expect(send.attributes("disabled")).toBeUndefined();

    wrapper.unmount();
  });

  it("renders the message history container", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="history"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows the relationship selector and hides the chat input when no relationship is active", async () => {
    stubFetch({ relationships: [] });

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="relationship-selector"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="message-input"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
