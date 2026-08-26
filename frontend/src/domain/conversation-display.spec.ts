// @vitest-environment node
// P1-5：用户可读会话标题 helper——enc2 密文、密文样式 token、空值、裸内部
// id 一律不可直接展示；fallback 只用产品文案或真实日期。
import { describe, expect, it } from "vitest";

import {
  isReadableConversationText,
  readableConversationPreview,
  readableConversationTitle,
} from "./conversation-display";

const ENC2_PREVIEW =
  "enc2:default:1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

describe("conversation-display", () => {
  it("正常标题与预览原样通过", () => {
    const item = { title: "和倾听者的对话", lastMessagePreview: "上次聊到一半" };
    expect(readableConversationTitle(item)).toBe("和倾听者的对话");
    expect(readableConversationPreview(item)).toBe("上次聊到一半");
  });

  it("enc2 密文 preview 不展示，标题退回未命名会话", () => {
    const item = { lastMessagePreview: ENC2_PREVIEW };
    expect(readableConversationTitle(item)).toBe("未命名会话");
    expect(readableConversationPreview(item)).toBeNull();
  });

  it("enc2 密文 title 不展示，标题退回可读 preview（与次行相同则次行隐藏）", () => {
    const item = { title: "enc2:k:2:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=", lastMessagePreview: "真实的最近一条" };
    expect(readableConversationTitle(item)).toBe("真实的最近一条");
    expect(readableConversationPreview(item)).toBe("真实的最近一条");
  });

  it("空标题空预览回落到未命名会话，有真实日期则带日期", () => {
    expect(readableConversationTitle({})).toBe("未命名会话");
    expect(
      readableConversationTitle({ createdAt: "2026-08-19T08:00:00Z" }),
    ).toMatch(/^未命名会话（\d{4}-\d{2}-\d{2}）$/);
  });

  it("密文样式的长无空格 token 同样视为不可读", () => {
    const blob = "x".repeat(120);
    expect(isReadableConversationText(blob)).toBe(false);
    expect(readableConversationTitle({ lastMessagePreview: blob })).toBe(
      "未命名会话",
    );
  });

  it("无效日期不进入文案", () => {
    expect(readableConversationTitle({ createdAt: "not-a-date" })).toBe(
      "未命名会话",
    );
  });

  it("裸内部 id 语义不进入文案（不再拼接 conversationId）", () => {
    const item = { conversationId: "42", lastMessagePreview: "" };
    expect(readableConversationTitle(item)).toBe("未命名会话");
  });
});
