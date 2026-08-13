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
  it("renders an option per relationship plus a placeholder", () => {
    const wrapper = mountSelector();
    const options = wrapper
      .find("select[data-testid='relationship-select']")
      .findAll("option");

    expect(options).toHaveLength(3); // placeholder + 2 relationships
    expect(options[0].attributes("value")).toBe("");
    expect(options[1].attributes("value")).toBe("1");
    expect(options[1].text()).toContain("gentle-listener");
    expect(options[1].text()).toContain("活跃");
  });

  it("emits activate with the selected relationshipId", async () => {
    const wrapper = mountSelector({ currentId: null });

    await wrapper.find("select[data-testid='relationship-select']").setValue("2");

    expect(wrapper.emitted("activate")).toEqual([["2"]]);
  });

  it("disables the create button when personaRef is empty", () => {
    const wrapper = mountSelector();
    const btn = wrapper.find("button[data-testid='create-relationship']");

    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("emits create with the trimmed personaRef on click", async () => {
    const wrapper = mountSelector();

    await wrapper.find("input[data-testid='persona-ref']").setValue("  gentle-listener  ");
    const btn = wrapper.find("button[data-testid='create-relationship']");
    expect(btn.attributes("disabled")).toBeUndefined();

    await btn.trigger("click");

    expect(wrapper.emitted("create")).toEqual([["gentle-listener"]]);
  });

  it("disables the create button when busy", async () => {
    const wrapper = mountSelector({ busy: true });

    await wrapper.find("input[data-testid='persona-ref']").setValue("x");
    const btn = wrapper.find("button[data-testid='create-relationship']");

    expect(btn.attributes("disabled")).toBeDefined();
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
});
