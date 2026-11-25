export type ReasoningEffort =
  "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ModelCatalogInput = {
  provider: ModelProvider;
  endpoint: string;
  token?: string;
};
export type ModelProvider = "openai-compatible" | "anthropic";
export interface ModelProfile {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  hasCredential: boolean;
}
export interface ModelInput {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  token?: string;
}
export interface ModelDelta {
  projectId: string;
  requestId: string;
  text: string;
}

export type ModelCapability = "text" | "image" | "tools";
export interface CapabilityReport {
  checkedAt: string;
  text: "supported" | "unsupported" | "unknown";
  image: "supported" | "unsupported" | "unknown";
  tools: "supported" | "unsupported" | "unknown";
  notes: string[];
}
