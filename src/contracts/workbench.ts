export interface Capture {
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
