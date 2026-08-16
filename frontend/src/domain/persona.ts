// PERSONA-WIRE: the H5-facing persona template directory. The template ids
// mirror specs/catalog/persona-templates.yaml (single source of truth for the
// ids); the display copy is UI-only presentation, not persona prompt content
// (real persona content is approved out of band — see PersonaSkeleton).

export interface PersonaOption {
  templateId: string;
  displayName: string;
  description: string;
}

export const PERSONA_OPTIONS: readonly PersonaOption[] = [
  {
    templateId: "gentle-listener",
    displayName: "温和倾听者",
    description: "低压力、反思式倾听",
  },
];

/** Display name for a persona template id; falls back to the raw id. */
export function personaDisplayName(templateId: string): string {
  const option = PERSONA_OPTIONS.find((o) => o.templateId === templateId);
  return option ? option.displayName : templateId;
}
