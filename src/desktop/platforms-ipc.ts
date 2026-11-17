import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { PlatformService } from "../integrations/platform-service.js";
import type { Platform, PlatformInput } from "../contracts/platforms.js";
export function registerPlatformIpc(
  service: PlatformService,
  getWindow: () => BrowserWindow | null,
) {
  function trusted(e: IpcMainInvokeEvent) {
    const w = getWindow();
    if (
      !w ||
      e.sender !== w.webContents ||
      e.senderFrame !== w.webContents.mainFrame
    )
      throw new Error("Untrusted caller");
  }
  ipcMain.handle("platforms:profile", (e, id: string, provider: Platform) => {
    trusted(e);
    return service.profile(id, provider);
  });
  ipcMain.handle("platforms:save", (e, id: string, input: PlatformInput) => {
    trusted(e);
    return service.save(id, input);
  });
  ipcMain.handle("platforms:test", (e, id: string, provider: Platform) => {
    trusted(e);
    return service.test(id, provider);
  });
}
