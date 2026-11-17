import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { openProjectDatabase } from "../projects/storage.js";
import { ProjectRepository } from "../projects/repository.js";
import { registerProjectIpc } from "./projects-ipc.js";
import { MacKeychain } from "../integrations/credentials.js";
import { ModelService } from "../agent/model-service.js";
import { registerModelIpc } from "./models-ipc.js";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    title: "Produck",
    backgroundColor: "#f6f4ec",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  void window.loadFile(join(here, "../ui/index.html"));
  window.on("closed", () => {
    window = null;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    const database = openProjectDatabase(
      join(app.getPath("userData"), "projects.sqlite"),
    );
    const repository = new ProjectRepository(
      database,
      join(app.getPath("userData"), "workspace-state.json"),
    );
    registerProjectIpc(repository, () => window);
    const credentials = new MacKeychain(
      join(here, "../native/produck-keychain"),
    );
    const stopModels = registerModelIpc(
      new ModelService(database, credentials),
      () => window,
    );
    app.on("before-quit", stopModels);
    app.on("will-quit", () => database.close());
    app.on("second-instance", () => {
      window?.show();
      window?.focus();
    });
    ipcMain.handle("app:info", (event) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Untrusted caller");
      return {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
      };
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
