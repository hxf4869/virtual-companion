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

/** 首页与会话列表使用的紧凑本地时间，不泄露原始 ISO 字符串。 */
export function formatConversationActivity(
  value: string | undefined,
  now: number | Date = Date.now(),
): string {
  if (!value) return "";
  const activityMs = Date.parse(value);
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(activityMs) || !Number.isFinite(nowMs)) return "";

  const activity = new Date(activityMs);
  const current = new Date(nowMs);
  const activityDay = Date.UTC(
    activity.getFullYear(), activity.getMonth(), activity.getDate(),
  );
  const currentDay = Date.UTC(
    current.getFullYear(), current.getMonth(), current.getDate(),
  );
  const dayDifference = Math.round((currentDay - activityDay) / 86_400_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  const time = `${pad(activity.getHours())}:${pad(activity.getMinutes())}`;

  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (activity.getFullYear() === current.getFullYear()) {
    return `${activity.getMonth() + 1} 月 ${activity.getDate()} 日`;
  }
  return `${activity.getFullYear()} 年 ${activity.getMonth() + 1} 月 ${activity.getDate()} 日`;
}
