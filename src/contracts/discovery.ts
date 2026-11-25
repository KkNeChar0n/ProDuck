export interface DiscoveryElement {
  index: number;
  key?: string;
  draggable?: boolean;
  dragHint?: boolean;
  box?: { x: number; y: number; width: number; height: number };
  tag: string;
  role: string;
  label: string;
  type: string;
  href?: string;
  options?: string[];
  submitsForm?: boolean;
  inForm?: boolean;
  value?: string;
  checked?: boolean;
  required?: boolean;
  valid?: boolean;
  validationMessage?: string;
  form?: {
    key: string;
    context?: string;
    action: string;
    method: string;
    search: boolean;
    submitLabels: string[];
    sensitive: boolean;
    valid: boolean;
    noValidate: boolean;
  };
  skipsValidation?: boolean;
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
export type DiscoveryAction = (
  | { kind: "click"; index: number }
  | {
      kind: "drag";
      index: number;
      targetIndex: number;
      from?: { x: number; y: number };
      to?: { x: number; y: number };
    }
  | { kind: "fill" | "select"; index: number; value: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | {
      kind: "press";
      index: number;
      key:
        | "Enter"
        | "Escape"
        | "Tab"
        | "ArrowDown"
        | "ArrowUp"
        | "ArrowLeft"
        | "ArrowRight"
        | "Space";
    }
  | { kind: "back" }
  | { kind: "finish"; reason: string }
) & { effect?: "read" | "write" | "unknown" };
export type DiscoveryCheck =
  "entry" | "fields" | "validation" | "cancel" | "save";
export interface DiscoveryCoverage {
  module: string;
  flow: "create" | "edit";
  checks: DiscoveryCheck[];
  evidenceIds: string[];
  detail: string;
  limitation: string;
}
export interface DiscoveryRun {
  id: string;
  projectId: string;
  releaseId: string;
  url: string;
  goal: string;
  budget: number;
  roundStart?: number;
  continuedFrom?: string;
  previousReportId?: string;
  state: "running" | "paused" | "draft";
  message: string;
  createdAt: string;
  captureIds: string[];
  coverage?: DiscoveryCoverage[];
  finishCorrections?: number;
  steps: {
    captureId: string;
    observation: string;
    action?: DiscoveryAction;
    result: string;
    businessActionKey?: string;
    module?: string;
    flow?: "create" | "edit" | "browse";
    executed?: boolean;
    submitted?: boolean;
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
  continueExploration(
    id: string,
    runId: string,
    budget: number,
  ): Promise<DiscoveryRun>;
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
