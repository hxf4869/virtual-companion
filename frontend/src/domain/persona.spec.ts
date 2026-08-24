import { describe, expect, it } from "vitest";

import { personaDisplayName } from "./persona";

describe("personaDisplayName", () => {
  it("shows approved display copy and redacts unknown template ids", () => {
    expect(personaDisplayName("gentle-listener")).toBe("温和倾听者");
    expect(personaDisplayName("internal-template-v99")).toBe("陪伴角色");
  });
});
