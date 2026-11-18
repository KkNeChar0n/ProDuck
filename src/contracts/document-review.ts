export interface RemoteSection {
  id: string;
  title: string;
  text: string;
  editable: boolean;
  blockIds: string[];
  spans: { blockId: string; start: number; end: number }[];
  fingerprint: string;
}
export interface RemoteDocumentSnapshot {
  id: string;
  runId: string;
  documentId: string;
  nodeToken: string;
  title: string;
  url: string;
  fetchedAt: string;
  sections: RemoteSection[];
}
export interface DocumentChangeReview {
  id: string;
  snapshotId: string;
  sectionId: string;
  title: string;
  before: string;
  after: string;
  fingerprint: string;
  digest: string;
  createdAt: string;
  state: "pending" | "approved" | "conflict";
  diff: { kind: "same" | "removed" | "added"; text: string }[];
  approvedAt?: string;
}

export interface DocumentMergePlan {
  id: string;
  reviewId: string;
  digest: string;
  documentId: string;
  checkedAt: string;
  revision: number;
  edits: { blockId: string; before: string; after: string }[];
  writeEnabled: false;
}
