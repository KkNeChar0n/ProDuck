export type ModelProvider = "openai-compatible" | "anthropic";
export interface ModelProfile {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  hasCredential: boolean;
}
export interface ModelInput {
  provider: ModelProvider;
  endpoint: string;
  model: string;
  token?: string;
}
export interface ModelDelta {
  projectId: string;
  requestId: string;
  text: string;
}
