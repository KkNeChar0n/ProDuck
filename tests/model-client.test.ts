import { test } from "node:test";
import assert from "node:assert/strict";
import {
  streamModel,
  testModel,
  validateEndpoint,
  type ModelRequest,
} from "../src/agent/model-client.js";
const input: ModelRequest = {
  provider: "openai-compatible",
  endpoint: "https://example.com/v1",
  model: "fixture",
  token: "synthetic-secret",
  prompt: "Hello",
};
const transport = (response: Response) => async () => response;
function sse(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );
}
test("SSE text survives arbitrary chunk boundaries and stops at DONE", async () => {
  const values = [];
  for await (const text of streamModel(
    input,
    transport(
      sse([
        'data: {"choices":[{"delta":{"con',
        'tent":"你好"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ) as typeof fetch,
  ))
    values.push(text);
  assert.equal(values.join(""), "你好");
});
test("Anthropic uses messages headers and parses text deltas", async () => {
  const values = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://example.com/v1/messages");
    assert.equal((init?.headers as any)["x-api-key"], "synthetic-secret");
    assert.equal(init?.redirect, "error");
    return sse([
      'data: {"type":"content_block_delta","delta":{"text":"OK"}}\n\ndata: {"type":"message_stop"}\n\n',
    ]);
  };
  for await (const text of streamModel(
    { ...input, provider: "anthropic" },
    fetcher,
  ))
    values.push(text);
  assert.equal(values.join(""), "OK");
});
test("connection errors classify auth, model and quota without exposing server response", async () => {
  for (const [status, pattern] of [
    [401, /鉴权/],
    [404, /不存在/],
    [429, /受限/],
  ] as const)
    await assert.rejects(
      testModel(
        input,
        transport(new Response("synthetic-secret", { status })) as typeof fetch,
      ),
      pattern,
    );
});
test("truncated streams do not report success", async () => {
  await assert.rejects(async () => {
    for await (const _ of streamModel(
      input,
      transport(sse(['data: {"choices":[]}\n\n'])) as typeof fetch,
    )) {
    }
  }, /提前中断/);
});
test("connection test validates response schema and endpoints reject credentials", async () => {
  await testModel(
    input,
    transport(
      Response.json({ choices: [{ message: { content: "OK" } }] }),
    ) as typeof fetch,
  );
  await assert.rejects(
    testModel(input, transport(Response.json({ ok: true })) as typeof fetch),
    /不兼容/,
  );
  assert.throws(() => validateEndpoint("https://user:secret@example.com"));
  assert.throws(() => validateEndpoint("https://example.com/?key=secret"));
});

test("SSE accepts CRLF split between network chunks", async () => {
  const output = [];
  for await (const text of streamModel(
    input,
    transport(
      sse([
        'data: {"choices":[{"delta":{"content":"OK"}}]}\r',
        "\n\r",
        "\ndata: [DONE]\r\n\r\n",
      ]),
    ) as typeof fetch,
  ))
    output.push(text);
  assert.equal(output.join(""), "OK");
});
test("cancelled fetch is reported as cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    testModel({ ...input, signal: controller.signal }, async () => {
      throw new DOMException("aborted", "AbortError");
    }),
    /已取消/,
  );
});

test("capability probes distinguish accepted images and native tool responses for both providers", async () => {
  const { probeCapabilities } = await import("../src/agent/model-client.js");
  for (const provider of ["openai-compatible", "anthropic"] as const) {
    const calls: any[] = [];
    const transport = (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      if (body.tools)
        return new Response(
          JSON.stringify(
            provider === "anthropic"
              ? {
                  content: [
                    {
                      type: "tool_use",
                      name: "produck_probe",
                      input: { result: "OK" },
                    },
                  ],
                }
              : {
                  choices: [
                    {
                      message: {
                        tool_calls: [
                          {
                            function: {
                              name: "produck_probe",
                              arguments: '{"result":"OK"}',
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
          ),
        );
      return new Response(
        JSON.stringify(
          provider === "anthropic"
            ? { content: [{ type: "text", text: "OK" }] }
            : { choices: [{ message: { content: "OK" } }] },
        ),
      );
    }) as typeof fetch;
    const report = await probeCapabilities(
      {
        provider,
        endpoint: "https://example.com/v1",
        model: "fixture",
        token: "synthetic",
        prompt: "test",
      },
      transport,
    );
    assert.equal(report.text, "supported");
    assert.equal(report.image, "supported");
    assert.equal(report.tools, "supported");
    assert.equal(calls.length, 3);
    assert(Array.isArray(calls[1].messages[0].content));
  }
});
test("unsupported image payload and missing tool call do not report supported capability", async () => {
  const { probeCapabilities } = await import("../src/agent/model-client.js");
  let n = 0;
  const report = await probeCapabilities(
    {
      provider: "openai-compatible",
      endpoint: "https://example.com/v1",
      model: "text-only",
      token: "synthetic",
      prompt: "test",
    },
    (async () => {
      n++;
      return n === 2
        ? new Response("{}", { status: 400 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
          );
    }) as typeof fetch,
  );
  assert.equal(report.image, "unsupported");
  assert.equal(report.tools, "unsupported");
});

test("reasoning effort is sent only when explicitly selected on compatible requests", async () => {
  for (const effort of [
    undefined,
    "default",
    "low",
    "medium",
    "high",
    "xhigh",
  ] as const) {
    await testModel({ ...input, reasoningEffort: effort }, (async (
      _url,
      init,
    ) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.reasoning_effort,
        effort === "default" ? undefined : effort,
      );
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
      );
    }) as typeof fetch);
  }
});
