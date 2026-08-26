// 用户可读会话展示（P1-5）：REST 加密形态（enc2:/enc1: 前缀）、密文样式的
// 长无空格块、空值与裸内部 ID 一律不作为用户界面文本直接展示。所有消费
// title/lastMessagePreview 的页面统一走本 helper，fallback 只用产品文案或
// 真实日期，绝不拼接 conversationId 这类内部标识。

interface ConversationLike {
  title?: string;
  lastMessagePreview?: string;
  createdAt?: string;
}

/** 后端 RestFieldCipher 的存储形态前缀；读到即视为不可解的用户视图。 */
const OPAQUE_PREFIX = /^(enc1:|enc2:)/i;

/** 密文样式的长 token（无任何空白且超长）也按不可读处理。 */
const OPAQUE_TOKEN = /^\S{96,}$/;

export function isReadableConversationText(
  value: string | null | undefined,
): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  if (OPAQUE_PREFIX.test(trimmed)) return false;
  if (OPAQUE_TOKEN.test(trimmed)) return false;
  return true;
}

/** 真实日期（YYYY-MM-DD 起头的 ISO 时间戳）→ 本地日期文本；无效返回空。 */
function readableDate(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "";
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 一行摘要文本：可读 title → 可读 preview → "未命名会话（真实日期）"。 */
export function readableConversationTitle(item: ConversationLike): string {
  if (isReadableConversationText(item.title)) return item.title!.trim();
  if (isReadableConversationText(item.lastMessagePreview)) {
    return item.lastMessagePreview!.trim();
  }
  const date = readableDate(item.createdAt);
  return date ? `未命名会话（${date}）` : "未命名会话";
}

/** 次行预览：可读才返回，否则 null（调用方整行隐藏，不显示占位密文）。 */
export function readableConversationPreview(item: ConversationLike): string | null {
  if (!isReadableConversationText(item.lastMessagePreview)) return null;
  return item.lastMessagePreview!.trim();
}
