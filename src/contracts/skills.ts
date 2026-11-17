export interface ImportedSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  fingerprint: string;
  importedAt: string;
  resources: string[];
  status: "runnable" | "needs-approval" | "unsupported";
  reasons: string[];
  mappings: { requested: string; provided: string }[];
}
