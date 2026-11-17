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
