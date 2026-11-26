const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
(async () => {
  await app.whenReady();
  const { assembleRegions } =
    await import("../dist/prototypes/page-painter.js");
  const make = (color, label) =>
    `<html><head><style>body{padding:7px}button{color:${color}}</style></head><body><button id="button">${label}</button><script>document.getElementById('button').onclick=()=>{document.querySelector('button').textContent+=' clicked';};</script></body></html>`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          assembleRegions("区域", [
            make("rgb(255, 0, 0)", "A"),
            make("rgb(0, 0, 255)", "B"),
          ]),
        ),
    );
    const result = await win.webContents.executeJavaScript(
      `(()=>{const a=document.querySelector('#produck-region-0 button'),b=document.querySelector('#produck-region-1 button');a.click();return [a.textContent,b.textContent,getComputedStyle(a).color,getComputedStyle(b).color]})()`,
    );
    assert.deepEqual(result, [
      "A clicked",
      "B",
      "rgb(255, 0, 0)",
      "rgb(0, 0, 255)",
    ]);
    console.log(
      "PASS: assembled regions retain independent styles and working scoped controls",
    );
  } finally {
    win.destroy();
    app.quit();
  }
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
