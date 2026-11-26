export interface Capture {
  html?: string;
  htmlPath?: string;
  captureNotes?: string[];
  manualScreenshot?: boolean;
  memoryEligible?: boolean;
  id: string;
  title: string;
  url: string;
  capturedAt: string;
  relativePath: string;
  screenshotPath: string;
  text: string;
  structure: string;
  actions: string[];
}
export interface PrototypeVersion {
  id: string;
  createdAt: string;
  contentHash: string;
  baselineId: string | null;
  sourceRefs: string[];
  approved: boolean;
}
export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GenerationProgress {
  runId?: string;
  projectId: string;
  state: "running" | "succeeded" | "failed" | "cancelled";
  characters: number;
  message: string;
}

export interface PageMemory {
  id: string;
  title: string;
  url: string;
  capturedAt: string;
  text: string;
  sourceRef: string;
  status: "observed" | "confirmed";
  conflictsWith: {
    id: string;
    title: string;
    text: string;
    capturedAt: string;
  }[];
}

export interface ElementSelection {
  id: string;
  tag: string;
  text: string;
  page: string;
}
export interface PrototypeComparison {
  before: string;
  after: string;
  identical: boolean;
  beforeHash: string;
  afterHash: string;
}

export interface PrototypeTask {
  id: string;
  state: string;
  createdAt: string;
  outputId: string | null;
  recoverable: boolean;
}

export interface PreviewState {
  scroll: { x: number; y: number };
  elements: {
    id: string;
    tag: string;
    type: string;
    value?: string;
    checked?: boolean;
    open?: boolean;
    scrollTop: number;
    scrollLeft: number;
  }[];
}
export interface ElementPrompt {
  elementId: string;
  prompt: string;
}
export interface ElementPromptBatch {
  baselineId: string;
  contentHash: string;
  items: ElementPrompt[];
}
export interface PrototypeEdit {
  understanding?: { id: string; digest: string; draft?: boolean };
  batch?: ElementPromptBatch;
  elementId?: string;
  state?: PreviewState;
}
export interface PrototypeDetails {
  page?: { taskId: string; title: string; module: string };
  understanding?: { id: string; digest: string; draft?: boolean };
  coverage?: {
    captureId: string;
    title: string;
    url: string;
    capturedAt: string;
    scope: string;
  }[];
  request: string;
  batch?: ElementPromptBatch;
  elementId?: string;
  state?: PreviewState;
  changes: {
    added: { id: string; label: string }[];
    removed: { id: string; label: string }[];
    changed: { id: string; label: string }[];
    sourceChanged: boolean;
  };
}
export interface RestoreResult {
  restored: number;
  skipped: number;
}

export const prototypeCheckNames = {
  filter: "筛选与重置",
  dialog: "打开与关闭弹窗",
  validation: "必填与格式校验",
  cancel: "取消不提交",
  success: "模拟提交成功",
  empty: "无结果空态",
} as const;
export type PrototypeCheckKey = keyof typeof prototypeCheckNames;
export interface PrototypeCheck {
  key: PrototypeCheckKey;
  result: "passed" | "failed";
  note: string;
  checkedAt: string;
  contentHash: string;
}
