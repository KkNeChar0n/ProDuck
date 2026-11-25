import { setTimeout as delay } from "node:timers/promises";
export interface DragData {
  items: { mimeType: string; data: string; title?: string; baseURL?: string }[];
  dragOperationsMask: number;
  files?: string[];
}
type Point = { x: number; y: number };
/** Real input events for pointer-based widgets; reuse Chrome's DragData for HTML5. */
export async function performDrag(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  intercepted: () => DragData | undefined,
  from: Point,
  to: Point,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (Math.hypot(to.x - from.x, to.y - from.y) < 4)
    throw new Error("拖拽起点和终点过近，请指定不同位置");
  let pressed = false,
    completed = false,
    entered = false;
  let position = from;
  try {
    await send("Input.setInterceptDrags", { enabled: true });
    signal.throwIfAborted();
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...from,
      buttons: 0,
    });
    signal.throwIfAborted();
    pressed = true;
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...from,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 24; step++) {
      signal.throwIfAborted();
      position = {
        x: from.x + ((to.x - from.x) * step) / 24,
        y: from.y + ((to.y - from.y) * step) / 24,
      };
      const data = intercepted();
      if (data) {
        if (data.files?.length) throw new Error("不支持通过拖拽上传本地文件");
        if (!entered) {
          await send("Input.dispatchDragEvent", {
            type: "dragEnter",
            ...position,
            data,
          });
          entered = true;
        }
        await send("Input.dispatchDragEvent", {
          type: "dragOver",
          ...position,
          data,
        });
      } else {
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...position,
          button: "left",
          buttons: 1,
        });
      }
      await delay(20, undefined, { signal });
    }
    signal.throwIfAborted();
    const data = intercepted();
    if (data) {
      if (data.files?.length) throw new Error("不支持通过拖拽上传本地文件");
      if (!entered)
        await send("Input.dispatchDragEvent", {
          type: "dragEnter",
          ...to,
          data,
        });
      await send("Input.dispatchDragEvent", { type: "dragOver", ...to, data });
      signal.throwIfAborted();
      await send("Input.dispatchDragEvent", { type: "drop", ...to, data });
    }
    signal.throwIfAborted();
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...to,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    pressed = false;
    completed = true;
  } finally {
    // Cancellation does not imply rollback: pointer widgets may already have changed.
    if (!completed && pressed) {
      const data = intercepted();
      if (data)
        await send("Input.dispatchDragEvent", {
          type: "dragCancel",
          ...position,
          data,
        }).catch(() => {});
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      }).catch(() => {});
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      }).catch(() => {});
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...position,
        button: "left",
        buttons: 0,
        clickCount: 1,
      }).catch(() => {});
    }
    await send("Input.setInterceptDrags", { enabled: false }).catch(() => {});
  }
}
