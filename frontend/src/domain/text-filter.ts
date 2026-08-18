/** Case-insensitive substring match; a blank query keeps every row. */
export function matchesLooseText(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle);
}
