import { spawn, execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SkillRepository } from "./repository.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PythonRun } from "../contracts/skills.js";
import { projectPath, atomicWrite } from "../projects/storage.js";
const quote = (text: string) => JSON.stringify(text);
export function pythonSandbox(runtime: string, skill: string, output: string) {
  const executable = join(runtime, "bin/python3.12");
  return `(version 1)(deny default)
 (allow process-exec (literal ${quote(executable)}))
 (allow sysctl-read)(allow file-read-metadata)
 (allow file-read-data (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/private/var/db/dyld") (subpath ${quote(runtime)}) (subpath ${quote(skill)}) (subpath ${quote(output)}) (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
 (allow file-write* (subpath ${quote(output)}))`;
}
function checkOutput(output: string) {
  let bytes = 0,
    count = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 16) throw new Error("结果层级过深");
    for (const name of readdirSync(dir)) {
      if (++count > 200) throw new Error("结果过多");
      const path = join(dir, name),
        info = lstatSync(path);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error("不支持的结果类型");
      if (info.isDirectory()) walk(path, depth + 1);
      else bytes += info.size;
      if (bytes > 16 * 1024 * 1024) throw new Error("结果过大");
    }
  };
  walk(output, 0);
}
const bootstrap = `import resource, runpy, sys, os
resource.setrlimit(resource.RLIMIT_CPU, (10,10))
resource.setrlimit(resource.RLIMIT_FSIZE, (8*1024*1024,8*1024*1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (64,64))
sys.path.insert(0, os.path.dirname(sys.argv[1]))
runpy.run_path(sys.argv[1], run_name='__main__')`;
export class PythonRunner {
  private active = new Set<string>();
  private stops = new Map<string, () => void>();
  cancel(id: string) {
    this.stops.get(id)?.();
  }
  close() {
    for (const stop of this.stops.values()) stop();
  }
  constructor(
    private projects: ProjectRepository,
    private skills: SkillRepository,
    private runtime: string,
  ) {}
  async run(
    id: string,
    skillId: string,
    fingerprint: string,
    input: string,
  ): Promise<PythonRun> {
    if (this.active.has(id)) throw new Error("当前项目已有 Python 任务");
    if (typeof input !== "string" || Buffer.byteLength(input) > 16000)
      throw new Error("脚本输入最多 16000 字节");
    JSON.parse(input);
    const snapshot = this.skills.pythonSnapshot(id, skillId, fingerprint);
    if (!existsSync(join(this.runtime, "bin/python3.12")))
      throw new Error("Python 运行资源缺失，请重新安装完整应用");
    const runtime = realpathSync(this.runtime),
      runId = randomUUID(),
      relativePath = `workflows/python-${runId}`,
      root = projectPath(this.projects.get(id).workspace, relativePath),
      skill = join(root, "skill"),
      output = join(root, "output");
    mkdirSync(output, { recursive: true });
    for (const [path, bytes] of snapshot.files)
      atomicWrite(projectPath(root, `skill/${path}`), bytes);
    const profile = pythonSandbox(
      runtime,
      realpathSync(skill),
      realpathSync(output),
    );
    const startedAt = new Date().toISOString();
    atomicWrite(
      join(root, "intent.json"),
      JSON.stringify({
        skillId,
        fingerprint,
        startedAt,
        capabilities: snapshot.manifest.capabilities,
      }),
    );
    this.active.add(id);
    try {
      return await new Promise<PythonRun>((resolve, reject) => {
        const child = spawn(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            profile,
            join(runtime, "bin/python3.12"),
            "-I",
            "-S",
            "-B",
            "-c",
            bootstrap,
            join(skill, snapshot.manifest.entry),
          ],
          {
            cwd: output,
            env: {
              PATH: "",
              HOME: output,
              TMPDIR: output,
              LANG: "en_US.UTF-8",
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let text = "",
          message = "",
          settled = false;
        const stop = (reason: string) => {
          if (!message) message = reason;
          child.kill("SIGKILL");
        };
        this.stops.set(id, () => stop("用户取消，脚本已停止"));
        const finish = (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(monitor);
          clearInterval(memoryMonitor);
          try {
            checkOutput(output);
          } catch {
            message = "结果目录超过限制或含不支持的文件";
          }
          const row: PythonRun = {
            id: runId,
            skillId,
            fingerprint,
            state: code === 0 && !message ? "succeeded" : "failed",
            startedAt,
            finishedAt: new Date().toISOString(),
            output: text,
            message:
              message ||
              (code === 0
                ? "脚本执行完成，请检查结果"
                : "脚本执行失败或被系统限制"),
            relativePath,
          };
          try {
            atomicWrite(
              join(root, "result.json"),
              JSON.stringify(row, null, 2),
            );
            resolve(row);
          } catch (e) {
            reject(e);
          }
        };
        const timer = setTimeout(
          () => stop("脚本超过 20 秒限制，已停止"),
          20000,
        );
        const monitor = setInterval(() => {
          try {
            checkOutput(output);
          } catch {
            stop("结果目录超过限制或含不支持的文件，已停止");
          }
        }, 100);
        let readingMemory = false;
        const memoryMonitor = setInterval(() => {
          if (readingMemory || !child.pid || settled) return;
          readingMemory = true;
          execFile(
            "/bin/ps",
            ["-o", "rss=", "-p", String(child.pid)],
            { timeout: 1000 },
            (error, stdout) => {
              readingMemory = false;
              if (!error && !settled && Number(stdout.trim()) > 256 * 1024)
                stop("脚本内存超过 256 MB，已停止");
            },
          );
        }, 250);
        const receive = (data: Buffer) => {
          if (Buffer.byteLength(text) + data.length > 64000) {
            stop("脚本输出超过限制，已停止");
            return;
          }
          text += data.toString("utf8");
        };
        child.stdout.on("data", receive);
        child.stderr.on("data", receive);
        child.stdin.on("error", () => {});
        child.once("error", () => {
          message = "Python 隔离进程无法启动";
          finish(null);
        });
        child.once("close", finish);
        child.stdin.end(input);
      });
    } finally {
      this.stops.delete(id);
      this.active.delete(id);
    }
  }
}
