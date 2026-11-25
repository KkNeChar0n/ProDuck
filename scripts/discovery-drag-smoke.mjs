import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
const root = mkdtempSync(join(tmpdir(), "produck-drag-test-"));
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(readFileSync("tests/fixtures/drag-workspace.html"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let confirmations = 0,
  allow = true;
const browser = new ChromeDiscoveryBrowser(join(root, "chrome"), async () => {
  confirmations++;
  return allow;
});
const id = crypto.randomUUID(),
  signal = new AbortController().signal;
const element = (page, label) => {
  const e = page.elements.find((e) => e.label === label);
  assert(e, `missing ${label}`);
  return e.index;
};
const drag = async (source, target, extra = {}) => {
  const page = await browser.observe(id);
  return browser.action(
    id,
    page,
    {
      kind: "drag",
      index: element(page, source),
      targetIndex: element(page, target),
      effect: "read",
      ...extra,
    },
    signal,
  );
};
try {
  await browser.open(id, `http://127.0.0.1:${server.address().port}`);
  await browser.begin(id);
  await drag("文本资源", "资源画布");
  let page = await browser.observe(id);
  assert.match(page.text, /已添加文本节点 1/);
  assert.match(page.text, /属性面板显示文本配置/);
  await drag("条目 A", "条目 B");
  page = await browser.observe(id);
  assert.match(page.text, /排序结果：BA/);
  await drag("节点画布", "节点画布", {
    from: { x: 0.2, y: 0.3 },
    to: { x: 0.7, y: 0.65 },
  });
  page = await browser.observe(id);
  assert.match(page.text, /节点位置：21\d,13\d/);
  assert.equal(confirmations, 0);
  await assert.rejects(drag("文本资源", "远处区域"), /不可见|遮挡/);
  page = await browser.observe(id);
  const old = page;
  const session = browser.sessions.get(id);
  await session.pipe.send(
    "Runtime.evaluate",
    { expression: "document.querySelector('#drop').style.marginLeft='20px'" },
    session.session,
  );
  await assert.rejects(
    browser.action(
      id,
      old,
      {
        kind: "drag",
        index: element(old, "文本资源"),
        targetIndex: element(old, "资源画布"),
        effect: "read",
      },
      signal,
    ),
    /变化/,
  );
  const abort = new AbortController();
  const originalSend = session.pipe.send.bind(session.pipe);
  session.pipe.send = async (method, params, sid) => {
    const value = await originalSend(method, params, sid);
    if (method === "Input.dispatchDragEvent" && params.type === "dragOver")
      abort.abort();
    return value;
  };
  page = await browser.observe(id);
  await assert.rejects(
    browser.action(
      id,
      page,
      {
        kind: "drag",
        index: element(page, "文本资源"),
        targetIndex: element(page, "资源画布"),
        effect: "read",
      },
      abort.signal,
    ),
  );
  session.pipe.send = originalSend;
  assert.match((await browser.observe(id)).text, /已添加文本节点 1/);
  allow = false;
  await assert.rejects(
    drag("文本资源", "资源画布", { effect: "unknown" }),
    /跳过/,
  );
  await assert.rejects(
    drag("文本资源", "资源画布", { effect: "write" }),
    /跳过/,
  );
  assert.equal(confirmations, 1);
  await browser.manual(id);
  await browser.begin(id);
  allow = true;
  await drag("文本资源", "资源画布", { effect: "write" });
  assert.equal(confirmations, 2);
  await assert.rejects(
    drag("文本资源", "资源画布", { effect: "write" }),
    /已尝试/,
  );
  page = await browser.observe(id);
  assert.match(page.text, /已添加文本节点 2/);
  mkdirSync("docs/verification", { recursive: true });
  writeFileSync("docs/verification/discovery-drag.png", page.png);
  console.log(
    "PASS: native HTML drag data, pointer sorting, canvas coordinates, viewport/stale target checks, confirmation and replay protection",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
