import { deliveryTools } from "../agent/delivery-tools.js";
import { productTools } from "../agent/product-tools.js";
import { YunxiaoClient } from "../integrations/yunxiao.js";
import { YunxiaoSyncWorkflow } from "../workflows/yunxiao-sync.js";
import { DocumentReviews } from "../workflows/document-review.js";
import { PublicationWorkflow } from "../workflows/publication.js";
import { FeishuClient } from "../integrations/feishu.js";
import { PublicationReviews } from "../workflows/publication-review.js";
import type { PlatformService } from "../integrations/platform-service.js";
import { SkillRepository } from "../skills/repository.js";
import { registerSkillsIpc } from "./skills-ipc.js";
import type { PrototypeCheckKey } from "../contracts/workbench.js";
import { ToolRegistry } from "../agent/tools.js";
import { AgentRunner } from "../agent/runner.js";
import { createPlanner } from "./agent-planner.js";
import { registerAgentIpc } from "./agent-ipc.js";
import { DocumentWorkflow } from "../workflows/documents.js";
import { atomicWrite } from "../projects/storage.js";
import {
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import type { DatabaseSync } from "node:sqlite";
import type { ProjectRepository } from "../projects/repository.js";
import { projectPath } from "../projects/storage.js";
import { captures, saveCapture, getCapture } from "../projects/captures.js";
import { BrowserSurface, PrototypeSurface } from "./browser-surface.js";
import { PrototypeRepository } from "../prototypes/repository.js";
import { PrototypeGenerator } from "../agent/prototype-generator.js";
import type { ModelService } from "../agent/model-service.js";
import type {
  SurfaceBounds,
  GenerationProgress,
} from "../contracts/workbench.js";
export function registerWorkbenchIpc(
  db: DatabaseSync,
  projects: ProjectRepository,
  models: ModelService,
  getWindow: () => BrowserWindow | null,
  platforms?: PlatformService,
) {
  const browser = new BrowserSurface(getWindow),
    preview = new PrototypeSurface(getWindow),
    versions = new PrototypeRepository(db, projects),
    generator = new PrototypeGenerator(db, projects, models, versions);
  const documents = new DocumentWorkflow(projects, versions, models);
  const tools = new ToolRegistry(
    projects,
    versions,
    {
      context: (id) => browser.context(projects.shared(id).id),
      open: (id, url) => browser.open(projects.shared(id).id, url),
      action: (id, action, selector, value) =>
        browser.action(projects.shared(id).id, action, selector, value),
      capture: async (id) => {
        const { png, ...value } = await browser.capture(projects.shared(id).id);
        return saveCapture(projects.shared(id).workspace, value, png);
      },
    },
    productTools(versions, generator, documents),
  );
  const skills = new SkillRepository(projects);
  registerSkillsIpc(skills, getWindow, projects);
  const agent = new AgentRunner(
    db,
    projects,
    tools,
    createPlanner(models),
    (run) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send("agent:event", run);
    },
    skills,
  );
  registerAgentIpc(agent, getWindow);
  if (platforms) {
    const reviews = new PublicationReviews(
      projects,
      versions,
      documents,
      platforms,
    );
    const publisher = new PublicationWorkflow(
      projects,
      reviews,
      async (id) => new FeishuClient((await platforms.feishuSession(id)).token),
    );
    const sync = new YunxiaoSyncWorkflow(
      projects,
      publisher,
      platforms,
      async (id) => {
        const { config, token } = await platforms.yunxiaoSession(id);
        return new YunxiaoClient(
          config.organizationId!,
          config.projectId!,
          token,
        );
      },
    );
    ipcMain.handle("yunxiao-sync:list", (e, id: string) => {
      trusted(e, id);
      return sync.list(id);
    });
    ipcMain.handle(
      "yunxiao-sync:prepare",
      (e, id: string, publicationId: string, itemId: string) => {
        trusted(e, id);
        return sync.prepare(id, publicationId, itemId);
      },
    );
    ipcMain.handle(
      "yunxiao-sync:execute",
      async (e, id: string, syncId: string, digest: string) => {
        trusted(e, id);
        const row = sync.review(id, syncId, digest);
        if (!row.writeAttempted && row.state !== "synced") {
          const choice = await dialog.showMessageBox(getWindow()!, {
            type: "question",
            buttons: ["取消", "确认同步云效"],
            defaultId: 0,
            cancelId: 0,
            message: "更新这个云效工作项的状态？",
            detail: `项目：${row.projectId}\n工作项：${row.item.title}（${row.item.id}）\n${row.item.status.name} → ${row.target.name}\n仅更新状态，飞书发布成果独立保留。`,
          });
          if (choice.response !== 1) return null;
        }
        return sync.execute(id, syncId, digest);
      },
    );
    const changes = new DocumentReviews(
      projects,
      publisher,
      platforms,
      async (id) => new FeishuClient((await platforms.feishuSession(id)).token),
    );
    tools.register(deliveryTools(reviews, publisher, changes, sync));
    ipcMain.handle("document-reviews:saved", (e, id: string, runId: string) => {
      trusted(e, id);
      const snapshots = changes.snapshots(id).filter((s) => s.runId === runId);
      const review = changes
        .reviews(id)
        .find((r) => snapshots.some((s) => s.id === r.snapshotId));
      return {
        snapshot:
          snapshots.find((s) => s.id === review?.snapshotId) ??
          snapshots[0] ??
          null,
        review: review ?? null,
      };
    });
    ipcMain.handle(
      "document-reviews:preflight",
      (e, id: string, reviewId: string, digest: string) => {
        trusted(e, id);
        return changes.preflight(id, reviewId, digest);
      },
    );
    ipcMain.handle("document-reviews:fetch", (e, id: string, runId: string) => {
      trusted(e, id);
      return changes.fetch(id, runId);
    });
    ipcMain.handle(
      "document-reviews:prepare",
      (e, id: string, snapshotId: string, sectionId: string, after: string) => {
        trusted(e, id);
        return changes.prepare(id, snapshotId, sectionId, after);
      },
    );
    ipcMain.handle(
      "document-reviews:approve",
      (e, id: string, reviewId: string, digest: string) => {
        trusted(e, id);
        return changes.approve(id, reviewId, digest);
      },
    );
    ipcMain.handle("publication:runs", (e, id: string) => {
      trusted(e, id);
      return publisher.list(id);
    });
    ipcMain.handle(
      "publication:publish",
      async (
        e,
        id: string,
        reviewId: string,
        digest: string,
        title: string,
      ) => {
        trusted(e, id);
        const review = reviews.verify(id, reviewId);
        if (review.status !== "approved" || review.digest !== digest)
          throw new Error("请先确认发布材料");
        const choice = await dialog.showMessageBox(getWindow()!, {
          type: "question",
          buttons: ["取消", "确认发布到飞书"],
          defaultId: 0,
          cancelId: 0,
          message: "发布这份已审阅的需求文档？",
          detail: `标题：${title}\n目标：${review.parent.title}\n${review.parent.url}\n将创建需求文档、上传截图并维护共用原型附件。恢复时只继续未完成步骤；不会同步云效。`,
        });
        if (choice.response !== 1) return null;
        return publisher.publish(id, reviewId, digest, title);
      },
    );
    ipcMain.handle("publication:list", (e, id: string) => {
      trusted(e, id);
      return reviews.list(id);
    });
    ipcMain.handle("publication:prepare", (e, id: string, draftId: string) => {
      trusted(e, id);
      return reviews.prepare(id, draftId);
    });
    ipcMain.handle(
      "publication:approve",
      (e, id: string, reviewId: string, digest: string) => {
        trusted(e, id);
        return reviews.approve(id, reviewId, digest);
      },
    );
    ipcMain.handle("publication:reveal", (e, id: string, reviewId: string) => {
      trusted(e, id);
      shell.showItemInFolder(reviews.directory(id, reviewId));
    });
  }
  let previewVersion: string | null = null;
  let previewProject: string | null = null;
  function trusted(e: IpcMainInvokeEvent, id?: string) {
    const win = getWindow();
    if (
      !win ||
      e.sender !== win.webContents ||
      e.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted caller");
    if (id) projects.context(id);
  }
  const notify = (e: IpcMainInvokeEvent) => (event: GenerationProgress) => {
    if (!e.sender.isDestroyed()) e.sender.send("prototypes:progress", event);
  };
  ipcMain.handle("browser:open", (e, id: string, url: string) => {
    trusted(e, id);
    return browser.open(projects.shared(id).id, url);
  });
  ipcMain.handle("browser:show", (e, id: string, bounds: SurfaceBounds) => {
    trusted(e, id);
    preview.hide();
    browser.show(projects.shared(id).id, bounds);
  });
  ipcMain.handle("surface:hide", (e) => {
    trusted(e);
    browser.hide();
    preview.hide();
  });
  ipcMain.handle("browser:capture", async (e, id: string) => {
    trusted(e, id);
    const { png, ...value } = await browser.capture(projects.shared(id).id);
    return saveCapture(projects.shared(id).workspace, value, png);
  });
  ipcMain.handle("browser:captures", (e, id: string) => {
    trusted(e, id);
    return captures(projects.shared(id).workspace);
  });
  ipcMain.handle("browser:reveal", (e, id: string, captureId: string) => {
    trusted(e, id);
    const project = projects.shared(id),
      capture = getCapture(project.workspace, captureId);
    shell.showItemInFolder(
      projectPath(project.workspace, capture.relativePath),
    );
  });
  ipcMain.handle(
    "browser:action",
    (
      e,
      id: string,
      action: "click" | "fill",
      selector: string,
      value?: string,
    ) => {
      trusted(e, id);
      if (!["click", "fill"].includes(action)) throw new Error("不支持的操作");
      return browser.action(projects.shared(id).id, action, selector, value);
    },
  );
  ipcMain.handle(
    "releases:copy-prototype",
    (e, target: string, source: string, artifactId: string) => {
      trusted(e, target);
      if (projects.shared(target).id !== projects.shared(source).id)
        throw new Error("只能从同项目复制原型");
      const original = versions.list(source).find((v) => v.id === artifactId);
      if (!original) throw new Error("原型不存在");
      return versions.create(
        target,
        versions.read(source, artifactId),
        original.sourceRefs,
        null,
        versions.details(source, artifactId) ?? undefined,
      );
    },
  );
  ipcMain.handle("prototypes:list", (e, id: string) => {
    trusted(e, id);
    return versions.list(id);
  });
  ipcMain.handle("prototypes:tasks", (e, id: string) => {
    trusted(e, id);
    return generator.tasks(id);
  });
  ipcMain.handle("prototypes:retry", (e, id: string, runId: string) => {
    trusted(e, id);
    return generator.retry(id, runId, notify(e));
  });
  ipcMain.handle(
    "prototypes:compare",
    (e, id: string, before: string, after: string) => {
      trusted(e, id);
      return versions.compare(id, before, after);
    },
  );
  ipcMain.handle(
    "prototypes:selection-mode",
    (e, id: string, enabled: boolean) => {
      trusted(e, id);
      if (previewProject !== id || typeof enabled !== "boolean")
        throw new Error("请先加载当前项目原型");
      return preview.selectionMode(enabled);
    },
  );
  ipcMain.handle("prototypes:selection", (e, id: string) => {
    trusted(e, id);
    return previewProject === id ? preview.selection() : null;
  });
  ipcMain.handle(
    "prototypes:generate",
    async (
      e,
      id: string,
      captureId: string,
      change?: string,
      baselineId?: string,
      elementId?: string,
    ) => {
      trusted(e, id);
      let edit;
      if (
        baselineId &&
        previewProject === id &&
        previewVersion === baselineId
      ) {
        const state = await preview.captureState();
        const selection = await preview.selection();
        if (elementId && selection?.id !== elementId)
          throw new Error("选中元素已变化，请重新选择");
        edit = { state, elementId };
      } else if (elementId) throw new Error("请先打开要修改的原型版本");
      return generator.generate(
        id,
        captureId,
        notify(e),
        change,
        baselineId,
        edit,
      );
    },
  );
  ipcMain.handle("prototypes:cancel", (e, id: string) => {
    trusted(e, id);
    generator.cancel(id);
  });
  ipcMain.handle("prototypes:details", (e, id: string, versionId: string) => {
    trusted(e, id);
    return versions.details(id, versionId);
  });
  ipcMain.handle(
    "prototypes:load",
    async (e, id: string, versionId: string) => {
      trusted(e, id);
      browser.hide();
      previewProject = id;
      previewVersion = versionId;
      await preview.load(versions.read(id, versionId));
      const saved = versions.details(id, versionId)?.state;
      return saved ? preview.restoreState(saved) : null;
    },
  );
  ipcMain.handle("prototypes:show", (e, id: string, bounds: SurfaceBounds) => {
    trusted(e, id);
    if (previewProject !== id) throw new Error("请先加载当前项目的原型");
    browser.hide();
    preview.show(bounds);
  });
  ipcMain.handle("prototypes:checks", (e, id: string, versionId: string) => {
    trusted(e, id);
    return versions.checks(id, versionId);
  });
  ipcMain.handle(
    "prototypes:record-check",
    (
      e,
      id: string,
      versionId: string,
      key: PrototypeCheckKey,
      result: "passed" | "failed",
      note: string,
    ) => {
      trusted(e, id);
      return versions.recordCheck(id, versionId, key, result, note);
    },
  );
  ipcMain.handle("prototypes:approve", (e, id: string, versionId: string) => {
    trusted(e, id);
    return versions.approve(id, versionId);
  });
  ipcMain.handle("prototypes:restore", (e, id: string, versionId: string) => {
    trusted(e, id);
    return versions.restore(id, versionId);
  });
  ipcMain.handle("documents:images", (e, id: string, draftId: string) => {
    trusted(e, id);
    return documents.images(id, draftId);
  });
  ipcMain.handle("documents:states", (e, id: string) => {
    trusted(e, id);
    return documents.states(id);
  });
  ipcMain.handle("documents:list", (e, id: string) => {
    trusted(e, id);
    return documents.list(id);
  });
  ipcMain.handle(
    "documents:save-state",
    async (e, id: string, versionId: string, label: string) => {
      trusted(e, id);
      documents.approved(id, versionId);
      if (previewProject !== id || previewVersion !== versionId)
        throw new Error("请在原型页打开该批准版本");
      const { text, png } = await preview.snapshot();
      if (previewProject !== id || previewVersion !== versionId)
        throw new Error("截图期间切换了版本，请重试");
      return documents.saveState(id, versionId, label, text, png);
    },
  );
  ipcMain.handle(
    "documents:generate",
    (e, id: string, versionId: string, stateIds: string[], goal: string) => {
      trusted(e, id);
      return documents.generate(id, versionId, stateIds, goal);
    },
  );
  ipcMain.handle("documents:cancel", (e, id: string) => {
    trusted(e, id);
    documents.cancel(id);
  });
  ipcMain.handle("documents:export", async (e, id: string, draftId: string) => {
    trusted(e, id);
    const html = documents.exportHtml(id, draftId),
      win = getWindow();
    if (!win) return false;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: "Produck-PRD.html",
      filters: [{ name: "HTML 文档（含截图）", extensions: ["html"] }],
    });
    if (result.canceled || !result.filePath) return false;
    atomicWrite(result.filePath, html);
    return true;
  });
  return () => {
    agent.close();
    documents.close();
    generator.close();
    browser.close();
    preview.close();
  };
}
