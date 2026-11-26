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
  html?: string;
  captureNotes?: string[];
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
  | { kind: "complete-module"; reason: string }
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
export interface DiscoveryModule {
  purpose?: string;
  representativeIds?: string[];
  captureNotes?: string[];
  name: string;
  state:
    | "pending"
    | "exploring"
    | "summarizing"
    | "summarized"
    | "partial"
    | "failed";
  markdown: string;
  evidenceIds: string[];
  signature?: string;
  updatedAt?: string;
  error?: string;
}
export interface DiscoveryFeature {
  module: string;
  name: string;
  goal: string;
  state: "pending" | "exploring" | "partial" | "verified" | "blocked";
  result: string;
  remaining: string;
  blocker: string;
  nextAction: string;
  requiresWrite: boolean;
  evidenceIds: string[];
  sourceIds: string[];
}
export interface PagePaintTask {
  baselineId?: string;
  id: string;
  key: string;
  captureId: string;
  title: string;
  module: string;
  state: "pending" | "running" | "done" | "failed";
  versionId?: string;
  error?: string;
  parts: {
    id: string;
    input: string;
    outputPath?: string;
    depth?: number;
    state: "pending" | "running" | "done" | "failed";
    error?: string;
  }[];
}
export interface DiscoveryRun {
  pageTasks?: PagePaintTask[];
  roundSteps?: number;
  phase?: "collecting" | "summarizing" | "generating" | "ready";
  prototypeVersionId?: string;
  prototypeError?: string;
  supplementPlan?: { id: string; module: string; description: string }[];
  supplements?: {
    needId: string;
    module: string;
    captureId: string;
    description: string;
  }[];
  mode?: "overview";
  features?: DiscoveryFeature[];
  stopReason?: string;
  retries?: { at: string; stage: string; attempt: number; error: string }[];
  modules?: DiscoveryModule[];
  activeModule?: string;
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
    featureKey?: string;
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
  submitSupplements(
    id: string,
    runId: string,
    items: {
      needId: string;
      description: string;
      image?: string;
      captureId?: string;
    }[],
  ): Promise<DiscoveryRun>;
  generateCandidate(
    id: string,
    runId: string,
    pageId?: string,
  ): Promise<DiscoveryRun>;
  supplement(
    id: string,
    runId: string,
    module: string,
    description: string,
  ): Promise<DiscoveryRun | null>;
  exportPage(id: string, captureId: string): Promise<void>;
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
