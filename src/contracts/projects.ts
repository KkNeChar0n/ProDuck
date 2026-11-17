export interface Project {
  id: string;
  name: string;
  workspace: string;
  createdAt: string;
}
export interface ProjectConnection {
  provider: "feishu" | "yunxiao";
  url: string;
}
export interface WorkspaceState {
  projects: Project[];
  activeProjectId: string | null;
}
