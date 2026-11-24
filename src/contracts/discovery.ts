export interface DiscoveryElement {
  index: number;
  tag: string;
  role: string;
  label: string;
  type: string;
  href?: string;
  options?: string[];
}
export interface DiscoveryPage {
  title: string;
  url: string;
  text: string;
  structure: string;
  elements: DiscoveryElement[];
  fingerprint: string;
  blocked: string[];
}
export type DiscoveryAction =
  | { kind: "click"; index: number }
  | { kind: "fill" | "select"; index: number; value: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "back" }
  | { kind: "finish"; reason: string };
export interface DiscoveryRun {
  id: string;
  projectId: string;
  releaseId: string;
  url: string;
  goal: string;
  budget: number;
  state: "running" | "paused" | "draft";
  message: string;
  createdAt: string;
  captureIds: string[];
  steps: {
    captureId: string;
    observation: string;
    action?: DiscoveryAction;
    result: string;
  }[];
  sources: {
    id: string;
    name: string;
    text: string;
    sha256: string;
    truncated: boolean;
  }[];
  reportId?: string;
}
export interface Understanding {
  id: string;
  runId: string;
  createdAt: string;
  markdown: string;
  digest: string;
  captureIds: string[];
  evidenceHash: string;
  approvedAt?: string;
}
export interface DiscoveryState {
  run: DiscoveryRun | null;
  reports: Understanding[];
  activeReportId: string | null;
}
export interface DiscoveryBridge {
  open(id: string, url: string): Promise<void>;
  state(id: string): Promise<DiscoveryState>;
  start(id: string, goal: string, budget: number): Promise<DiscoveryRun>;
  resume(id: string, runId: string): Promise<DiscoveryRun>;
  cancel(id: string): Promise<void>;
  summarize(id: string, runId: string): Promise<DiscoveryRun>;
  revise(
    id: string,
    reportId: string,
    digest: string,
    markdown: string,
  ): Promise<Understanding>;
  approve(id: string, reportId: string, digest: string): Promise<Understanding>;
  generate(
    id: string,
    reportId: string,
    digest: string,
  ): Promise<import("./workbench.js").PrototypeVersion>;
}
