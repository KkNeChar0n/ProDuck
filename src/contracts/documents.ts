export interface PrototypeState {
  id: string;
  versionId: string;
  contentHash: string;
  label: string;
  createdAt: string;
  screenshotPath: string;
  text: string;
}
export interface DocumentDraft {
  id: string;
  versionId: string;
  contentHash: string;
  stateIds: string[];
  createdAt: string;
  markdown: string;
}
