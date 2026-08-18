// Curated companion presentation (FR-COMP-002). Codes match the catalog;
// glyphs are Alpha placeholders, not uploaded photos.

import { personaDisplayName } from "@/domain/persona";

export type CompanionAvatarCode = "AVATAR_FEMALE_01" | "AVATAR_MALE_01" | "AVATAR_NEUTRAL_01";

export interface CompanionAvatarOption {
  code: CompanionAvatarCode;
  name: string;
  glyph: string;
  theme: string;
}

export const COMPANION_AVATAR_OPTIONS: readonly CompanionAvatarOption[] = [
  { code: "AVATAR_FEMALE_01", name: "温婉", glyph: "F", theme: "rose" },
  { code: "AVATAR_MALE_01", name: "沉稳", glyph: "M", theme: "teal" },
  { code: "AVATAR_NEUTRAL_01", name: "自然", glyph: "N", theme: "gold" },
];

export function companionAvatarOption(
  code: string | null | undefined,
): CompanionAvatarOption {
  return (
    COMPANION_AVATAR_OPTIONS.find((option) => option.code === code) ??
    COMPANION_AVATAR_OPTIONS[2]
  );
}

export function companionHeaderName(rel: {
  companionName?: string | null;
  personaRef: string;
}): string {
  const named = rel.companionName?.trim();
  return named ? named : personaDisplayName(rel.personaRef);
}
