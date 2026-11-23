export type Platform = "feishu" | "yunxiao";
export interface PlatformConfig {
  provider: Platform;
  url: string;
  appId?: string;
  authType?: "ak" | "pat";
  organizationId?: string;
  projectId?: string;
  statusMapping?: { published?: string; merged?: string };
}
export interface PlatformProfile extends PlatformConfig {
  hasCredential: boolean;
}
export interface PlatformInput extends PlatformConfig {
  secret?: string;
  accessKeyId?: string;
}
export interface ConnectionTest {
  checkedAt: string;
  targetId: string;
  title: string;
  scope: "read-only";
}
