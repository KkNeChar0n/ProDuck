import type { PythonSkill } from "../skills/python-manifest.js";
export interface ImportedSkill {
  python?: PythonSkill;
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

export interface PythonRun {
  id: string;
  skillId: string;
  fingerprint: string;
  state: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  output: string;
  message: string;
  relativePath: string;
}
