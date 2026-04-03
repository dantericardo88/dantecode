export interface SkillProvenance {
  sourceType: string; // native | agent-skills | hf | agency-converted | private-pack | codex | cursor | qwen
  sourceRef: string; // Original path, URL, or repo
  originalName?: string; // Name from source (may differ from slug)
  license: string; // SPDX identifier or "proprietary"
  conversionNotes?: string; // Any notes about conversion/adaptation
  importedAt: string; // ISO timestamp of import
  version?: string; // Version if available from source
}

export function makeProvenance(
  opts: Omit<SkillProvenance, "importedAt"> & { importedAt?: string },
): SkillProvenance {
  return { ...opts, importedAt: opts.importedAt ?? new Date().toISOString() };
}
