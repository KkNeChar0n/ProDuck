import type { DiscoveryAction, DiscoveryPage } from "../contracts/discovery.js";
import { parseWebDestination } from "../desktop/navigation.js";
const mutation =
  /删除|保存|提交|发布|支付|购买|确认|授权|退出|登出|启用|停用|禁用|发送|执行|部署|签发|吊销|续期|上传|导出|下载|重置密码|delete|remove|save|submit|publish|pay|purchase|confirm|authorize|logout|sign.?out|enable|disable|send|execute|deploy|revoke|upload|export|download/i;
export function requestAllowed(
  url: string,
  method: string,
  origin: string,
  document: boolean,
) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
      return false;
    if (
      /(?:^|\/)(delete|remove|logout|signout|revoke|activate|deactivate|publish|submit|save)(?:\/|$)/i.test(
        u.pathname,
      )
    )
      return false;
    if (document && u.origin !== origin) return false;
    return !u.username && !u.password;
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
  if (action.kind === "finish") {
    if (typeof action.reason !== "string" || action.reason.length > 1000)
      throw new Error("结束说明无效");
    return;
  }
  if (action.kind === "back") return;
  if (action.kind === "scroll" && ["up", "down"].includes(action.direction))
    return;
  if (
    !["click", "fill", "select"].includes(action.kind) ||
    !("index" in action) ||
    !Number.isInteger(action.index)
  )
    throw new Error("不支持的探索动作");
  const element = page.elements.find((e) => e.index === action.index);
  if (!element) throw new Error("元素已变化，请重新观察");
  if (mutation.test(element.label))
    throw new Error(`需要手动体验此操作：${element.label}`);
  if (action.kind === "fill") {
    if (
      typeof action.value !== "string" ||
      action.value.length > 200 ||
      !/search|搜索|查询|筛选|关键词|关键字|过滤/i.test(
        element.label + " " + element.type,
      )
    )
      throw new Error("自动输入仅限搜索与筛选，请手动体验业务表单");
  } else if (action.kind === "select") {
    if (
      typeof action.value !== "string" ||
      element.tag !== "SELECT" ||
      !element.options?.includes(action.value)
    )
      throw new Error("下拉选项无效");
  } else if (element.href) {
    const url = parseWebDestination(element.href);
    if (!requestAllowed(url, "GET", origin, true))
      throw new Error("链接超出当前站点或涉及业务变更，请手动体验");
  } else if (
    !/查看|详情|展开|收起|筛选|搜索|查询|重置|取消|关闭|返回|下一页|上一页|新增|新建|编辑|设置|列表|概览|管理|view|detail|expand|collapse|filter|search|reset|cancel|close|back|next|previous|add|create|edit|settings|list|overview/i.test(
      element.label,
    ) &&
    !["tab", "treeitem"].includes(element.role)
  ) {
    throw new Error(
      `不能确认此控件是查看操作，请手动体验：${element.label || element.tag}`,
    );
  }
}
