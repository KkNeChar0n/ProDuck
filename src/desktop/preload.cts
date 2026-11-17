import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "produck",
  Object.freeze({ getInfo: () => ipcRenderer.invoke("app:info") }),
);
