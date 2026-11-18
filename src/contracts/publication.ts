export interface PublicationReview {
  id: string;
  draftId: string;
  versionId: string;
  createdAt: string;
  digest: string;
  parent: { url: string; appId: string; targetId: string; title: string };
  files: { path: string; label: string; hash: string; bytes: number }[];
  status: "prepared" | "approved";
  approvedAt?: string;
}

export interface PublicationRun {
  id: string;
  reviewId: string;
  draftId: string;
  digest: string;
  title: string;
  parentUrl: string;
  state: "running" | "partial" | "needs-check" | "published";
  createdAt: string;
  updatedAt: string;
  documentUrl?: string;
  message?: string;
  steps: {
    key: string;
    requestId: string;
    state: "pending" | "done" | "uncertain";
    result?: unknown;
  }[];
}
