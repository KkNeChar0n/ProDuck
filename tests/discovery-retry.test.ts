import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDiscovery } from "../src/discovery/retry.js";

test("transient failure gets exactly three retries and recovers without replaying actions", async () => {
  let calls = 0,
    actions = 0;
  const notices: number[] = [];
  const result = await retryDiscovery(
    async () => {
      if (++calls < 4) throw new Error("connection reset");
      return "decision";
    },
    new AbortController().signal,
    (n) => notices.push(n),
    0,
  );
  if (result === "decision") actions++;
  assert.equal(calls, 4);
  assert.equal(actions, 1);
  assert.deepEqual(notices, [1, 2, 3]);
});
test("exhaustion stops after four total attempts", async () => {
  let calls = 0;
  await assert.rejects(
    retryDiscovery(
      async () => {
        calls++;
        throw new Error("offline");
      },
      new AbortController().signal,
      () => {},
      0,
    ),
    /自动重试 3 次后仍失败/,
  );
  assert.equal(calls, 4);
});
test("cancellation during backoff and authentication errors do not retry", async () => {
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(
    retryDiscovery(
      async () => {
        calls++;
        throw new Error("offline");
      },
      controller.signal,
      () => controller.abort(),
      1000,
    ),
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    retryDiscovery(
      async () => {
        calls++;
        throw new Error("模型鉴权失败");
      },
      new AbortController().signal,
      () => assert.fail(),
      0,
    ),
    /鉴权/,
  );
  assert.equal(calls, 1);
});
