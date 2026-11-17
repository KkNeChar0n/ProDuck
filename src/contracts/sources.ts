export interface SourceDocument {
  id: string;
  name: string;
  relativePath: string;
  sha256: string;
  importedAt: string;
  bytes: number;
}
