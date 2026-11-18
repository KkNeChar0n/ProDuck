import type {
  RemoteDocumentSnapshot,
  DocumentChangeReview,
  DocumentMergePlan,
} from "./document-review.js";
import type { PublicationReview, PublicationRun } from "./publication.js";
import type {
  Platform,
  PlatformInput,
  PlatformProfile,
  ConnectionTest,
} from "./platforms.js";
import type { ImportedSkill } from "./skills.js";
import type { AgentRun } from "./agent.js";
import type { DocumentDraft, PrototypeState } from "./documents.js";
import type { PageMemory } from "./workbench.js";
import type {
  PrototypeCheck,
  PrototypeCheckKey,
  PrototypeDetails,
  RestoreResult,
  PrototypeTask,
  ElementSelection,
  PrototypeComparison,
  Capture,
  PrototypeVersion,
  SurfaceBounds,
  GenerationProgress,
} from "./workbench.js";
import type { SourceDocument } from "./sources.js";
import type {
  ModelInput,
  ModelProfile,
  ModelDelta,
  CapabilityReport,
} from "./models.js";
import type { WorkspaceState, ProjectConnection } from "./projects.js";
export interface DesktopInfo {
  name: string;
  version: string;
  platform: string;
}
export interface DesktopBridge {
  documentReviews: {
    preflight(
      id: string,
      reviewId: string,
      digest: string,
    ): Promise<DocumentMergePlan>;
    fetch(id: string, runId: string): Promise<RemoteDocumentSnapshot>;
    prepare(
      id: string,
      snapshotId: string,
      sectionId: string,
      after: string,
    ): Promise<DocumentChangeReview>;
    approve(
      id: string,
      reviewId: string,
      digest: string,
    ): Promise<DocumentChangeReview>;
  };
  publication: {
    runs(id: string): Promise<PublicationRun[]>;
    publish(
      id: string,
      reviewId: string,
      digest: string,
      title: string,
    ): Promise<PublicationRun | null>;
    list(id: string): Promise<PublicationReview[]>;
    prepare(id: string, draftId: string): Promise<PublicationReview>;
    approve(
      id: string,
      reviewId: string,
      digest: string,
    ): Promise<PublicationReview>;
    reveal(id: string, reviewId: string): Promise<void>;
  };
  platforms: {
    profile(id: string, provider: Platform): Promise<PlatformProfile | null>;
    save(id: string, input: PlatformInput): Promise<PlatformProfile>;
    test(id: string, provider: Platform): Promise<ConnectionTest>;
  };
  skills: {
    list(id: string): Promise<ImportedSkill[]>;
    import(id: string): Promise<ImportedSkill | null>;
  };
  agent: {
    start(
      id: string,
      goal: string,
      budget: number,
      skillId?: string,
    ): Promise<AgentRun>;
    list(id: string): Promise<AgentRun[]>;
    cancel(id: string): Promise<void>;
    approve(
      id: string,
      runId: string,
      stepId: string,
      value: boolean,
    ): Promise<void>;
    resume(id: string, runId: string): Promise<AgentRun>;
    resolve(
      id: string,
      runId: string,
      stepId: string,
      note: string,
    ): Promise<AgentRun>;
    onEvent(callback: (run: AgentRun) => void): () => void;
  };
  getInfo(): Promise<DesktopInfo>;
  workbench: {
    checks(id: string, versionId: string): Promise<PrototypeCheck[]>;
    recordCheck(
      id: string,
      versionId: string,
      key: PrototypeCheckKey,
      result: "passed" | "failed",
      note: string,
    ): Promise<PrototypeCheck[]>;
    open(id: string, url: string): Promise<{ url: string; title: string }>;
    showBrowser(id: string, bounds: SurfaceBounds): Promise<void>;
    hide(): Promise<void>;
    capture(id: string): Promise<Capture>;
    captures(id: string): Promise<Capture[]>;
    revealCapture(id: string, captureId: string): Promise<void>;
    action(
      id: string,
      action: "click" | "fill",
      selector: string,
      value?: string,
    ): Promise<void>;
    tasks(id: string): Promise<PrototypeTask[]>;
    retry(id: string, runId: string): Promise<PrototypeVersion>;
    compare(
      id: string,
      before: string,
      after: string,
    ): Promise<PrototypeComparison>;
    selectionMode(id: string, enabled: boolean): Promise<void>;
    selection(id: string): Promise<ElementSelection | null>;
    versions(id: string): Promise<PrototypeVersion[]>;
    generate(
      id: string,
      captureId: string,
      change?: string,
      baselineId?: string,
      elementId?: string,
    ): Promise<PrototypeVersion>;
    cancel(id: string): Promise<void>;
    loadPrototype(id: string, versionId: string): Promise<RestoreResult | null>;
    details(id: string, versionId: string): Promise<PrototypeDetails | null>;
    showPrototype(id: string, bounds: SurfaceBounds): Promise<void>;
    approve(id: string, versionId: string): Promise<PrototypeVersion>;
    restore(id: string, versionId: string): Promise<PrototypeVersion>;
    onProgress(callback: (event: GenerationProgress) => void): () => void;
  };
  documents: {
    images(
      id: string,
      draftId: string,
    ): Promise<{ label: string; dataUrl: string }[]>;
    states(id: string): Promise<PrototypeState[]>;
    saveState(
      id: string,
      versionId: string,
      label: string,
    ): Promise<PrototypeState>;
    list(id: string): Promise<DocumentDraft[]>;
    generate(
      id: string,
      versionId: string,
      stateIds: string[],
      goal: string,
    ): Promise<DocumentDraft>;
    export(id: string, draftId: string): Promise<boolean>;
    cancel(id: string): Promise<void>;
  };
  models: {
    capabilities(id: string): Promise<CapabilityReport | null>;
    probe(id: string): Promise<CapabilityReport>;
    profile(projectId: string): Promise<ModelProfile | null>;
    save(projectId: string, input: ModelInput): Promise<ModelProfile>;
    test(projectId: string): Promise<void>;
    stream(projectId: string, requestId: string, prompt: string): Promise<void>;
    cancel(projectId: string): Promise<void>;
    onDelta(callback: (delta: ModelDelta) => void): () => void;
  };
  projects: {
    sources(id: string): Promise<SourceDocument[]>;
    importSource(id: string): Promise<SourceDocument | null>;
    state(): Promise<WorkspaceState>;
    create(name: string): Promise<WorkspaceState | null>;
    select(id: string): Promise<WorkspaceState>;
    connections(id: string): Promise<ProjectConnection[]>;
    saveConnection(
      id: string,
      input: ProjectConnection,
    ): Promise<ProjectConnection[]>;
    memory(id: string): Promise<string>;
    pageMemory(id: string, query: string): Promise<PageMemory[]>;
    confirmMemory(id: string, captureId: string): Promise<PageMemory[]>;
    reveal(id: string): Promise<void>;
  };
}
