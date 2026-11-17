import { searchPageMemory, confirmPageMemory } from "../projects/captures.js";
import { listSources, importSource } from "../projects/sources.js";
import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import type { ProjectRepository } from "../projects/repository.js";
import type { ProjectConnection } from "../contracts/projects.js";
export function registerProjectIpc(
  repository: ProjectRepository,
  getWindow: () => BrowserWindow | null,
) {
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Untrusted caller");
      return fn(...args);
    });
  handle("projects:sources", (id: string) =>
    listSources(repository.get(id).workspace),
  );
  handle("projects:import-source", async (id: string) => {
    const project = repository.get(id);
    const picked = await dialog.showOpenDialog(getWindow()!, {
      title: "导入交接资料",
      properties: ["openFile"],
      filters: [{ name: "交接文档", extensions: ["md", "txt", "html", "htm"] }],
    });
    if (picked.canceled) return null;
    return importSource(project.workspace, picked.filePaths[0]);
  });
  handle("projects:state", () => repository.state());
  handle("projects:select", (id: string) => repository.select(id));
  handle("projects:create", async (name: string) => {
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new Error("请输入有效的项目名称");
    const window = getWindow()!;
    const selection = await dialog.showOpenDialog(window, {
      title: "选择项目工作空间的父文件夹",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "在此创建独立工作空间",
    });
    if (selection.canceled) return null;
    const project = repository.create(name, selection.filePaths[0]);
    repository.select(project.id);
    return repository.state();
  });
  handle("projects:connections", (id: string) => repository.connections(id));
  handle(
    "projects:save-connection",
    (id: string, connection: ProjectConnection) =>
      repository.saveConnection(id, connection),
  );
  handle("projects:confirm-memory", (id: string, captureId: string) =>
    confirmPageMemory(repository.get(id).workspace, captureId),
  );
  handle("projects:page-memory", (id: string, query: string) =>
    searchPageMemory(repository.get(id).workspace, query),
  );
  handle("projects:memory", (id: string) => repository.readMemory(id));
  handle("projects:reveal", (id: string) => {
    shell.showItemInFolder(repository.get(id).workspace);
  });
}
