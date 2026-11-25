import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureModule,
  updateCoverage,
  needsMoreExploration,
  coverageMarkdown,
  unfinished,
} from "../src/discovery/coverage.js";
import { businessActionIdentity } from "../src/discovery/browser-policy.js";
import type {
  DiscoveryRun,
  DiscoveryPage,
} from "../src/contracts/discovery.js";
function run(): DiscoveryRun {
  return {
    id: "run",
    projectId: "project",
    releaseId: "release",
    url: "https://example.test/",
    goal: "",
    budget: 40,
    state: "running",
    message: "",
    createdAt: "",
    captureIds: ["a", "b", "c"],
    steps: [
      {
        captureId: "a",
        observation: "",
        result: "",
        module: "客户",
        flow: "create",
        executed: true,
        submitted: true,
        businessActionKey: "v3:key",
      },
      { captureId: "b", observation: "", result: "" },
      { captureId: "c", observation: "", result: "" },
    ],
    sources: [],
  };
}
test("depth defaults include both flows; evidence and performed save govern completeness", () => {
  const r = run();
  ensureModule(r, "客户");
  assert.equal(r.coverage?.length, 2);
  assert(needsMoreExploration(r));
  const full = {
    module: "客户",
    flow: "create",
    checks: ["entry", "fields", "validation", "cancel", "save"],
    evidenceIds: ["b"],
    detail: "字段及保存后列表已观察",
    limitation: "",
  };
  assert.deepEqual(updateCoverage(r, [full]), []);
  assert.equal(unfinished(r).length, 1);
  assert(
    updateCoverage(r, [{ ...full, flow: "edit" }])[0].includes("保持未验证"),
  );
  assert(!r.coverage![1].checks.includes("save"));
  assert.throws(
    () => updateCoverage(r, [{ ...full, evidenceIds: ["invented"] }]),
    /依据/,
  );
  updateCoverage(r, [
    {
      ...full,
      flow: "edit",
      checks: ["entry", "fields"],
      limitation: "用户跳过保存；校验和取消尚未体验",
    },
  ]);
  assert.equal(needsMoreExploration(r), false);
  assert.equal(unfinished(r).length, 1);
  assert(coverageMarkdown(r).includes("编辑（未完整覆盖）"));
  assert(coverageMarkdown(r).includes("[ ] 保存后结果"));
  const resumed = JSON.parse(JSON.stringify(r));
  assert.deepEqual(resumed.coverage, r.coverage);
});
test("pre-submit evidence or unexecuted confirmation cannot establish save success", () => {
  const r = run();
  ensureModule(r, "客户");
  const u = {
    module: "客户",
    flow: "create",
    checks: ["save"],
    evidenceIds: ["a"],
    detail: "尚未出现结果",
    limitation: "",
  };
  updateCoverage(r, [u]);
  assert.deepEqual(r.coverage![0].checks, []);
  r.steps[0].submitted = false;
  updateCoverage(r, [{ ...u, evidenceIds: ["b"] }]);
  assert.deepEqual(r.coverage![0].checks, []);
  r.steps[0].submitted = true;
  r.steps[0].executed = false;
  updateCoverage(r, [{ ...u, evidenceIds: ["b"] }]);
  assert.deepEqual(r.coverage![0].checks, []);
});
test("reused form separates create/edit context but field edits do not bypass the identity", () => {
  const p: DiscoveryPage = {
    title: "客户",
    url: "https://example.test",
    text: "",
    structure: "",
    fingerprint: "",
    blocked: [],
    elements: [
      {
        index: 0,
        tag: "BUTTON",
        role: "",
        type: "submit",
        label: "保存",
        inForm: true,
        submitsForm: true,
        form: {
          key: "#form",
          context: "新增客户",
          action: "https://example.test",
          method: "get",
          search: false,
          submitLabels: ["保存"],
          sensitive: false,
          valid: true,
          noValidate: false,
        },
      },
    ],
  };
  const create = businessActionIdentity(p, { kind: "click", index: 0 });
  p.elements[0].form!.context = "编辑客户";
  assert.notEqual(
    create,
    businessActionIdentity(p, { kind: "click", index: 0 }),
  );
  const edit = businessActionIdentity(p, { kind: "click", index: 0 });
  p.elements[0].value = "another";
  assert.equal(edit, businessActionIdentity(p, { kind: "click", index: 0 }));
});
