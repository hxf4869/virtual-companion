/** Calendar day of an ISO instant; non-dates pass through unchanged. */
export function formatTimestamp(value: string | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
