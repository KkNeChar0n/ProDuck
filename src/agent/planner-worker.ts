import { streamModel, type ModelRequest } from "./model-client.js";
process.parentPort.on("message", async ({ data }: { data: ModelRequest }) => {
  try {
    let text = "";
    for await (const chunk of streamModel({ ...data, maxTokens: 4096 })) {
      text += chunk;
      if (text.length > 20000) throw new Error("规划响应超过限制");
    }
    process.parentPort.postMessage({ text });
  } catch (e) {
    process.parentPort.postMessage({
      error: e instanceof Error ? e.message : "模型规划失败",
    });
  }
});
