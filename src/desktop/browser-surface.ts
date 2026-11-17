import { WebContentsView, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { parseWebDestination } from "./navigation.js";
import type { SurfaceBounds } from "../contracts/workbench.js";
const captureScript = `(()=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};const nodes=[...document.body.querySelectorAll('*')].filter(visible).slice(0,450).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,role:e.getAttribute('role'),text:e.children.length?undefined:e.textContent?.slice(0,180),placeholder:e.getAttribute('placeholder'),type:e.getAttribute('type'),box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},style:{color:s.color,background:s.backgroundColor,font:s.font,fontSize:s.fontSize,display:s.display,gap:s.gap,padding:s.padding,border:s.border,borderRadius:s.borderRadius}};});const url=new URL(location.href);url.search='';url.hash='';url.username='';url.password='';return {title:document.title,url:url.href,text:document.body.innerText.slice(0,18000),structure:JSON.stringify(nodes).slice(0,60000)};})()`;
export class BrowserSurface {
  private views = new Map<string, WebContentsView>();
  private actions = new Map<string, string[]>();
  private attached: WebContentsView | null = null;
  constructor(private getWindow: () => BrowserWindow | null) {}
  private view(id: string) {
    let view = this.views.get(id);
    if (view && !view.webContents.isDestroyed()) return view;
    view = new WebContentsView({
      webPreferences: {
        partition: `persist:produck-project-${id}`,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    view.webContents.session.on("will-download", (e) => e.preventDefault());
    const guard = (event: Electron.Event, url: string) => {
      try {
        parseWebDestination(url);
      } catch {
        event.preventDefault();
      }
    };
    view.webContents.on("will-navigate", guard);
    view.webContents.on("will-redirect", guard);
    this.views.set(id, view);
    this.actions.set(id, []);
    return view;
  }
  async open(id: string, url: string) {
    const destination = parseWebDestination(url);
    const view = this.view(id);
    await view.webContents.loadURL(destination);
    this.actions
      .get(id)!
      .push(
        `打开页面：${new URL(destination).origin}${new URL(destination).pathname}`,
      );
    return {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
    };
  }
  show(id: string, bounds: SurfaceBounds) {
    const view = this.view(id);
    this.attach(view, bounds);
  }
  private attach(view: WebContentsView, b: SurfaceBounds) {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite))
      throw new Error("浏览器区域无效");
    const size = win.getContentBounds();
    const x = Math.max(0, Math.round(b.x)),
      y = Math.max(0, Math.round(b.y));
    const width = Math.max(0, Math.min(Math.round(b.width), size.width - x)),
      height = Math.max(0, Math.min(Math.round(b.height), size.height - y));
    if (this.attached !== view) {
      this.hide();
      win.contentView.addChildView(view);
      this.attached = view;
    }
    view.setBounds({ x, y, width, height });
  }
  hide() {
    const win = this.getWindow();
    if (win && !win.isDestroyed() && this.attached)
      win.contentView.removeChildView(this.attached);
    this.attached = null;
  }
  async capture(id: string) {
    const view = this.view(id);
    parseWebDestination(view.webContents.getURL());
    const value = await view.webContents.executeJavaScript(captureScript);
    const screenshot = await view.webContents.capturePage();
    if (screenshot.isEmpty()) throw new Error("页面尚未完成绘制，请稍后采集");
    return {
      ...value,
      capturedAt: new Date().toISOString(),
      actions: [...(this.actions.get(id) ?? [])],
      png: screenshot.toPNG(),
    };
  }
  async action(
    id: string,
    action: "click" | "fill",
    selector: string,
    value?: string,
  ) {
    if (typeof selector !== "string" || selector.length > 300 || !selector)
      throw new Error("元素选择器无效");
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > 10000)
    )
      throw new Error("输入值无效");
    const view = this.view(id);
    parseWebDestination(view.webContents.getURL());
    const script = `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('未找到元素');${action === "click" ? "el.click();" : `if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)||el.type==='password')throw new Error('该输入需要用户手动操作');const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value ?? "")});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));`}return true;})()`;
    await view.webContents.executeJavaScript(script, true);
    this.actions
      .get(id)!
      .push(`${action === "click" ? "点击" : "填写"}：${selector}`);
  }
  close() {
    this.hide();
    for (const view of this.views.values())
      if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.clear();
  }
}
const csp =
  "default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;font-src data:;connect-src 'none';form-action 'none';frame-src 'none';object-src 'none';base-uri 'none'";
export class PrototypeSurface {
  private view: WebContentsView | null = null;
  private attached = false;
  constructor(private getWindow: () => BrowserWindow | null) {}
  async load(html: string) {
    this.close();
    const view = new WebContentsView({
      webPreferences: {
        partition: `produck-preview-${randomUUID()}`,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    this.view = view;
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (e) => e.preventDefault());
    view.webContents.on("will-redirect", (e) => e.preventDefault());
    view.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    view.webContents.session.on("will-download", (e) => e.preventDefault());
    view.webContents.session.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) =>
        callback({
          cancel:
            !details.url.startsWith("data:") &&
            !details.url.startsWith("about:"),
        }),
    );
    // The policy is parsed before any generated markup or script.
    const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${html}</body></html>`;
    await view.webContents.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(document),
    );
  }
  async snapshot() {
    if (!this.view) throw new Error("请先加载原型");
    await this.selectionMode(false);
    const text = await this.view.webContents.executeJavaScript(
      "document.body.innerText.slice(0,18000)",
    );
    const image = await this.view.webContents.capturePage();
    if (image.isEmpty()) throw new Error("页面尚未绘制完成");
    return { text, png: image.toPNG() };
  }
  async selectionMode(enabled: boolean) {
    if (!this.view) throw new Error("请先加载原型");
    await this.view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      {
        code: `(() => {
      if (!globalThis.produckPicker) {
        const state = globalThis.produckPicker = { enabled: false, selection: null, highlighted: null, outline: '' };
        window.addEventListener('click', event => {
          if (!state.enabled) return;
          event.preventDefault(); event.stopImmediatePropagation();
          const target = event.target.closest('[data-produck-id]');
          if (state.highlighted) state.highlighted.style.outline = state.outline;
          state.selection = target ? { id: target.getAttribute('data-produck-id'), tag: target.tagName, text: target.innerText.slice(0,800), page: document.title } : null;
          if (target) { state.highlighted = target; state.outline = target.style.outline; target.style.outline = '2px solid #9a6529'; }
        }, true);
      }
      globalThis.produckPicker.enabled = ${enabled};
      if (!${enabled} && globalThis.produckPicker.highlighted) globalThis.produckPicker.highlighted.style.outline = globalThis.produckPicker.outline;
    })()`,
      },
    ]);
  }
  async selection() {
    if (!this.view) return null;
    return this.view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      { code: "globalThis.produckPicker?.selection ?? null" },
    ]);
  }
  show(bounds: SurfaceBounds) {
    const win = this.getWindow(),
      view = this.view;
    if (!win || !view || win.isDestroyed()) return;
    if (!Object.values(bounds).every(Number.isFinite))
      throw new Error("预览区域无效");
    const size = win.getContentBounds(),
      x = Math.max(0, Math.round(bounds.x)),
      y = Math.max(0, Math.round(bounds.y));
    if (!this.attached) {
      win.contentView.addChildView(view);
      this.attached = true;
    }
    view.setBounds({
      x,
      y,
      width: Math.max(0, Math.min(Math.round(bounds.width), size.width - x)),
      height: Math.max(0, Math.min(Math.round(bounds.height), size.height - y)),
    });
  }
  hide() {
    const win = this.getWindow();
    if (win && !win.isDestroyed() && this.view && this.attached)
      win.contentView.removeChildView(this.view);
    this.attached = false;
  }
  close() {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed())
      this.view.webContents.close();
    this.view = null;
  }
}
