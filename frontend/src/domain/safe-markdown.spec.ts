import { describe, expect, it } from "vitest";

import {
  MAX_CODE_CHARS,
  MAX_DISPLAY_CHARS,
  parseSafeMarkdown,
} from "./safe-markdown";

describe("parseSafeMarkdown", () => {
  it("keeps a plain paragraph as text, not HTML", () => {
    const blocks = parseSafeMarkdown("你好，世界");
    expect(blocks).toEqual([{ kind: "p", parts: [{ text: "你好，世界" }] }]);
  });

  it("marks **bold**, *italic* and `code` without emitting tags", () => {
    const blocks = parseSafeMarkdown("说 **重点** 和 *轻声* 以及 `ok`");
    expect(blocks).toEqual([
      {
        kind: "p",
        parts: [
          { text: "说 " },
          { text: "重点", style: "strong" },
          { text: " 和 " },
          { text: "轻声", style: "em" },
          { text: " 以及 " },
          { text: "ok", style: "code" },
        ],
      },
    ]);
  });

  it("treats raw HTML as text so it cannot run", () => {
    const blocks = parseSafeMarkdown('<img src=x onerror="alert(1)"><script>x</script>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("p");
    const joined = blocks[0]?.kind === "p" ? blocks[0].parts.map((p) => p.text).join("") : "";
    expect(joined).toContain("<img");
    expect(joined).toContain("<script>");
    expect(JSON.stringify(blocks)).not.toMatch(/"kind":"html"/);
  });

  it("captures a fenced code block and truncates a long one", () => {
    const short = parseSafeMarkdown("```\nconst a = 1;\n```");
    expect(short).toEqual([{ kind: "code", text: "const a = 1;", truncated: false }]);

    const longSrc = "```\n" + "x".repeat(MAX_CODE_CHARS + 20) + "\n```";
    const long = parseSafeMarkdown(longSrc);
    expect(long[0]?.kind).toBe("code");
    if (long[0]?.kind === "code") {
      expect(long[0].truncated).toBe(true);
      expect(long[0].text.length).toBe(MAX_CODE_CHARS);
    }
  });

  it("parses unordered list lines", () => {
    const blocks = parseSafeMarkdown("- 一\n- 二");
    expect(blocks).toEqual([
      {
        kind: "ul",
        items: [[{ text: "一" }], [{ text: "二" }]],
      },
    ]);
  });

  it("truncates a very long paragraph and flags it", () => {
    const src = "哈".repeat(MAX_DISPLAY_CHARS + 50);
    const blocks = parseSafeMarkdown(src);
    expect(blocks[0]?.kind).toBe("p");
    if (blocks[0]?.kind === "p") {
      const text = blocks[0].parts.map((p) => p.text).join("");
      expect(text.length).toBe(MAX_DISPLAY_CHARS);
      expect(blocks[0].truncated).toBe(true);
    }
  });

  it("does not treat a javascript: link as a navigable target", () => {
    const blocks = parseSafeMarkdown("[x](javascript:alert(1))");
    const joined =
      blocks[0]?.kind === "p" ? blocks[0].parts.map((p) => p.text).join("") : "";
    expect(joined).toContain("javascript:alert(1)");
    expect(blocks.every((b) => b.kind === "p" || b.kind === "code" || b.kind === "ul")).toBe(
      true,
    );
  });
});
