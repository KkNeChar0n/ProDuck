/* UI prototype only: no model calls, credential storage, or platform writes. */
"use strict";
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const baseline = () => ({
  title: "客户列表",
  statusFilter: false,
  compact: false,
});
const makeProject = (name, workspace, demo = false) => ({
  id: crypto.randomUUID(),
  name,
  workspace,
  demo,
  versions: demo
    ? [{ number: 1, ...baseline(), summary: "根据客户列表建立的初始原型" }]
    : [],
  current: demo ? 1 : null,
  approved: [],
  docVersion: null,
  captured: demo,
  filter: "",
  status: "全部状态",
  messages: [
    {
      role: "agent",
      text: demo
        ? "已经整理了客户列表的页面结构。你可以在中间直接体验筛选和新增客户，也可以选中某个区域，告诉我你想怎么调整。"
        : "项目已创建。先在浏览器页载入演示页面，或查看项目设置，配置你的工作空间。",
      evidence: demo
        ? "页面依据：客户列表演示页\n已观察：名称搜索、新增客户、表单校验\n待确认：不同角色的数据权限"
        : "",
    },
  ],
  customers: [
    { name: "青禾科技", owner: "陈晓", status: "合作中", industry: "企业服务" },
    { name: "拾光设计", owner: "林悦", status: "跟进中", industry: "设计咨询" },
    { name: "山野生活", owner: "陈晓", status: "合作中", industry: "零售消费" },
    {
      name: "未迟工作室",
      owner: "周舟",
      status: "待联系",
      industry: "文化创意",
    },
  ],
  connection: { feishu: "", yunxiao: "" },
});
let projects = [makeProject("客户管理平台", "~/Produck/客户管理平台", true)];
let project = projects[0],
  view = "workbench",
  tab = "prototype",
  selecting = false,
  selection = "",
  model = null,
  running = null,
  toastTimer;
const currentVersion = () =>
  project.versions.find((v) => v.number === project.current);
const approved = () => project.approved.includes(project.current);
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4000);
}
function addMessage(text, role = "agent", evidence = "") {
  project.messages.push({ role, text, evidence });
  renderMessages();
}
function renderMessages() {
  $("#messages").innerHTML = project.messages
    .map(
      (m) =>
        `<div class="message ${m.role}"><div class="message-label">${m.role === "user" ? "你" : "Produck · 演示回应"}</div>${esc(m.text)}${m.evidence ? `<div class="evidence">${esc(m.evidence)}</div>` : ""}</div>`,
    )
    .join("");
  $("#messages").scrollTop = $("#messages").scrollHeight;
}
function render() {
  $("#project-select").innerHTML = projects
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === project.id ? "selected" : ""}>${esc(p.name)}</option>`,
    )
    .join("");
  $("#project-heading").textContent = project.name;
  $("#task-name").textContent = project.captured
    ? "优化客户筛选"
    : "理解第一个页面";
  $("#page-heading").textContent = {
    workbench: project.captured ? "优化客户筛选" : "从一个页面开始",
    memory: "项目记忆",
    documents: "项目文档",
    workflow: "工作流",
    skills: "技能库",
    settings: "项目设置",
  }[view];
  document
    .querySelectorAll(".nav")
    .forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $("#version-count").textContent = project.versions.length;
  $("#selection-context").textContent = selection
    ? `⌖ 已选择：${selection}`
    : "▧ 客户列表 · 整个页面";
  $("#workspace-body").innerHTML =
    view === "workbench"
      ? workbench()
      : view === "memory"
        ? memory()
        : view === "documents"
          ? documentView()
          : view === "workflow"
            ? workflow()
            : view === "skills"
              ? skills()
              : settings();
  const ready = Boolean(currentVersion());
  $("#stage-label").textContent = !ready
    ? "等待页面依据"
    : approved()
      ? `v${project.current} 已通过`
      : `v${project.current} 原型待确认`;
  $("#stage-detail").textContent = !ready
    ? "载入页面后建立原型"
    : approved()
      ? "后续修改会生成新的候选版本"
      : "先体验交互，再确认这个版本";
  $("#primary-action").textContent = approved() ? "生成文档草稿" : "通过此版本";
  $("#primary-action").disabled = !ready || Boolean(running);
  document.querySelector(".task-progress").innerHTML =
    `<span class="${project.captured ? "done" : "current"}">理解页面</span><i></i><span class="${approved() ? "done" : "current"}">调整原型</span><i></i><span class="${approved() ? "current" : ""}">撰写文档</span>`;
  renderMessages();
}
function workbench() {
  return `<div class="tabs" role="tablist">${[
    ["browser", "浏览器"],
    ["prototype", "原型"],
    ["document", "文档"],
  ]
    .map(
      ([id, label]) =>
        `<button role="tab" aria-selected="${tab === id}" class="tab ${tab === id ? "active" : ""}" data-action="tab" data-tab="${id}">${label}</button>`,
    )
    .join(
      "",
    )}</div>${tab === "browser" ? browserView() : tab === "document" ? documentView() : prototypeView()}`;
}
function browserView() {
  return `<form id="url-form" class="url-form"><input aria-label="页面地址" id="page-url" value="https://demo.produck.local/customers" placeholder="输入页面地址"><button type="submit">载入页面</button></form><div class="notice">此处演示网页采集流程。仅载入内置客户页面，不访问真实网站。</div>${samplePage(baseline(), true)}<div class="dialog-actions"><button class="primary" data-action="capture">理解页面并建立原型</button></div>`;
}
function prototypeView() {
  if (!currentVersion())
    return `<div class="empty"><h2>把现有页面带进工作台</h2><p>先理解页面，再开始调整交互。</p><button class="primary" data-action="tab" data-tab="browser">打开浏览器</button></div>`;
  return `<div class="canvas-tools"><span>客户列表 <span class="muted"> / v${project.current} ${approved() ? "已通过" : "候选版本"}</span></span><div class="group"><button data-action="select" aria-pressed="${selecting}">${selecting ? "退出选择" : "选择元素"}</button><button data-action="compare">对比</button><button data-action="history">撤销 / 恢复</button></div></div>${samplePage(currentVersion())}<div class="canvas-caption"><span>◌</span>模拟数据，可直接体验交互。修改不会影响真实系统。</div>`;
}
function samplePage(v, browser = false) {
  const rows = project.customers.filter(
    (c) =>
      c.name.includes(project.filter) &&
      (!v.statusFilter ||
        project.status === "全部状态" ||
        c.status === project.status),
  );
  return `<div class="canvas ${selecting && !browser ? "selecting" : ""}"><div class="canvas-top"><strong>青禾 CRM</strong><span>/ 客户管理</span><span>${browser ? "来源页面演示" : "可操作原型"}</span></div><div class="sample-page"><div class="sample-heading" data-element="页面标题"><div><h2>${esc(v.title)}</h2><p>管理客户信息，跟进每一次合作。</p></div><button data-action="add-customer">＋ 新增客户</button></div><form id="filter-form" class="filters" data-element="筛选区域"><input aria-label="搜索客户" id="customer-search" placeholder="搜索客户名称" value="${esc(project.filter)}">${v.statusFilter ? `<select aria-label="客户状态" id="customer-status">${["全部状态", "合作中", "跟进中", "待联系"].map((s) => `<option ${project.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}<button type="submit">搜索</button><button type="button" data-action="reset-filter">重置</button></form><div data-element="客户表格"><table class="${v.compact ? "compact" : ""}"><thead><tr><th>客户名称</th><th>负责人</th><th>状态</th><th>所属行业</th></tr></thead><tbody>${rows.length ? rows.map((c) => `<tr><td class="company">${esc(c.name)}<small>企业客户</small></td><td>${esc(c.owner)}</td><td><span class="pill ${c.status === "合作中" ? "" : "pending"}">${esc(c.status)}</span></td><td>${esc(c.industry)}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">没有匹配的客户，试试其他名称或重置筛选。</td></tr>'}</tbody></table><div class="table-bottom"><span>共 ${rows.length} 位客户</span><span>第 1 页</span></div></div></div></div>`;
}
function documentView() {
  if (!project.docVersion)
    return `<div class="empty"><h2>${approved() ? "原型准备好了" : "先确认页面，再写清需求"}</h2><p>${approved() ? "基于已通过的原型，整理页面、交互和业务规则。" : "在原型中检查交互，点击「通过此版本」后生成文档。"}</p><button class="primary" data-action="generate-doc" ${approved() ? "" : "disabled"}>生成文档草稿</button></div>`;
  const v = project.versions.find((v) => v.number === project.docVersion);
  return `<article class="paper"><span class="pill">本地演示草稿 · 原型 v${v.number}</span><h2 style="margin-top:20px">${esc(v.title)}优化需求</h2><p>项目：${esc(project.name)}。本草稿基于已通过的原型版本 v${v.number}。</p>${v.number !== project.current ? '<div class="notice">当前候选已变化。这份文档仍对应此前确认版本，请确认新原型后重新生成。</div>' : ""}<h3>目标</h3><p>帮助产品团队快速定位客户，并保持筛选与列表结果一致。</p><h3>页面与交互</h3><ul><li>按客户名称搜索，点击重置后展示全部客户。</li>${v.statusFilter ? "<li>新增状态筛选：全部状态、合作中、跟进中、待联系，与名称条件共同生效。</li>" : ""}<li>新增客户时校验必填名称，取消不保存，保存后更新模拟列表。</li><li>${v.compact ? "使用紧凑表格，减少行间距。" : "使用标准行间距。"}</li></ul><h3>待确认规则</h3><p>不同角色的数据权限尚未确认，不作为已核实需求。</p><div class="notice">这是流程演示，不包含真实模型生成、原型截图或线上发布。</div><button data-action="export-doc">导出 Markdown</button> <button data-action="publish">发布到飞书</button></article>`;
}
function memory() {
  return `<article class="paper"><h2>记忆.md</h2><p>让每次讨论，都从已经知道的地方开始。</p>${project.captured ? '<div class="info-row"><div>客户列表的搜索和新增流程<small>来源：内置客户演示页</small></div><span class="pill">已观察</span></div><div class="info-row"><div>不同角色的数据权限<small>当前页面没有提供权限依据</small></div><span class="pill pending">待验证</span></div>' : '<div class="empty">还没有页面记忆。载入演示页面并点击「理解页面并建立原型」。</div>'}<div class="notice">此页展示记忆结构。正式版本会保存来源、时间和用户确认记录。</div></article>`;
}
function workflow() {
  return `<article class="paper"><h2>当前任务进度</h2>${[
    ["理解页面", project.captured ? "演示依据已整理" : "待开始"],
    ["调整原型", currentVersion() ? `当前 v${project.current}` : "待开始"],
    ["确认版本", approved() ? "已通过" : "等待确认"],
    ["文档草稿", project.docVersion ? `对应 v${project.docVersion}` : "待生成"],
    ["飞书发布", "未连接"],
    ["云效同步", "未连接"],
  ]
    .map(
      ([a, b]) =>
        `<div class="info-row"><span>${a}</span><span class="muted">${b}</span></div>`,
    )
    .join("")}</article>`;
}
function skills() {
  return `<article class="paper"><h2>把熟悉的方法带进来</h2><p>技能将以项目工作流的方式运行，并提前说明所需能力。</p>${[
    ["prd-feishu", "原型确认后撰写并发布 PRD"],
    ["prd-feishu-edit", "读取最新文档，评审差异后合并"],
  ]
    .map(
      ([a, b]) =>
        `<div class="info-row"><div>${a}<small>${b}</small></div><span class="pill pending">待接入</span></div>`,
    )
    .join(
      "",
    )}<div class="notice">技能执行和导入将在正式应用中接入，此原型只用于确认布局与流程。</div></article>`;
}
function settings() {
  return `<article class="paper"><h2>${esc(project.name)}</h2><div class="info-row"><div>工作空间<small>${esc(project.workspace)}</small></div><span class="pill">演示路径</span></div><div class="info-row"><div>模型<small>${model ? esc(model.name) : "尚未配置"}</small></div><button data-action="model">配置</button></div><div class="info-row"><div>飞书<small>${esc(project.connection.feishu) || "设置迭代文档地址"}</small></div><button data-action="connection" data-platform="feishu">设置</button></div><div class="info-row"><div>云效<small>${esc(project.connection.yunxiao) || "设置项目地址"}</small></div><button data-action="connection" data-platform="yunxiao">设置</button></div><div class="notice">演示配置仅在本次页面会话内保留，刷新后重置；请勿输入真实密钥。</div></article>`;
}
function openDialog(title, body) {
  $("#dialog-body").innerHTML =
    `<div class="dialog-head"><h2>${title}</h2><button class="icon" data-action="close" aria-label="关闭弹窗">×</button></div>${body}`;
  $("#dialog").showModal();
}
function closeDialog() {
  $("#dialog").close();
  $("#dialog-body").innerHTML = "";
}
function newProject() {
  openDialog(
    "创建项目",
    `<p class="muted">为一个产品建立独立的工作空间。</p><form id="project-form"><div class="form-field"><label for="project-name">项目名称</label><input id="project-name" maxlength="40" placeholder="例如：会员服务平台" required></div><div class="form-field"><label for="workspace-path">工作空间</label><input id="workspace-path" value="~/Produck/新项目" required><small>演示中仅记录路径，不创建本地文件夹。</small></div><p id="form-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="close">取消</button><button class="primary">创建项目</button></div></form>`,
  );
}
function modelDialog() {
  openDialog(
    "连接你的模型",
    `<div class="notice">配置流程演示，请使用测试占位值。不会发送请求，也不会保存 token。</div><form id="model-form"><div class="form-field"><label for="provider">供应商</label><select id="provider"><option>OpenAI-compatible</option><option>Anthropic</option></select></div><div class="form-field"><label for="endpoint">Base URL</label><input id="endpoint" type="url" required placeholder="https://api.example.com/v1" value="${esc(model?.endpoint || "")}"></div><div class="form-field"><label for="model-name">模型名称</label><input id="model-name" required placeholder="输入模型 ID" value="${esc(model?.name || "")}"></div><div class="form-field"><label for="token">API token（仅演示）</label><input id="token" type="password" autocomplete="off" required placeholder="使用 demo-token，不要填真实密钥"></div><p id="model-result" class="error" role="status"></p><div class="dialog-actions"><button type="button" data-action="mock-test">模拟连接测试</button><button class="primary">保存演示配置</button></div></form>`,
  );
}
function history() {
  openDialog(
    "版本记录",
    project.versions.length
      ? project.versions
          .slice()
          .reverse()
          .map(
            (v) =>
              `<div class="version-row"><div><strong>v${v.number} ${project.approved.includes(v.number) ? "· 已通过" : ""}</strong><small>${esc(v.summary)}</small></div><button data-action="restore" data-version="${v.number}" ${v.number === project.current ? "disabled" : ""}>${v.number === project.current ? "当前版本" : "恢复"}</button></div>`,
          )
          .join("")
      : '<p class="empty">尚未建立原型。</p>',
  );
}
function compare() {
  const v = currentVersion(),
    old = project.versions[0];
  openDialog(
    "与初始版本对比",
    `<p class="muted">v${old.number} → v${v.number}</p><div class="diff-old">初始：${esc(old.title)}，名称搜索，标准表格。</div><div class="diff-add">当前：${esc(v.title)}，${v.statusFilter ? "名称 + 状态筛选" : "名称搜索"}，${v.compact ? "紧凑" : "标准"}表格。</div><div class="dialog-actions"><button data-action="close">返回原型</button></div>`,
  );
}
function generateDoc() {
  if (!approved()) {
    toast("请先通过当前原型版本");
    return;
  }
  project.docVersion = project.current;
  view = "workbench";
  tab = "document";
  render();
  addMessage(
    `已生成对应 v${project.current} 的演示文档草稿。原型确认和文档发布是两个独立步骤。`,
  );
}
function cancelRun() {
  if (!running) return;
  clearTimeout(running.timer);
  running = null;
  $("#send-button").hidden = false;
  $("#cancel-run").hidden = true;
  $("#prompt").disabled = false;
  render();
  addMessage("已取消本次演示修改，当前版本没有变化。");
}
function submitPrompt(text) {
  if (!text.trim()) return;
  if (running) return;
  if (!currentVersion()) {
    toast("请先理解页面并建立原型");
    return;
  }
  addMessage(text, "user");
  const v = { ...currentVersion() },
    next = { ...v };
  let summary = "";
  if (/状态|筛选/.test(text)) {
    next.statusFilter = !/移除|删除|去掉/.test(text);
    summary = next.statusFilter
      ? "增加状态筛选，与名称条件共同生效"
      : "移除状态筛选";
  } else if (/紧凑|行距/.test(text)) {
    next.compact = true;
    summary = "调整为紧凑表格";
  } else if (/标题/.test(text)) {
    const match = text.match(
      /(?:改为|改成|修改为|设为)\s*[“"「]?([^”"」\n]+)[”"」]?/,
    );
    if (match) {
      next.title = match[1]
        .trim()
        .replace(/[。！]$/, "")
        .slice(0, 40);
      summary = `标题改为「${next.title}」`;
    }
  }
  if (!summary) {
    addMessage(
      "这个界面原型只演示三类修改：添加/移除状态筛选、把标题改为「新标题」、调整为紧凑表格。正式应用接入模型后会处理自由描述。",
    );
    return;
  }
  $("#prompt").value = "";
  $("#prompt").disabled = true;
  $("#send-button").hidden = true;
  $("#cancel-run").hidden = false;
  const targetProject = project;
  running = {
    timer: setTimeout(() => {
      running = null;
      next.number =
        Math.max(...targetProject.versions.map((x) => x.number)) + 1;
      next.summary = summary;
      targetProject.versions.push(next);
      targetProject.current = next.number;
      $("#send-button").hidden = false;
      $("#cancel-run").hidden = true;
      $("#prompt").disabled = false;
      tab = "prototype";
      view = "workbench";
      render();
      addMessage(
        `已生成 v${next.number}：${summary}。\n请在原型中体验，满意后点击「通过此版本」。`,
      );
    }, 700),
  };
  $("#primary-action").disabled = true;
}
function connection(platform) {
  openDialog(
    platform === "feishu" ? "飞书连接" : "云效连接",
    `<div class="notice">这里只演示项目配置，不连接外部服务。</div><form id="connection-form" data-platform="${platform}"><div class="form-field"><label for="connection-url">${platform === "feishu" ? "迭代文档地址" : "云效项目地址"}</label><input id="connection-url" type="url" required value="${esc(project.connection[platform])}" placeholder="https://…"></div><div class="dialog-actions"><button type="button" data-action="close">取消</button><button class="primary">保存演示配置</button></div></form>`,
  );
}
function addCustomer() {
  openDialog(
    "新增客户",
    `<form id="customer-form"><div class="form-field"><label for="customer-name">客户名称</label><input id="customer-name" required maxlength="40" placeholder="请输入客户名称"></div><div class="form-field"><label for="customer-owner">负责人</label><select id="customer-owner"><option>陈晓</option><option>林悦</option><option>周舟</option></select></div><p id="form-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="close">取消</button><button class="primary">保存客户</button></div></form>`,
  );
}
document.addEventListener("click", (e) => {
  const element = e.target.closest("[data-element]");
  if (selecting && element && tab === "prototype") {
    e.preventDefault();
    selection = element.dataset.element;
    document
      .querySelectorAll(".selected")
      .forEach((n) => n.classList.remove("selected"));
    element.classList.add("selected");
    $("#selection-context").textContent = `⌖ 已选择：${selection}`;
    return;
  }
  const nav = e.target.closest("[data-view]");
  if (nav) {
    view = nav.dataset.view;
    render();
    return;
  }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  switch (b.dataset.action) {
    case "tab":
      tab = b.dataset.tab;
      selection = "";
      selecting = false;
      render();
      break;
    case "close":
      closeDialog();
      break;
    case "select":
      selecting = !selecting;
      selection = "";
      render();
      break;
    case "history":
      history();
      break;
    case "compare":
      compare();
      break;
    case "restore":
      if (running) cancelRun();
      project.current = Number(b.dataset.version);
      project.filter = "";
      project.status = "全部状态";
      selection = "";
      closeDialog();
      render();
      toast(`已恢复 v${project.current}`);
      break;
    case "reset-filter":
      project.filter = "";
      project.status = "全部状态";
      render();
      break;
    case "add-customer":
      addCustomer();
      break;
    case "capture":
      project.captured = true;
      if (!project.versions.length) {
        project.versions.push({
          number: 1,
          ...baseline(),
          summary: "根据演示页面建立原型",
        });
        project.current = 1;
      }
      tab = "prototype";
      render();
      addMessage("已在演示中整理页面结构并建立原型。权限规则仍待确认。");
      break;
    case "generate-doc":
      generateDoc();
      break;
    case "publish":
      toast("演示模式不发布。正式版本会在文档审阅后连接飞书。");
      break;
    case "model":
      modelDialog();
      break;
    case "connection":
      connection(b.dataset.platform);
      break;
    case "mock-test":
      if ($("#model-form").reportValidity()) {
        $("#model-result").textContent =
          $("#token").value === "demo-fail"
            ? "模拟鉴权失败：请更换演示 token。"
            : "配置格式有效；演示未发送真实连接请求。";
      }
      break;
    case "export-doc": {
      const v = project.versions.find((x) => x.number === project.docVersion);
      const text = `# ${v.title}优化需求\n\n项目：${project.name}\n原型版本：v${v.number}\n\n## 页面交互\n- 名称搜索与重置\n${v.statusFilter ? "- 状态筛选：全部状态、合作中、跟进中、待联系\n" : ""}- 新增客户必填名称，可取消\n- ${v.compact ? "紧凑" : "标准"}表格\n\n## 待确认\n不同角色的数据权限。\n\n此文档为界面演示草稿，未连接真实模型。\n`;
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "Produck-演示需求.md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("已导出演示文档");
      break;
    }
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  switch (e.target.id) {
    case "prompt-form":
      submitPrompt($("#prompt").value);
      break;
    case "project-form": {
      const name = $("#project-name").value.trim(),
        path = $("#workspace-path").value.trim();
      if (!name || !path) {
        $("#form-error").textContent = "请输入项目名称和工作空间";
        return;
      }
      if (projects.some((p) => p.name === name)) {
        $("#form-error").textContent = "项目名称已存在，请换一个名称";
        return;
      }
      if (running) cancelRun();
      project = makeProject(name, path);
      projects.push(project);
      view = "workbench";
      tab = "browser";
      selection = "";
      closeDialog();
      render();
      toast("项目已创建（本次演示会话）");
      break;
    }
    case "model-form":
      model = {
        name: $("#model-name").value.trim(),
        endpoint: $("#endpoint").value.trim(),
        provider: $("#provider").value,
      };
      if (!model.name) {
        $("#model-result").textContent = "请输入模型名称";
        return;
      }
      closeDialog();
      $("#model-button").textContent = `${model.name} · 演示`;
      render();
      toast("演示配置已保存，token 已清除");
      break;
    case "filter-form":
      project.filter = $("#customer-search").value.trim();
      project.status = $("#customer-status")?.value || "全部状态";
      render();
      break;
    case "customer-form": {
      const name = $("#customer-name").value.trim();
      if (!name) {
        $("#form-error").textContent = "客户名称不能为空";
        return;
      }
      if (project.customers.some((c) => c.name === name)) {
        $("#form-error").textContent = "客户已存在";
        return;
      }
      project.customers.push({
        name,
        owner: $("#customer-owner").value,
        status: "待联系",
        industry: "未分类",
      });
      project.filter = "";
      project.status = "全部状态";
      closeDialog();
      render();
      toast("已保存模拟客户");
      break;
    }
    case "url-form": {
      let url;
      try {
        url = new URL($("#page-url").value);
      } catch {
        toast("请输入有效的 https 页面地址");
        return;
      }
      if (url.href !== "https://demo.produck.local/customers") {
        toast("本原型仅支持内置演示地址，不会访问真实网站");
        return;
      }
      toast("已载入内置演示页面");
      break;
    }
    case "connection-form":
      project.connection[e.target.dataset.platform] =
        $("#connection-url").value;
      closeDialog();
      render();
      toast("演示项目配置已保存");
      break;
  }
});
$("#new-project").onclick = newProject;
$("#model-button").onclick = modelDialog;
$("#history-button").onclick = history;
$("#toggle-nav").onclick = () => $(".app").classList.toggle("nav-collapsed");
$("#sample-prompt").onclick = () => {
  $("#prompt").value = "在筛选区域添加客户状态筛选，保留名称搜索";
  $("#prompt").focus();
};
$("#cancel-run").onclick = cancelRun;
$("#primary-action").onclick = () => {
  if (approved()) {
    generateDoc();
    return;
  }
  if (currentVersion()) {
    project.approved.push(project.current);
    render();
    toast(`v${project.current} 已通过，可以生成文档`);
    addMessage(
      `v${project.current} 已固定为确认版本。下一步可以生成文档草稿；继续调整页面会产生新的候选版本。`,
    );
  }
};
$("#project-select").onchange = (e) => {
  if (running) cancelRun();
  project = projects.find((p) => p.id === e.target.value);
  selection = "";
  selecting = false;
  view = "workbench";
  tab = project.current ? "prototype" : "browser";
  render();
};
$("#dialog").addEventListener("cancel", () => {
  $("#dialog-body").innerHTML = "";
});
render();
