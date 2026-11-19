import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "produck",
  Object.freeze({
    yunxiaoSync: {
      list: (id: string) => ipcRenderer.invoke("yunxiao-sync:list", id),
      prepare: (id: string, publicationId: string, itemId: string) =>
        ipcRenderer.invoke("yunxiao-sync:prepare", id, publicationId, itemId),
      execute: (id: string, syncId: string, digest: string) =>
        ipcRenderer.invoke("yunxiao-sync:execute", id, syncId, digest),
    },
    documentReviews: {
      saved: (id: string, runId: string) =>
        ipcRenderer.invoke("document-reviews:saved", id, runId),
      preflight: (id: string, reviewId: string, digest: string) =>
        ipcRenderer.invoke("document-reviews:preflight", id, reviewId, digest),
      fetch: (id: string, runId: string) =>
        ipcRenderer.invoke("document-reviews:fetch", id, runId),
      prepare: (
        id: string,
        snapshotId: string,
        sectionId: string,
        after: string,
      ) =>
        ipcRenderer.invoke(
          "document-reviews:prepare",
          id,
          snapshotId,
          sectionId,
          after,
        ),
      approve: (id: string, reviewId: string, digest: string) =>
        ipcRenderer.invoke("document-reviews:approve", id, reviewId, digest),
    },
    publication: {
      runs: (id: string) => ipcRenderer.invoke("publication:runs", id),
      publish: (id: string, reviewId: string, digest: string, title: string) =>
        ipcRenderer.invoke("publication:publish", id, reviewId, digest, title),
      list: (id: string) => ipcRenderer.invoke("publication:list", id),
      prepare: (id: string, draftId: string) =>
        ipcRenderer.invoke("publication:prepare", id, draftId),
      approve: (id: string, reviewId: string, digest: string) =>
        ipcRenderer.invoke("publication:approve", id, reviewId, digest),
      reveal: (id: string, reviewId: string) =>
        ipcRenderer.invoke("publication:reveal", id, reviewId),
    },
    platforms: {
      profile: (id: string, provider: string) =>
        ipcRenderer.invoke("platforms:profile", id, provider),
      save: (id: string, input: unknown) =>
        ipcRenderer.invoke("platforms:save", id, input),
      test: (id: string, provider: string) =>
        ipcRenderer.invoke("platforms:test", id, provider),
    },
    skills: {
      cancelPython: (id: string) =>
        ipcRenderer.invoke("skills:python-cancel", id),
      runPython: (
        id: string,
        skillId: string,
        fingerprint: string,
        input: string,
      ) =>
        ipcRenderer.invoke(
          "skills:python-run",
          id,
          skillId,
          fingerprint,
          input,
        ),
      revealPython: (id: string, runId: string) =>
        ipcRenderer.invoke("skills:python-reveal", id, runId),
      list: (id: string) => ipcRenderer.invoke("skills:list", id),
      import: (id: string) => ipcRenderer.invoke("skills:import", id),
    },
    agent: {
      start: (id: string, goal: string, budget: number, skillId?: string) =>
        ipcRenderer.invoke("agent:start", id, goal, budget, skillId),
      list: (id: string) => ipcRenderer.invoke("agent:list", id),
      cancel: (id: string) => ipcRenderer.invoke("agent:cancel", id),
      approve: (id: string, runId: string, stepId: string, value: boolean) =>
        ipcRenderer.invoke("agent:approve", id, runId, stepId, value),
      resume: (id: string, runId: string) =>
        ipcRenderer.invoke("agent:resume", id, runId),
      resolve: (id: string, runId: string, stepId: string, note: string) =>
        ipcRenderer.invoke("agent:resolve", id, runId, stepId, note),
      onEvent: (callback: (data: unknown) => void) => {
        const listener = (_e: unknown, data: unknown) => callback(data);
        ipcRenderer.on("agent:event", listener);
        return () => ipcRenderer.removeListener("agent:event", listener);
      },
    },
    getInfo: () => ipcRenderer.invoke("app:info"),
    documents: {
      images: (id: string, draftId: string) =>
        ipcRenderer.invoke("documents:images", id, draftId),
      states: (id: string) => ipcRenderer.invoke("documents:states", id),
      saveState: (id: string, versionId: string, label: string) =>
        ipcRenderer.invoke("documents:save-state", id, versionId, label),
      list: (id: string) => ipcRenderer.invoke("documents:list", id),
      generate: (
        id: string,
        versionId: string,
        stateIds: string[],
        goal: string,
      ) =>
        ipcRenderer.invoke("documents:generate", id, versionId, stateIds, goal),
      export: (id: string, draftId: string) =>
        ipcRenderer.invoke("documents:export", id, draftId),
      cancel: (id: string) => ipcRenderer.invoke("documents:cancel", id),
    },
    models: {
      capabilities: (id: string) =>
        ipcRenderer.invoke("models:capabilities", id),
      probe: (id: string) => ipcRenderer.invoke("models:probe", id),
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
    workbench: {
      checks: (id: string, versionId: string) =>
        ipcRenderer.invoke("prototypes:checks", id, versionId),
      recordCheck: (
        id: string,
        versionId: string,
        key: string,
        result: string,
        note: string,
      ) =>
        ipcRenderer.invoke(
          "prototypes:record-check",
          id,
          versionId,
          key,
          result,
          note,
        ),
      open: (id: string, url: string) =>
        ipcRenderer.invoke("browser:open", id, url),
      showBrowser: (id: string, bounds: unknown) =>
        ipcRenderer.invoke("browser:show", id, bounds),
      hide: () => ipcRenderer.invoke("surface:hide"),
      capture: (id: string) => ipcRenderer.invoke("browser:capture", id),
      captures: (id: string) => ipcRenderer.invoke("browser:captures", id),
      revealCapture: (id: string, captureId: string) =>
        ipcRenderer.invoke("browser:reveal", id, captureId),
      action: (id: string, action: string, selector: string, value?: string) =>
        ipcRenderer.invoke("browser:action", id, action, selector, value),
      tasks: (id: string) => ipcRenderer.invoke("prototypes:tasks", id),
      retry: (id: string, runId: string) =>
        ipcRenderer.invoke("prototypes:retry", id, runId),
      compare: (id: string, before: string, after: string) =>
        ipcRenderer.invoke("prototypes:compare", id, before, after),
      selectionMode: (id: string, enabled: boolean) =>
        ipcRenderer.invoke("prototypes:selection-mode", id, enabled),
      selection: (id: string) => ipcRenderer.invoke("prototypes:selection", id),
      versions: (id: string) => ipcRenderer.invoke("prototypes:list", id),
      generate: (
        id: string,
        captureId: string,
        change?: string,
        baselineId?: string,
        elementId?: string,
      ) =>
        ipcRenderer.invoke(
          "prototypes:generate",
          id,
          captureId,
          change,
          baselineId,
          elementId,
        ),
      cancel: (id: string) => ipcRenderer.invoke("prototypes:cancel", id),
      details: (id: string, versionId: string) =>
        ipcRenderer.invoke("prototypes:details", id, versionId),
      loadPrototype: (id: string, versionId: string) =>
        ipcRenderer.invoke("prototypes:load", id, versionId),
      showPrototype: (id: string, bounds: unknown) =>
        ipcRenderer.invoke("prototypes:show", id, bounds),
      approve: (id: string, versionId: string) =>
        ipcRenderer.invoke("prototypes:approve", id, versionId),
      restore: (id: string, versionId: string) =>
        ipcRenderer.invoke("prototypes:restore", id, versionId),
      onProgress: (callback: (data: unknown) => void) => {
        const listener = (_e: unknown, data: unknown) => callback(data);
        ipcRenderer.on("prototypes:progress", listener);
        return () =>
          ipcRenderer.removeListener("prototypes:progress", listener);
      },
    },
    releases: {
      create: (id: string, name: string) =>
        ipcRenderer.invoke("releases:create", id, name),
      select: (id: string, releaseId: string) =>
        ipcRenderer.invoke("releases:select", id, releaseId),
      update: (id: string, name: string, url: string) =>
        ipcRenderer.invoke("releases:update", id, name, url),
      copyPrototype: (target: string, source: string, artifactId: string) =>
        ipcRenderer.invoke(
          "releases:copy-prototype",
          target,
          source,
          artifactId,
        ),
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
      confirmMemory: (id: string, captureId: string) =>
        ipcRenderer.invoke("projects:confirm-memory", id, captureId),
      pageMemory: (id: string, query: string) =>
        ipcRenderer.invoke("projects:page-memory", id, query),
      memory: (id: string) => ipcRenderer.invoke("projects:memory", id),
      reveal: (id: string) => ipcRenderer.invoke("projects:reveal", id),
    },
  }),
);
