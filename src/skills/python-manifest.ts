export interface PythonSkill {
  entry: string;
  runtime: "python3.12";
  dependencies: string[];
  capabilities: { read: "skill"; write: "output"; network: false };
}
export function parsePythonManifest(text: string): PythonSkill {
  const value = JSON.parse(text);
  if (
    !value ||
    Object.keys(value).some(
      (k) => !["entry", "runtime", "dependencies", "capabilities"].includes(k),
    ) ||
    value.runtime !== "python3.12" ||
    typeof value.entry !== "string" ||
    !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.py$/.test(value.entry)
  )
    throw new Error("Python 声明格式无效：需要 python3.12 与包内 .py 入口");
  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.some((x: unknown) => typeof x !== "string")
  )
    throw new Error("请声明 dependencies 数组");
  if (value.dependencies.length)
    throw new Error("当前仅支持 Python 标准库，额外依赖尚未打包");
  const c = value.capabilities;
  if (
    !c ||
    Object.keys(c).sort().join() !== "network,read,write" ||
    c.read !== "skill" ||
    c.write !== "output" ||
    c.network !== false
  )
    throw new Error(
      "当前只支持读取技能包、写入结果目录，禁止网络；不能申请其他范围",
    );
  return value as PythonSkill;
}
