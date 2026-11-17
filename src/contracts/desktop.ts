export interface DesktopInfo {
  name: string;
  version: string;
  platform: string;
}
export interface DesktopBridge {
  getInfo(): Promise<DesktopInfo>;
}
