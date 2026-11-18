export interface WorkitemState {
  id: string;
  name: string;
}
export interface Workitem {
  id: string;
  title: string;
  projectId: string;
  typeId: string;
  status: WorkitemState;
  updatedAt: string;
}
export interface YunxiaoSync {
  id: string;
  publicationId: string;
  publicationDigest: string;
  organizationId: string;
  projectId: string;
  configHash: string;
  item: Workitem;
  target: WorkitemState;
  digest: string;
  state: "prepared" | "writing" | "needs-check" | "synced" | "conflict";
  createdAt: string;
  updatedAt: string;
  writeAttempted: boolean;
  readback?: Workitem;
  message?: string;
  events: { at: string; stage: string }[];
}
