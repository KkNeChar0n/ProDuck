import { snapshotExpression } from "./snapshot.js";
import { performDrag, type DragData } from "./drag.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { CdpPipe } from "./cdp-pipe.js";
import {
  requestAllowed,
  validateDiscoveryAction,
  actionConfirmation,
  businessActionIdentity,
  isFormSubmission,
} from "./browser-policy.js";
import { parseWebDestination } from "../desktop/navigation.js";
import type { DiscoveryAction, DiscoveryPage } from "../contracts/discovery.js";
export interface DiscoveryBrowser {
  open(id: string, url: string): Promise<void>;
  begin(id: string): Promise<string>;
  observe(id: string): Promise<DiscoveryPage & { png: Uint8Array }>;
  action(
    id: string,
    page: DiscoveryPage,
    action: DiscoveryAction,
    signal: AbortSignal,
  ): Promise<void | { status: "validation-blocked" }>;
  manual(id: string): Promise<void>;
  close(): Promise<void> | void;
}
const inspect = `(() => {
  const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const all = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="tab"],[role="treeitem"],[role="menuitem"],[role="link"],[role="combobox"],[role="option"],[role="checkbox"],[role="radio"],[tabindex],[onclick],summary,[draggable="true"],canvas,[role="application"],[role="region"],[role="list"],[role="listitem"],[data-droppable],[data-dropzone],[ondrop],[ondragover],[aria-dropeffect],[data-rfd-droppable-id],[data-rbd-droppable-id],main,section,svg,[role="grid"],[role="gridcell"],.react-flow__pane,.react-flow__node,.vue-flow__pane,.vue-flow__node')].filter(e => visible(e) && !e.disabled && !['password','hidden','file'].includes(e.type)).slice(0,160);
  const extra = [...document.querySelectorAll('div,span,li,svg,g')].filter(e => visible(e) && ['grab','grabbing','move'].includes(getComputedStyle(e).cursor)).slice(0,60);
  for (const e of extra) if (!all.includes(e)) all.push(e);
  const path = e => { const parts=[]; for(;e && e.nodeType===1;e=e.parentElement){if(e.id){parts.unshift('#'+e.id);break;}parts.unshift(e.tagName+':'+[...e.parentElement?.children||[]].indexOf(e));}return parts.join('/'); };
  const box = e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  globalThis.__produckDiscoveryNodes = all;
  const label = e => (e.getAttribute('aria-label') || [...(e.labels || [])].map(l=>l.textContent).join(' ') || e.getAttribute('placeholder') || e.innerText || e.getAttribute('title') || e.getAttribute('name') || '').trim().slice(0,200);
  const formInfo = f => {
    const fields = [...f.elements];
    const path = e => { const parts=[]; for(;e && e.nodeType===1;e=e.parentElement){if(e.id){parts.unshift('#'+e.id);break;}parts.unshift(e.tagName+':'+[...e.parentElement?.children||[]].indexOf(e));}return parts.join('/'); };
    return {key:path(f),context:(f.closest('dialog,[role="dialog"]')?.querySelector('h1,h2,h3,[role="heading"]')?.textContent || f.querySelector('legend,h1,h2,h3')?.textContent || '').trim().slice(0,200),action:f.action,method:f.method,search:f.getAttribute('role')==='search' || fields.some(e=>e.type==='search' || /搜索|查询|筛选|search|filter/i.test(label(e))),submitLabels:fields.filter(e=>e.type==='submit').map(label),sensitive:fields.some(e=>['password','file'].includes(e.type)),valid:fields.every(e=>!e.willValidate || e.validity.valid),noValidate:f.noValidate};
  };
  const elements = all.map((e,index) => ({index, key:path(e), box:box(e), draggable:!!e.draggable, dragHint:!!e.draggable || ["grab","grabbing","move"].includes(getComputedStyle(e).cursor), tag:e.tagName, role:e.getAttribute('role') || '', type:e.type || '', inForm:!!e.form, submitsForm:!!e.form && ['BUTTON','INPUT'].includes(e.tagName) && e.type==='submit', label:label(e), ...(e.form ? {form:formInfo(e.form),skipsValidation:!!e.formNoValidate}:{}), ...(['INPUT','TEXTAREA','SELECT'].includes(e.tagName)?{value:String(e.value).slice(0,2000),checked:!!e.checked,required:!!e.required,valid:!e.willValidate || e.validity.valid,validationMessage:e.validationMessage?.slice(0,300)||''}:{}), ...(e.tagName === 'A' && e.href ? {href:e.href} : {}), ...(e.tagName === 'SELECT' ? {options:[...e.options].map(o=>o.value).slice(0,80)} : {})}));
  const structure = JSON.stringify([...document.body.querySelectorAll('*')].filter(visible).slice(0,350).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName, text:e.children.length?undefined:e.textContent?.slice(0,120), role:e.getAttribute('role'), box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}, style:{color:s.color,background:s.backgroundColor,font:s.font,padding:s.padding,display:s.display,border:s.border}, checked:e.checked, selected:e.tagName==='SELECT'?e.selectedIndex:undefined};}));
  return {...${snapshotExpression},title:document.title.slice(0,300),url:location.href,text:document.body.innerText.slice(0,14000),structure:structure.slice(0,45000),elements};
})()`;
interface Session {
  pipe: CdpPipe;
  target: string;
  session: string;
  origin?: string;
  blocked: string[];
  writeAllowed: boolean;
  attempted: Set<string>;
  denied: Set<string>;
  dragData?: DragData;
}
/** One user-visible Chrome process per project, private pipe and private profile. */
export class ChromeDiscoveryBrowser implements DiscoveryBrowser {
  private sessions = new Map<string, Session>();
  private opening = new Set<string>();
  constructor(
    private profiles: string,
    private confirm: (
      detail: { projectId: string; page: string; message: string },
      signal: AbortSignal,
    ) => Promise<boolean> = async () => false,
  ) {}
  private current(id: string) {
    const s = this.sessions.get(id);
    if (!s?.pipe.alive)
      throw new Error("请先打开项目的独立 Chrome，完成登录后继续");
    return s;
  }
  async open(id: string, input: string) {
    const url = parseWebDestination(input);
    if (this.opening.has(id)) throw new Error("Chrome 正在打开，请稍后");
    this.opening.add(id);
    try {
      let s = this.sessions.get(id);
      if (s?.pipe.alive) {
        const { targetInfos } = await s.pipe.send("Target.getTargets");
        if (!targetInfos.some((target: any) => target.targetId === s!.target)) {
          await s.pipe.shutdown();
          this.sessions.delete(id);
          s = undefined;
        }
      }
      if (!s?.pipe.alive) {
        if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("项目标识无效");
        const binary = [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(
            homedir(),
            "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ),
        ].find(existsSync);
        if (!binary)
          throw new Error(
            "未找到 Google Chrome，请安装 Chrome 后重试；无需安装开发工具",
          );
        const profile = join(this.profiles, id);
        mkdirSync(profile, { recursive: true, mode: 0o700 });
        const pipe = new CdpPipe(binary, [
          `--user-data-dir=${profile}`,
          "--remote-debugging-pipe",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-sync",
          "--restore-last-session",
          "about:blank",
        ]);
        try {
          const { targetInfos } = await pipe.send("Target.getTargets");
          const targetId =
            targetInfos.find((target: any) => target.type === "page")
              ?.targetId ??
            (await pipe.send("Target.createTarget", { url: "about:blank" }))
              .targetId;
          const { sessionId } = await pipe.send("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          s = {
            pipe,
            target: targetId,
            session: sessionId,
            blocked: [],
            writeAllowed: false,
            attempted: new Set(),
            denied: new Set(),
          };
          this.sessions.set(id, s);
          const current = s;
          pipe.onEvent = (message) => {
            if (
              message.method === "Input.dragIntercepted" &&
              message.sessionId === current.session
            )
              current.dragData = message.params.data;
            if (message.method === "Fetch.requestPaused") {
              const { requestId, request, resourceType } = message.params;
              const allowed =
                !current.origin ||
                requestAllowed(
                  request.url,
                  request.method,
                  current.origin,
                  resourceType === "Document",
                  current.writeAllowed,
                  request.postData ?? "",
                );
              if (!allowed && current.blocked.length < 30) {
                let label = "请求";
                try {
                  const u = new URL(request.url);
                  label = u.origin + u.pathname;
                } catch {}
                current.blocked.push(`${request.method} ${label}`);
              }
              void pipe
                .send(
                  allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
                  allowed
                    ? { requestId }
                    : { requestId, errorReason: "BlockedByClient" },
                  message.sessionId,
                )
                .catch(() => {});
            }
            if (
              message.method === "Target.targetCreated" &&
              current.origin &&
              message.params.targetInfo.type === "page" &&
              message.params.targetInfo.targetId !== current.target
            )
              void pipe
                .send("Target.closeTarget", {
                  targetId: message.params.targetInfo.targetId,
                })
                .catch(() => {});
          };
          await pipe.send("Target.setDiscoverTargets", { discover: true });
          await pipe.send("Browser.setDownloadBehavior", { behavior: "deny" });
          await pipe.send("Page.enable", {}, sessionId);
          await pipe.send("Runtime.enable", {}, sessionId);
        } catch (e) {
          pipe.close();
          this.sessions.delete(id);
          throw e;
        }
      }
      if (s.origin) throw new Error("请先暂停自动理解，再打开其他页面");
      await s.pipe.send("Page.navigate", { url }, s.session);
      await s.pipe.send("Page.bringToFront", {}, s.session);
    } finally {
      this.opening.delete(id);
    }
  }
  private async evaluate(s: Session, expression: string) {
    const { frameTree } = await s.pipe.send("Page.getFrameTree", {}, s.session);
    const { executionContextId } = await s.pipe.send(
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: "produck-discovery" },
      s.session,
    );
    const result = await s.pipe.send(
      "Runtime.evaluate",
      {
        expression,
        contextId: executionContextId,
        returnByValue: true,
        awaitPromise: true,
      },
      s.session,
    );
    if (result.exceptionDetails)
      throw new Error("页面正在切换或无法读取，请等待页面加载后继续");
    return result.result.value;
  }
  async begin(id: string) {
    const s = this.current(id);
    const url = parseWebDestination(await this.evaluate(s, "location.href"));
    s.origin = new URL(url).origin;
    s.blocked = [];
    s.writeAllowed = false;
    s.denied.clear();
    s.attempted.clear();
    await s.pipe
      .send("Browser.setPermission", {
        permission: { name: "notifications" },
        setting: "denied",
        origin: s.origin,
      })
      .catch(() => {});
    await s.pipe.send(
      "Page.setInterceptFileChooserDialog",
      { enabled: true },
      s.session,
    );
    await s.pipe.send(
      "Fetch.enable",
      { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
      s.session,
    );
    return url;
  }
  async observe(id: string) {
    const s = this.current(id);
    const value = await this.evaluate(s, inspect);
    parseWebDestination(value.url);
    if (s.origin && new URL(value.url).origin !== s.origin)
      throw new Error("页面已离开本次探索站点，请手动登录或返回后继续");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const shot = await s.pipe.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      s.session,
    );
    return {
      ...value,
      fingerprint,
      blocked: [...s.blocked],
      png: Buffer.from(shot.data, "base64"),
    } as DiscoveryPage & { png: Uint8Array };
  }
  async action(
    id: string,
    page: DiscoveryPage,
    action: DiscoveryAction,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const s = this.current(id);
    if (!s.origin) throw new Error("自动探索已暂停");
    validateDiscoveryAction(page, action, s.origin);
    if (action.kind === "finish" || action.kind === "complete-module") return;
    const confirmation = actionConfirmation(page, action);
    const element =
      "index" in action
        ? page.elements.find((e) => e.index === action.index)
        : undefined;
    const key = businessActionIdentity(page, action);
    // Read validity without checkValidity/reportValidity: those dispatch page events.
    // No click or key event is sent, so a later completed form may be attempted safely.
    if (
      isFormSubmission(element, action) &&
      element?.form &&
      !element.form.noValidate &&
      !element.skipsValidation &&
      !element.form.valid
    ) {
      const current = await this.observe(id);
      signal.throwIfAborted();
      if (current.fingerprint !== page.fingerprint)
        throw new Error("表单已变化，请重新观察");
      return { status: "validation-blocked" as const };
    }
    if (confirmation) {
      if (s.attempted.has(key))
        throw new Error("此业务操作已尝试，不自动重复；请继续其他页面");
      if (s.denied.has(key))
        throw new Error("用户已跳过此业务操作，请选择其他入口");
      const allowed = await this.confirm(
        {
          projectId: id,
          page: `${page.title} · ${new URL(page.url).origin}${new URL(page.url).pathname}`,
          message: confirmation,
        },
        signal,
      );
      signal.throwIfAborted();
      if (!allowed) {
        s.denied.add(key);
        throw new Error("用户跳过此业务操作，请继续其他入口");
      }
    }
    const now = await this.observe(id);
    signal.throwIfAborted();
    if (
      confirmation || action.kind === "drag"
        ? now.fingerprint !== page.fingerprint
        : now.url !== page.url ||
          (element &&
            JSON.stringify(
              now.elements.find((e) => e.index === element.index),
            ) !== JSON.stringify(element))
    )
      throw new Error("目标在观察后发生变化，重新观察后选择目标");
    if (confirmation) s.attempted.add(key);
    s.writeAllowed = !!confirmation;
    try {
      let expression = "";
      if (action.kind === "drag") {
        const points = await this.evaluate(
          s,
          `(() => {
          const source=globalThis.__produckDiscoveryNodes[${action.index}],target=globalThis.__produckDiscoveryNodes[${action.targetIndex}];
          const point=(e,p)=>{ if(!e?.isConnected) return null; const r=e.getBoundingClientRect();const x=r.x+r.width*p.x,y=r.y+r.height*p.y;const hit=document.elementFromPoint(x,y); if(x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||!(e===hit||e.contains(hit)))return null; return {x,y}; };
          return {from:point(source,${JSON.stringify(action.from ?? { x: 0.5, y: 0.5 })}),to:point(target,${JSON.stringify(action.to ?? { x: 0.5, y: 0.5 })})};
        })()`,
        );
        if (!points.from || !points.to)
          throw new Error("拖拽位置不可见或被遮挡，请滚动或关闭遮挡后重新观察");
        s.dragData = undefined;
        await performDrag(
          (method, params) => s.pipe.send(method, params, s.session),
          () => s.dragData,
          points.from,
          points.to,
          signal,
        );
      } else if (action.kind === "back") {
        const history = await s.pipe.send(
          "Page.getNavigationHistory",
          {},
          s.session,
        );
        const entry = history.entries[history.currentIndex - 1];
        if (!entry || !requestAllowed(entry.url, "GET", s.origin, true))
          throw new Error("没有可返回的同站页面");
        await s.pipe.send(
          "Page.navigateToHistoryEntry",
          { entryId: entry.id },
          s.session,
        );
      } else {
        if (action.kind === "scroll")
          expression = `scrollBy(0,${action.direction === "down" ? "innerHeight*0.8" : "-innerHeight*0.8"})`;
        else {
          const target = `globalThis.__produckDiscoveryNodes[${action.index}]`;
          if (action.kind === "click") expression = `${target}.click()`;
          else if (action.kind === "fill")
            expression = `(()=>{const e=${target};const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(action.value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
          else if (action.kind === "press") {
            await this.evaluate(s, `${target}.focus()`);
            const key = action.key === "Space" ? " " : action.key;
            const keyCode = {
              Enter: 13,
              Escape: 27,
              Tab: 9,
              ArrowDown: 40,
              ArrowUp: 38,
              ArrowLeft: 37,
              ArrowRight: 39,
              Space: 32,
            }[action.key];
            await s.pipe.send(
              "Input.dispatchKeyEvent",
              {
                type: "keyDown",
                key,
                code: action.key,
                ...(action.key === "Enter"
                  ? { text: "\r", unmodifiedText: "\r" }
                  : action.key === "Space"
                    ? { text: " ", unmodifiedText: " " }
                    : {}),
                windowsVirtualKeyCode: keyCode,
              },
              s.session,
            );
            await s.pipe.send(
              "Input.dispatchKeyEvent",
              {
                type: "keyUp",
                key,
                code: action.key,
                windowsVirtualKeyCode: keyCode,
              },
              s.session,
            );
            expression = "true";
          } else
            expression = `(()=>{const e=${target};e.value=${JSON.stringify(action.value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
        }
        await this.evaluate(s, expression);
      }
      await delay(650, undefined, { signal });
    } finally {
      s.writeAllowed = false;
    }
  }
  async manual(id: string) {
    const s = this.sessions.get(id);
    if (!s?.pipe.alive) return;
    // Disable interception before relinquishing control; failures are surfaced to caller.
    await s.pipe.send("Fetch.disable", {}, s.session);
    s.origin = undefined;
    s.writeAllowed = false;
    await s.pipe
      .send("Page.setInterceptFileChooserDialog", { enabled: false }, s.session)
      .catch(() => {});
  }
  async close() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((s) => s.pipe.shutdown()));
  }
}
