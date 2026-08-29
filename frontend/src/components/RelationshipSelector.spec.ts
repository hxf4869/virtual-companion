// @vitest-environment happy-dom
// TASK-0187: RelationshipSelector component glue test — verifies the selector
// renders an option per relationship, emits activate on selection, and emits
// create with the trimmed personaRef. Error/loading a11y roles are asserted.
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import RelationshipSelector from "./RelationshipSelector.vue";
import type { Relationship } from "@/api/relationship";

const RELATIONSHIPS: Relationship[] = [
  { relationshipId: "1", personaRef: "gentle-listener", active: true, createdAt: "2026-08-13T01:00:00Z" },
  { relationshipId: "2", personaRef: "other", active: false, createdAt: "2026-08-13T02:00:00Z" },
];

function mountSelector(props: Record<string, unknown> = {}) {
  return mount(RelationshipSelector, {
    props: { relationships: RELATIONSHIPS, ...props },
  });
}

describe("RelationshipSelector (TASK-0187)", () => {
  it("renders the persona template directory as options (PERSONA-WIRE)", () => {
    const wrapper = mountSelector();
    const options = wrapper
      .find("select[data-testid='persona-select']")
      .findAll("option");

    expect(options).toHaveLength(2); // placeholder + gentle-listener
    expect(options[0].attributes("value")).toBe("");
    expect(options[1].attributes("value")).toBe("gentle-listener");
    expect(options[1].text()).toContain("温和倾听者");
  });

  it("renders an option per relationship plus a placeholder", () => {
    const wrapper = mountSelector();
    const options = wrapper
      .find("select[data-testid='relationship-select']")
      .findAll("option");

    expect(options).toHaveLength(3); // placeholder + 2 relationships
    expect(options[0].attributes("value")).toBe("");
    expect(options[1].attributes("value")).toBe("1");
    expect(options[1].text()).toContain("温和倾听者");
    expect(options[1].text()).not.toContain("gentle-listener");
    expect(options[2].text()).toContain("陪伴角色");
    expect(options[2].text()).not.toContain("other");
    expect(options[1].text()).toContain("活跃");
  });

  it("emits activate with the selected relationshipId", async () => {
    const wrapper = mountSelector({ currentId: null });

    await wrapper.find("select[data-testid='relationship-select']").setValue("2");

    expect(wrapper.emitted("activate")).toEqual([["2"]]);
  });

  it("disables the create button when no persona template is chosen", () => {
    const wrapper = mountSelector();
    const btn = wrapper.find("button[data-testid='create-relationship']");

    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("emits create with the chosen persona template id on click (PERSONA-WIRE)", async () => {
    const wrapper = mountSelector();

    await wrapper.find("select[data-testid='persona-select']").setValue("gentle-listener");
    const btn = wrapper.find("button[data-testid='create-relationship']");
    expect(btn.attributes("disabled")).toBeUndefined();

    await btn.trigger("click");

    expect(wrapper.emitted("create")).toEqual([["gentle-listener"]]);
  });

  it("disables the create controls when busy", async () => {
    const wrapper = mountSelector({ busy: true });

    await wrapper.find("select[data-testid='persona-select']").setValue("gentle-listener");
    const btn = wrapper.find("button[data-testid='create-relationship']");
    const select = wrapper.find("select[data-testid='persona-select']");

    expect(btn.attributes("disabled")).toBeDefined();
    expect(select.attributes("disabled")).toBeDefined();
  });

  it("renders an alert role when status is error", () => {
    const wrapper = mountSelector({ status: "error" });

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("renders a polite live region when loading", () => {
    const wrapper = mountSelector({ status: "loading" });
    const status = wrapper.find('[data-testid="rel-status"]');

    expect(status.exists()).toBe(true);
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
  });

  it("shows an empty-relationships status when the list is empty and idle", () => {
    const wrapper = mountSelector({ relationships: [], status: "idle" });
    const empty = wrapper.find('[data-testid="empty-relationships"]');

    expect(empty.exists()).toBe(true);
    expect(empty.attributes("role")).toBe("status");
    expect(empty.text()).toContain("还没有关系");
    expect(empty.text()).toContain("新建");
  });

  it("hides create controls when showCreate is false", () => {
    const wrapper = mountSelector({ showCreate: false });

    expect(wrapper.find('[data-testid="persona-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="create-relationship"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("uses a create-free empty message when showCreate is false", () => {
    const wrapper = mountSelector({
      relationships: [],
      status: "idle",
      showCreate: false,
    });
    const empty = wrapper.find('[data-testid="empty-relationships"]');

    expect(empty.exists()).toBe(true);
    expect(empty.text()).toBe("还没有关系。选择一个人设，创建你的陪伴。");
    wrapper.unmount();
  });

  it("hides the empty-relationships status when loading, on error, or when items exist", () => {
    const loading = mountSelector({ relationships: [], status: "loading" });
    expect(loading.find('[data-testid="empty-relationships"]').exists()).toBe(false);
    loading.unmount();

    const errored = mountSelector({ relationships: [], status: "error" });
    expect(errored.find('[data-testid="empty-relationships"]').exists()).toBe(false);
    errored.unmount();

    const filled = mountSelector({ status: "idle" });
    expect(filled.find('[data-testid="empty-relationships"]').exists()).toBe(false);
    filled.unmount();
  });
});
