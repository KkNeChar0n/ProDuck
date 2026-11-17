export interface AgentCall {
  tool: string;
  args: Record<string, unknown>;
}
export type AgentDecision = { done: string } | { call: AgentCall };
export interface AgentStep {
  id: string;
  call: AgentCall;
  state: "waiting-user" | "running" | "succeeded" | "failed" | "interrupted";
  output?: string;
  approvalContext?: { label: string; fingerprint: string };
}
export interface AgentRun {
  skill?: { id: string; fingerprint: string; text: string };
  id: string;
  projectId: string;
  goal: string;
  budget: number;
  state:
    | "running"
    | "waiting-user"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  steps: AgentStep[];
  message: string;
  createdAt: string;
}
export interface ToolDescription {
  name: string;
  description: string;
  args: Record<string, "string">;
  required: string[];
  approval: boolean;
}
