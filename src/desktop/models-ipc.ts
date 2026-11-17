import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { ModelService } from "../agent/model-service.js";
import { streamModel, testModel } from "../agent/model-client.js";
import type { ModelInput } from "../contracts/models.js";
export function registerModelIpc(
  service: ModelService,
  getWindow: () => BrowserWindow | null,
) {
  const active = new Map<
    string,
    { controller: AbortController; requestId: string }
  >();
  function trusted(event: IpcMainInvokeEvent) {
    const win = getWindow();
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted caller");
  }
  ipcMain.handle("models:capabilities", (e, id: string) => {
    trusted(e);
    return service.capabilities(id);
  });
  ipcMain.handle("models:probe", (e, id: string) => {
    trusted(e);
    return service.probe(id);
  });
  ipcMain.handle("models:profile", (e, id: string) => {
    trusted(e);
    return service.profile(id);
  });
  ipcMain.handle("models:save", (e, id: string, input: ModelInput) => {
    trusted(e);
    if (active.has(id)) throw new Error("请先取消当前生成");
    return service.save(id, input);
  });
  ipcMain.handle("models:test", async (e, id: string) => {
    trusted(e);
    await testModel(await service.request(id, "Reply with OK."));
  });
  ipcMain.handle(
    "models:stream",
    async (e, id: string, requestId: string, prompt: string) => {
      trusted(e);
      if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId))
        throw new Error("请求标识无效");
      if (active.has(id)) throw new Error("当前项目已有生成任务");
      const controller = new AbortController();
      active.set(id, { controller, requestId });
      try {
        const input = await service.request(id, prompt, controller.signal);
        for await (const text of streamModel(input)) {
          if (e.sender.isDestroyed()) {
            controller.abort();
            break;
          }
          e.sender.send("models:delta", { projectId: id, requestId, text });
        }
      } finally {
        active.delete(id);
      }
    },
  );
  ipcMain.handle("models:cancel", (e, id: string) => {
    trusted(e);
    active.get(id)?.controller.abort();
  });
  return () => {
    for (const run of active.values()) run.controller.abort();
  };
}
