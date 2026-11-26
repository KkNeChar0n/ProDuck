import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
const root = mkdtempSync(join(tmpdir(), "produck-overview-"));
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html;charset=utf-8");
  res.end(
    '<html><head><title>产品首页</title></head><body style="background:#f8f5e8"><h1>订单概览</h1><script>window.secret="script-secret"</script><input type="hidden" value="hidden-secret"><input type="password" value="password-secret"><button onclick="fetch(\'/write\')">查看订单</button><canvas width="100" height="80"></canvas><iframe src="about:blank"></iframe></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = new ChromeDiscoveryBrowser(join(root, "chrome"), async () => {
  throw new Error("must not submit");
});
try {
  await browser.open(
    "12345678-1234-1234-1234-123456789abc",
    `http://127.0.0.1:${server.address().port}`,
  );
  await new Promise((r) => setTimeout(r, 500));
  const page = await browser.observe("12345678-1234-1234-1234-123456789abc");
  assert(page.html.includes("订单概览"));
  assert(page.html.includes("Content-Security-Policy"));
  for (const forbidden of [
    "<script",
    "onclick=",
    "hidden-secret",
    "password-secret",
    "script-secret",
    "<iframe",
    "<canvas",
  ])
    assert(!page.html.includes(forbidden), forbidden);
  assert(page.captureNotes.some((n) => n.includes("CANVAS")));
  assert(page.captureNotes.some((n) => n.includes("IFRAME")));
  assert(page.png.length > 100);
  console.log(
    "PASS: real Chrome static HTML, computed layout, hidden/secret/script removal and screenshot gaps",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
