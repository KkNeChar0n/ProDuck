import { PythonRunner } from "../skills/python-runner.js";
import { fileURLToPath } from "node:url";
import type { ProjectRepository } from "../projects/repository.js";
import { projectPath } from "../projects/storage.js";
import { shell } from "electron";
import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import type { SkillRepository } from "../skills/repository.js";
export function registerSkillsIpc(
  skills: SkillRepository,
  getWindow: () => BrowserWindow | null,
  projects: ProjectRepository,
) {
  const python = new PythonRunner(
    projects,
    skills,
    fileURLToPath(new URL("../python", import.meta.url)),
  );
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
  app.on("before-quit", () => python.close());
  ipcMain.handle("skills:python-cancel", (e, id: string) => {
    trusted(e);
    projects.context(id);
    python.cancel(id);
  });
  ipcMain.handle(
    "skills:python-run",
    async (
      e,
      id: string,
      skillId: string,
      fingerprint: string,
      input: string,
    ) => {
      const win = trusted(e),
        { record, manifest } = skills.pythonSnapshot(id, skillId, fingerprint);
      if (typeof input !== "string" || Buffer.byteLength(input) > 16000)
        throw new Error("脚本输入过大");
      JSON.parse(input);
      const choice = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["取消", "授权并运行 Python"],
        defaultId: 0,
        cancelId: 0,
        message: `运行 ${record.name}？`,
        detail: `入口：${manifest.entry}\n版本：${fingerprint.slice(0, 16)}\n读取：技能包和 Python 标准库（系统路径元信息可读）\n写入：独立结果目录\n网络与子进程：禁止\n时限：20 秒；结果总量：16 MB\n本次输入：${input.slice(0, 2000)}`,
      });
      if (choice.response !== 1) return null;
      return python.run(id, skillId, fingerprint, input);
    },
  );
  ipcMain.handle("skills:python-reveal", (e, id: string, runId: string) => {
    trusted(e);
    if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("运行记录无效");
    shell.showItemInFolder(
      projectPath(
        projects.context(id).workspace,
        `workflows/python-${runId}/result.json`,
      ),
    );
  });
  ipcMain.handle("skills:list", (e, id: string) => {
    trusted(e);
    return skills.available(id);
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
