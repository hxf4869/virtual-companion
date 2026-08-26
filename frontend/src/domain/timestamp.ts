/** Calendar day of an ISO instant; non-dates pass through unchanged. */
export function formatTimestamp(value: string | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 消费者界面的本地化时间：按本机时区渲染 YYYY-MM-DD HH:mm，绝不直接
 * 展示带 Z 的原始 ISO 串；无效输入原样返回（调用方已知字段格式）。
 */
export function formatLocalDateTime(value: string | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const date = new Date(ms);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
