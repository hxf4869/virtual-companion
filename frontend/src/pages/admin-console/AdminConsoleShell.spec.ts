// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminConsoleShell from "./AdminConsoleShell.vue";

describe("admin console shell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("offers an explicit retry when access cannot be checked", async () => {
    const wrapper = mount(AdminConsoleShell, {
      props: {
        active: "overview",
        title: "运行总览",
        accessState: "unavailable",
      },
    });

    await wrapper.get('[data-testid="admin-access-retry"]').trigger("click");

    expect(wrapper.emitted("retry-access")).toHaveLength(1);
    wrapper.unmount();
  });

  it("asks the browser to retain a page that has staged changes", () => {
    const wrapper = mount(AdminConsoleShell, {
      props: {
        active: "models",
        title: "模型服务",
        accessState: "ready",
        hasPendingChanges: true,
      },
    });
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
  });
});
