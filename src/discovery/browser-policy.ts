import type { DiscoveryAction, DiscoveryPage } from "../contracts/discovery.js";
import { parseWebDestination } from "../desktop/navigation.js";
const mutation =
  /删除|保存|提交|发布|支付|购买|确认|确定|授权|退出|登出|启用|停用|禁用|发送|执行|部署|签发|吊销|续期|上传|导出|下载|重置密码|delete|remove|save|submit|publish|pay|purchase|confirm|authorize|logout|sign.?out|enable|disable|send|execute|deploy|revoke|upload|export|download/i;
const mutationPath =
  /(?:^|\/)(delete|remove|logout|signout|revoke|activate|deactivate|publish|submit|save|write|update|create|insert|pay|purchase|send|deploy)(?:\/|$)/i;
export function requestAllowed(
  url: string,
  method: string,
  origin: string,
  document: boolean,
  allowWrite = false,
  body = "",
) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return false;
    if (document && u.origin !== origin) return false;
    if (
      !allowWrite &&
      (!["GET", "HEAD", "OPTIONS", "POST"].includes(method.toUpperCase()) ||
        mutationPath.test(u.pathname) ||
        /\bmutation\s*(?:[({]|[A-Za-z_])/i.test(body))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
export function validateDiscoveryAction(
  page: DiscoveryPage,
  action: DiscoveryAction,
  origin: string,
) {
  if (!action || typeof action !== "object")
    throw new Error("探索动作格式无效");
  if (
    action.effect !== undefined &&
    !["read", "write", "unknown"].includes(action.effect)
  )
    throw new Error("操作后果分类无效");
  if (action.kind === "finish") {
    if (typeof action.reason !== "string" || action.reason.length > 1000)
      throw new Error("结束说明无效");
    return;
  }
  if (action.kind === "back") return;
  if (action.kind === "scroll" && ["up", "down"].includes(action.direction))
    return;
  if (
    !["click", "fill", "select", "press"].includes(action.kind) ||
    !("index" in action) ||
    !Number.isInteger(action.index)
  )
    throw new Error("不支持的探索动作");
  const element = page.elements.find((e) => e.index === action.index);
  if (!element) throw new Error("元素已变化，请重新观察");
  if (action.kind === "fill") {
    if (
      !["INPUT", "TEXTAREA"].includes(element.tag) ||
      ["password", "file", "hidden"].includes(element.type) ||
      typeof action.value !== "string" ||
      action.value.length > 2000
    )
      throw new Error("目标不是可输入的普通表单控件");
  } else if (action.kind === "select") {
    if (
      typeof action.value !== "string" ||
      element.tag !== "SELECT" ||
      !element.options?.includes(action.value)
    )
      throw new Error("下拉选项无效");
  } else if (action.kind === "press") {
    if (
      ![
        "Enter",
        "Escape",
        "Tab",
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Space",
      ].includes(action.key)
    )
      throw new Error("不支持的按键");
  } else if (element.href) {
    const url = parseWebDestination(element.href);
    if (new URL(url).origin !== origin)
      throw new Error("此链接超出已授权站点，请选择站内入口");
  }
}
/** Ordinary controls need no name allowlist. Host retains final write confirmation. */
export function actionConfirmation(
  page: DiscoveryPage,
  action: DiscoveryAction,
): string | null {
  if (
    action.kind === "finish" ||
    action.kind === "scroll" ||
    action.kind === "back"
  )
    return null;
  const el = page.elements.find((e) => e.index === action.index);
  if (!el) return null;
  const mutatingKey =
    action.kind === "press" && ["Enter", "Space"].includes(action.key);
  if (
    action.effect === "write" ||
    action.effect === "unknown" ||
    ((action.kind === "click" || mutatingKey) &&
      (mutation.test(el.label) ||
        (action.kind === "click" && el.submitsForm) ||
        (action.kind === "press" &&
          action.key === "Enter" &&
          el.inForm &&
          el.tag !== "TEXTAREA") ||
        (el.href && mutationPath.test(new URL(el.href).pathname))))
  )
    return `${action.kind === "fill" ? "输入" : action.kind === "select" ? "选择" : action.kind === "press" ? `按 ${action.key}` : "点击"}「${el.label || el.tag}」可能修改业务数据或产生其他实际后果。`;
  return null;
}
