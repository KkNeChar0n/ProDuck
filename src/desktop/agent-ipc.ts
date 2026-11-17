import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { AgentRunner } from "../agent/runner.js";
export function registerAgentIpc(
  runner: AgentRunner,
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
  ipcMain.handle(
    "agent:start",
    (e, id: string, goal: string, budget: number, skillId?: string) => {
      trusted(e);
      return runner.start(id, goal, budget, skillId);
    },
  );
  ipcMain.handle("agent:list", (e, id: string) => {
    trusted(e);
    return runner.list(id);
  });
  ipcMain.handle("agent:cancel", (e, id: string) => {
    trusted(e);
    runner.cancel(id);
  });
  ipcMain.handle(
    "agent:approve",
    (e, id: string, runId: string, stepId: string, value: boolean) => {
      trusted(e);
      runner.approve(id, runId, stepId, value);
    },
  );
  ipcMain.handle("agent:resume", (e, id: string, runId: string) => {
    trusted(e);
    return runner.resume(id, runId);
  });
  ipcMain.handle(
    "agent:resolve",
    (e, id: string, runId: string, stepId: string, note: string) => {
      trusted(e);
      return runner.resolveInterrupted(id, runId, stepId, note);
    },
  );
}
