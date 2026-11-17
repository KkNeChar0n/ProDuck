import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "produck",
  Object.freeze({
    getInfo: () => ipcRenderer.invoke("app:info"),
    models: {
      profile: (id: string) => ipcRenderer.invoke("models:profile", id),
      save: (id: string, input: unknown) =>
        ipcRenderer.invoke("models:save", id, input),
      test: (id: string) => ipcRenderer.invoke("models:test", id),
      stream: (id: string, requestId: string, prompt: string) =>
        ipcRenderer.invoke("models:stream", id, requestId, prompt),
      cancel: (id: string) => ipcRenderer.invoke("models:cancel", id),
      onDelta: (callback: (data: unknown) => void) => {
        const listener = (_event: unknown, data: unknown) => callback(data);
        ipcRenderer.on("models:delta", listener);
        return () => ipcRenderer.removeListener("models:delta", listener);
      },
    },
    projects: {
      sources: (id: string) => ipcRenderer.invoke("projects:sources", id),
      importSource: (id: string) =>
        ipcRenderer.invoke("projects:import-source", id),
      state: () => ipcRenderer.invoke("projects:state"),
      create: (name: string) => ipcRenderer.invoke("projects:create", name),
      select: (id: string) => ipcRenderer.invoke("projects:select", id),
      connections: (id: string) =>
        ipcRenderer.invoke("projects:connections", id),
      saveConnection: (id: string, input: unknown) =>
        ipcRenderer.invoke("projects:save-connection", id, input),
      memory: (id: string) => ipcRenderer.invoke("projects:memory", id),
      reveal: (id: string) => ipcRenderer.invoke("projects:reveal", id),
    },
  }),
);
