import { test } from "node:test";
import assert from "node:assert/strict";
import { listModels } from "../src/agent/model-catalog.js";
const input = {
  provider: "anthropic" as const,
  endpoint: "https://example.com/v1",
  token: "synthetic",
};
test("Anthropic catalog follows bounded cursor pagination and uses provider authentication", async () => {
  let calls = 0;
  assert.deepEqual(
    await listModels(input, async (url, init) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>)["x-api-key"],
        "synthetic",
      );
      if (calls === 1)
        return Response.json({
          data: [{ id: "a" }],
          has_more: true,
          last_id: "a",
        });
      assert.match(String(url), /after_id=a/);
      return Response.json({ data: [{ id: "b" }], has_more: false });
    }),
    ["a", "b"],
  );
});
test("catalog rejects malformed and failed responses without exposing response bodies", async () => {
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      listModels(input, async () => new Response("SECRET", { status })),
      (e) => e instanceof Error && !e.message.includes("SECRET"),
    );
  await assert.rejects(
    listModels(input, async () => Response.json(null)),
    /格式/,
  );
  await assert.rejects(
    listModels(input, async () => {
      throw new Error("SECRET");
    }),
    /网络/,
  );
});
