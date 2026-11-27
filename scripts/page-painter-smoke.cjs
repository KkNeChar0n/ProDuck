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
    const { planRegions } = await import("../dist/prototypes/region-layout.js");
    for (const width of [1100, 1800]) {
      win.setSize(width, 800);
      const plan = planRegions({
        html: `<html><body><div><aside style="position:fixed;width:240px;height:800px;background:#234">menu</aside><header style="position:fixed;width:1560px;height:60px">header</header><main style="margin:60px 0 0 240px;width:1560px">workspace</main></div></body></html>`,
        text: "",
        structure: "",
      });
      const output = assembleRegions(
        "layout",
        plan.parts.map(
          (p) =>
            `<html><body>${p.input.includes("menu") ? "<button>menu</button>" : p.input.includes("header") ? "<div>header</div>" : "<div>workspace</div>"}</body></html>`,
        ),
        { template: plan.template, slotIds: plan.parts.map((p) => p.id) },
      );
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(output),
      );
      const rects = await win.webContents.executeJavaScript(
        `(()=>{const boxes=[...document.querySelectorAll('[data-produck-slot]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right}});return {boxes,width:innerWidth}})()`,
      );
      assert.equal(rects.boxes.length, 3);
      const [side, header, main] = rects.boxes;
      assert(Math.abs(side.width - 240) < 2);
      assert(Math.abs(header.x - side.right) < 2);
      assert(Math.abs(main.x - header.x) < 2);
      assert(main.y >= header.y);
      assert(main.right <= rects.width + 1);
    }
    console.log(
      "PASS: region controls/styles and responsive sidebar/header/workspace layout at 1100 and 1800px",
    );
  } finally {
    win.destroy();
    app.quit();
  }
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
