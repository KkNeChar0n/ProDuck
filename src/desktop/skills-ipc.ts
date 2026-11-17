import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import type { SkillRepository } from "../skills/repository.js";
export function registerSkillsIpc(
  skills: SkillRepository,
  getWindow: () => BrowserWindow | null,
) {
  const trusted = (e: IpcMainInvokeEvent) => {
    const win = getWindow();
    if (
      !win ||
      e.sender !== win.webContents ||
      e.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted caller");
    return win;
  };
  ipcMain.handle("skills:list", (e, id: string) => {
    trusted(e);
    return skills.list(id);
  });
  ipcMain.handle("skills:import", async (e, id: string) => {
    const win = trusted(e);
    const result = await dialog.showOpenDialog(win, {
      title: "导入 Skill 文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return skills.import(id, result.filePaths[0]);
  });
}
