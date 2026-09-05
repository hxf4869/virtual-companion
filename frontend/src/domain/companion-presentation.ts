/** Public name only; internal persona template ids never appear in consumer UI. */
export function companionHeaderName(relationship: {
  companionName?: string | null;
}): string {
  return relationship.companionName?.trim() || "陪伴者";
}
