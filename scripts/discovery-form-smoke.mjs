import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
const root = mkdtempSync(join(tmpdir(), "produck-form-test-"));
const html = readFileSync("tests/fixtures/customers.html", "utf8").replace(
  "</body>",
  `<script>globalThis.testClicks=0;document.querySelector('#customer-form button.primary').addEventListener('click',()=>globalThis.testClicks++);</script></body>`,
);
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let confirmations = 0,
  allow = true;
const browser = new ChromeDiscoveryBrowser(join(root, "chrome"), async () => {
  confirmations++;
  return allow;
});
const signal = new AbortController().signal;
const id = crypto.randomUUID();
const action = async (label, kind = "click", extra = {}) => {
  const page = await browser.observe(id);
  const el = page.elements.find((e) => e.label === label);
  assert(el, `Missing ${label}`);
  return browser.action(
    id,
    page,
    { kind, index: el.index, effect: "read", ...extra },
    signal,
  );
};
try {
  await browser.open(id, origin);
  await browser.begin(id);
  await action("搜索客户名称", "fill", { value: "青禾" });
  assert.equal(
    (await browser.observe(id)).elements.find((e) => e.label === "搜索客户名称")
      .value,
    "青禾",
  );
  await action("搜索");
  assert(!(await browser.observe(id)).text.includes("拾光设计"));
  await action("重置");
  await action("客户状态", "select", { value: "跟进中" });
  assert.equal(
    (await browser.observe(id)).elements.find((e) => e.label === "客户状态")
      .value,
    "跟进中",
  );
  await action("搜索");
  assert(!(await browser.observe(id)).text.includes("青禾科技"));
  await action("搜索客户名称", "fill", { value: "无匹配测试" });
  await action("搜索客户名称", "press", { key: "Enter" });
  assert((await browser.observe(id)).text.includes("暂无匹配客户"));
  assert.equal(confirmations, 0);
  await action("重置");
  await action("新增客户");
  const before = await browser.observe(id);
  assert.equal(
    before.elements.find((e) => e.label === "客户名称").required,
    true,
  );
  assert.equal(
    before.elements.find((e) => e.label === "客户名称").valid,
    false,
  );
  assert(before.elements.find((e) => e.label === "客户名称").validationMessage);
  assert.equal(
    (await action("保存", "click", { effect: "write" })).status,
    "validation-blocked",
  );
  assert.equal(confirmations, 0);
  const session = browser.sessions.get(id);
  const evaluate = async (expression) =>
    (
      await session.pipe.send(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        session.session,
      )
    ).result.value;
  assert.equal(await evaluate("globalThis.testClicks"), 0);
  await action("客户名称", "fill", { value: "新客户" });
  await action("负责人", "fill", { value: "测试人" });
  await action("负责人", "press", { key: "Enter", effect: "write" });
  assert.equal(confirmations, 1);
  assert((await browser.observe(id)).text.includes("客户已保存"));
  assert.equal(
    await evaluate("document.querySelectorAll('#rows tr').length"),
    4,
  );
  await action("新增客户");
  await action("客户名称", "fill", { value: "另一个客户" });
  await action("负责人", "fill", { value: "测试人" });
  await assert.rejects(
    action("保存", "click", { effect: "write" }),
    /不自动重复/,
  );
  assert.equal(confirmations, 1);
  await browser.manual(id);
  await browser.begin(id);
  allow = false;
  await assert.rejects(action("保存", "click", { effect: "write" }), /跳过/);
  await assert.rejects(
    action("负责人", "press", { key: "Enter", effect: "write" }),
    /跳过/,
  );
  assert.equal(confirmations, 2);
  assert.equal(
    await evaluate("document.querySelectorAll('#rows tr').length"),
    4,
  );
  writeFileSync(
    "docs/verification/discovery-form-smoke.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        queryRepeat: true,
        inputValues: true,
        associatedLabels: true,
        nativeValidity: true,
        invalidSubmissionDispatched: false,
        enterTriggeredQuery: true,
        enterTriggeredSave: true,
        crossEntryReplayBlocked: true,
        declineAcrossEntries: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: real Chrome form values, native validity, repeated query, Enter query/save and cross-entry write protection",
  );
} finally {
  await browser.close();
  server.close();
}
