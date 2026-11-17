import { useEffect, useRef, useState } from "react";
import type {
  ElementSelection,
  PrototypeComparison,
  Capture,
  PrototypeVersion,
  GenerationProgress,
} from "../../contracts/workbench";
import { desktop, errorText } from "../bridge";
import { ProjectSources } from "./ProjectSources";
export interface PrototypeContext {
  element?: ElementSelection | null;
  versionId: string;
  captureId: string;
}
export function Workbench({
  projectId,
  visible,
  onContext,
}: {
  projectId: string;
  visible: boolean;
  onContext: (value: PrototypeContext | null) => void;
}) {
  const [tab, setTab] = useState<"browser" | "prototype" | "sources">(
      "browser",
    ),
    [url, setUrl] = useState(""),
    [loaded, setLoaded] = useState(false),
    [pageTitle, setPageTitle] = useState(""),
    [captureList, setCaptureList] = useState<Capture[]>([]),
    [selectedCapture, setSelectedCapture] = useState(""),
    [versions, setVersions] = useState<PrototypeVersion[]>([]),
    [selected, setSelected] = useState(""),
    [previewReady, setPreviewReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [stateLabel, setStateLabel] = useState(""),
    [stateNotice, setStateNotice] = useState("");
  const [picking, setPicking] = useState(false),
    [element, setElement] = useState<ElementSelection | null>(null),
    [comparison, setComparison] = useState<PrototypeComparison | null>(null),
    [compareId, setCompareId] = useState("");
  useEffect(() => {
    setElement(null);
    setPicking(false);
    setComparison(null);
  }, [selected, tab]);
  useEffect(() => {
    if (!picking || !previewReady || !visible) return;
    let active = true;
    const timer = setInterval(() => {
      void desktop()
        .workbench.selection(projectId)
        .then((value) => {
          if (active) setElement(value);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    }, 300);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [picking, previewReady, visible, projectId]);
  const surface = useRef<HTMLDivElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all([
      desktop().workbench.captures(projectId),
      desktop().workbench.versions(projectId),
    ])
      .then(([c, v]) => {
        if (!alive.current) return;
        setCaptureList(c);
        setSelectedCapture(c.at(-1)?.id ?? "");
        setVersions(v);
        setSelected(v[0]?.id ?? "");
      })
      .catch((e) => setError(errorText(e)));
    const unsubscribe = desktop().workbench.onProgress((event) => {
      if (event.projectId !== projectId) return;
      setProgress(event);
      if (event.state === "succeeded")
        void desktop()
          .workbench.versions(projectId)
          .then((v) => {
            if (alive.current) {
              setVersions(v);
              setSelected(v[0]?.id ?? "");
              setTab("prototype");
            }
          });
    });
    return () => {
      alive.current = false;
      unsubscribe();
      void desktop().workbench.hide();
      onContext(null);
    };
  }, [projectId]);
  useEffect(() => {
    const version = versions.find((v) => v.id === selected);
    onContext(
      tab === "prototype" && version
        ? { versionId: version.id, captureId: version.sourceRefs[0], element }
        : null,
    );
  }, [tab, selected, versions, onContext, element]);
  useEffect(() => {
    setPreviewReady(false);
    if (tab !== "prototype" || !selected) return;
    let current = true;
    void desktop()
      .workbench.loadPrototype(projectId, selected)
      .then(() => {
        if (current) setPreviewReady(true);
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, [projectId, tab, selected]);
  useEffect(() => {
    const node = surface.current;
    if (
      !node ||
      !visible ||
      comparison !== null ||
      (tab === "browser" && !loaded) ||
      (tab === "prototype" && !previewReady) ||
      tab === "sources"
    ) {
      void desktop().workbench.hide();
      return;
    }
    const update = () => {
      const r = node.getBoundingClientRect(),
        clip = node.closest(".workspace-body")!.getBoundingClientRect();
      const x = Math.max(r.left, clip.left),
        y = Math.max(r.top, clip.top),
        width = Math.max(0, Math.min(r.right, clip.right) - x),
        height = Math.max(0, Math.min(r.bottom, clip.bottom) - y);
      if (!width || !height) {
        void desktop().workbench.hide();
        return;
      }
      const bounds = { x, y, width, height };
      void (
        tab === "browser"
          ? desktop().workbench.showBrowser(projectId, bounds)
          : desktop().workbench.showPrototype(projectId, bounds)
      ).catch((e) => setError(errorText(e)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      void desktop().workbench.hide();
    };
  }, [tab, loaded, previewReady, visible, projectId, comparison]);
  const current = versions.find((v) => v.id === selected),
    generating = progress?.state === "running";
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="tabs" role="tablist">
        {[
          ["browser", "浏览器"],
          ["prototype", "原型"],
          ["sources", "交接资料"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "sources" ? (
        <ProjectSources projectId={projectId} />
      ) : (
        <>
          {tab === "browser" ? (
            <>
              <form
                className="url-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    const page = await desktop().workbench.open(projectId, url);
                    setPageTitle(page.title);
                    setUrl(page.url);
                    setLoaded(true);
                  });
                }}
              >
                <input
                  aria-label="页面地址"
                  placeholder="https://你的产品地址"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <button disabled={busy}>打开网页</button>
              </form>
              <div className="canvas-tools">
                <span>{loaded ? pageTitle : "可在这里登录并体验真实页面"}</span>
                <button
                  disabled={!loaded || busy}
                  onClick={() =>
                    void perform(async () => {
                      const capture =
                        await desktop().workbench.capture(projectId);
                      setCaptureList((v) => [...v, capture]);
                      setSelectedCapture(capture.id);
                    })
                  }
                >
                  采集当前状态
                </button>
              </div>
            </>
          ) : (
            <div className="canvas-tools">
              <select
                aria-label="原型版本"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!versions.length}
              >
                {!versions.length && <option value="">尚无原型</option>}
                {versions.map((v, i) => (
                  <option key={v.id} value={v.id}>
                    版本 {versions.length - i}
                    {v.approved ? " · 已通过" : " · 候选"}
                  </option>
                ))}
              </select>
              <button
                disabled={!selected || busy}
                onClick={() =>
                  void perform(async () => {
                    const restored = await desktop().workbench.restore(
                      projectId,
                      selected,
                    );
                    setVersions(await desktop().workbench.versions(projectId));
                    setSelected(restored.id);
                  })
                }
              >
                从此版恢复
              </button>
              <button
                className="primary"
                disabled={!selected || busy || generating || current?.approved}
                onClick={() =>
                  void perform(async () => {
                    await desktop().workbench.approve(projectId, selected);
                    setVersions(await desktop().workbench.versions(projectId));
                  })
                }
              >
                {current?.approved ? "此版本已通过" : "通过此版本"}
              </button>
            </div>
          )}
          {tab === "prototype" && selected && (
            <div className="canvas-tools">
              <button
                disabled={!previewReady || busy}
                aria-pressed={picking}
                onClick={() =>
                  void perform(async () => {
                    await desktop().workbench.selectionMode(
                      projectId,
                      !picking,
                    );
                    setPicking(!picking);
                  })
                }
              >
                {picking ? "返回体验模式" : "选择元素"}
              </button>
              <span>
                {picking
                  ? element
                    ? `已选择：${element.tag} · ${element.id}`
                    : "点击带元素标识的区域；选择模式不触发按钮动作"
                  : "体验模式"}
              </span>
              <select
                aria-label="对比版本"
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
              >
                <option value="">选择对比版本</option>
                {versions
                  .filter((v) => v.id !== selected)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.createdAt} {v.approved ? "已通过" : "候选"}
                    </option>
                  ))}
              </select>
              <button
                disabled={!compareId || busy}
                onClick={() =>
                  void perform(async () => {
                    setComparison(
                      await desktop().workbench.compare(
                        projectId,
                        compareId,
                        selected,
                      ),
                    );
                  })
                }
              >
                对比源文件
              </button>
            </div>
          )}
          {tab === "prototype" && current?.approved && (
            <div className="canvas-tools">
              <input
                aria-label="页面状态名称"
                placeholder="页面状态，如：新增弹窗 / 筛选空态"
                value={stateLabel}
                onChange={(e) => setStateLabel(e.target.value)}
                maxLength={100}
              />
              <button
                disabled={
                  busy ||
                  !previewReady ||
                  !stateLabel.trim() ||
                  comparison !== null
                }
                onClick={() =>
                  void perform(async () => {
                    await desktop().documents.saveState(
                      projectId,
                      selected,
                      stateLabel,
                    );
                    setPicking(false);
                    setStateNotice(
                      `已保存「${stateLabel}」截图，可在文档中选择。`,
                    );
                    setStateLabel("");
                  })
                }
              >
                保存文档截图
              </button>
            </div>
          )}
          {tab === "prototype" && stateNotice && (
            <p role="status">{stateNotice}</p>
          )}
          {comparison && (
            <section className="version-comparison">
              <div className="canvas-tools">
                <strong>
                  {comparison.identical ? "两版内容相同" : "两版内容有变化"}
                </strong>
                <button onClick={() => setComparison(null)}>关闭对比</button>
              </div>
              <p className="muted">
                左侧为对比版本，右侧为当前版本；源文件仅作为文本展示。
              </p>
              <div className="comparison-columns">
                <pre>{comparison.before}</pre>
                <pre>{comparison.after}</pre>
              </div>
            </section>
          )}
          <div className="native-surface" ref={surface}>
            {tab === "browser"
              ? !loaded && (
                  <div className="empty">
                    打开网页后，在此登录、操作并采集页面状态。
                  </div>
                )
              : !selected && (
                  <div className="empty">先采集页面，再生成可操作原型。</div>
                )}
          </div>
          <div className="canvas-caption">
            {tab === "browser"
              ? "真实网站模式：由你操作登录和业务页面。"
              : "原型模式：只运行模拟交互，外部网络与真实业务写入已禁用。"}
          </div>
          <section className="capture-controls">
            <label>
              页面依据
              <select
                aria-label="页面依据"
                value={selectedCapture}
                onChange={(e) => setSelectedCapture(e.target.value)}
              >
                <option value="">选择已采集的页面状态</option>
                {captureList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {new Date(c.capturedAt).toLocaleTimeString()}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selectedCapture}
              onClick={() =>
                void desktop()
                  .workbench.revealCapture(projectId, selectedCapture)
                  .catch((e) => setError(errorText(e)))
              }
            >
              查看来源
            </button>
            <button
              className="primary"
              disabled={!selectedCapture || generating || busy}
              onClick={() =>
                void perform(async () => {
                  const version = await desktop().workbench.generate(
                    projectId,
                    selectedCapture,
                  );
                  setVersions(await desktop().workbench.versions(projectId));
                  setSelected(version.id);
                  setTab("prototype");
                })
              }
            >
              依据此状态生成原型
            </button>
          </section>
          {progress && (
            <div className="notice" role="status">
              {progress.message} · {progress.characters.toLocaleString()} 字符
              {generating && (
                <button
                  onClick={() => void desktop().workbench.cancel(projectId)}
                >
                  取消生成
                </button>
              )}
            </div>
          )}
          <p className="muted">
            生成时会把选定页面的文字、结构和样式发送给当前项目的模型。截图保存在本地，当前生成不使用图像输入。
          </p>
        </>
      )}
    </>
  );
}
