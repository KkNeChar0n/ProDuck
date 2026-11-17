import type { SourceDocument } from "./sources.js";
import type { ModelInput, ModelProfile, ModelDelta } from "./models.js";
import type { WorkspaceState, ProjectConnection } from "./projects.js";
export interface DesktopInfo {
  name: string;
  version: string;
  platform: string;
}
export interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>;
  models: {
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
    reveal(id: string): Promise<void>;
  };
}
