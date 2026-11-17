import type { DesktopBridge } from "../contracts/desktop";
declare global {
  interface Window {
    produck?: DesktopBridge;
  }
}
export function desktop(): DesktopBridge {
  if (!window.produck) throw new Error("请在 Produck 桌面应用中打开工作台");
  return window.produck;
}
export function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : "操作未完成，请重试";
}
