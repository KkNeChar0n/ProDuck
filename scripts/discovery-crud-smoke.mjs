import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
const root = mkdtempSync(join(tmpdir(), "produck-form-test-"));
const html = readFileSync("tests/fixtures/customers-crud.html", "utf8").replace(
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
  await action("新增客户");
  await action("客户名称", "fill", { value: "深度体验样例" });
  await action("负责人", "fill", { value: "测试人" });
  await action("取消");
  assert(!(await browser.observe(id)).text.includes("深度体验样例"));
  await action("新增客户");
  assert.equal(
    (await action("保存", "click", { effect: "write" })).status,
    "validation-blocked",
  );
  await action("客户名称", "fill", { value: "深度体验样例" });
  await action("负责人", "fill", { value: "测试人" });
  await action("保存", "click", { effect: "write" });
  assert((await browser.observe(id)).text.includes("客户已新建"));
  assert.equal(confirmations, 1);
  await action("编辑 深度体验样例");
  let observed = await browser.observe(id);
  assert.equal(
    observed.elements.find((e) => e.label === "负责人").value,
    "测试人",
  );
  assert.equal(
    observed.elements.find((e) => e.label === "负责人").form.context,
    "编辑客户",
  );
  await action("负责人", "fill", { value: "取消的修改" });
  await action("取消");
  await action("编辑 深度体验样例");
  observed = await browser.observe(id);
  assert.equal(
    observed.elements.find((e) => e.label === "负责人").value,
    "测试人",
  );
  await action("客户名称", "fill", { value: "" });
  assert.equal(
    (await action("保存", "click", { effect: "write" })).status,
    "validation-blocked",
  );
  await action("客户名称", "fill", { value: "深度体验样例" });
  await action("负责人", "fill", { value: "更新的测试人" });
  await action("负责人", "press", { key: "Enter", effect: "write" });
  observed = await browser.observe(id);
  assert(observed.text.includes("客户已更新"));
  assert(observed.text.includes("更新的测试人"));
  assert.equal(confirmations, 2);
  await action("编辑 深度体验样例");
  await action("负责人", "fill", { value: "重复尝试" });
  await assert.rejects(
    action("保存", "click", { effect: "write" }),
    /不自动重复/,
  );
  assert.equal(confirmations, 2);
  writeFileSync(
    "docs/verification/discovery-crud-smoke.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        createCancel: true,
        createValidation: true,
        createSave: true,
        editPrefill: true,
        editCancelPreservesRecord: true,
        editValidation: true,
        editSave: true,
        sharedDialogContext: true,
        repeatedEditBlocked: true,
        confirmations,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: real Chrome create/edit prefill, validation, cancellation, saved results and shared form replay boundary",
  );
} finally {
  await browser.close();
  server.close();
}
