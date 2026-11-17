import { DatabaseSync } from "node:sqlite";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  readdirSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";

/** Atomic file replacement. A crash can leave only a removable temporary file. */
export function atomicWrite(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.produck-write-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(
      temp,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

/** Called while the project is exclusively owned by this process, before new writes. */
export function discardInterruptedWrites(directory: string): number {
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^\.produck-write-[0-9a-f-]{36}\.tmp$/.test(entry.name)
    ) {
      unlinkSync(join(directory, entry.name));
      count++;
    } else if (entry.isDirectory())
      count += discardInterruptedWrites(join(directory, entry.name));
  }
  return count;
}

/** Reject traversal and symlink escapes before handing paths to project tools. */
export function projectPath(root: string, input: string): string {
  if (isAbsolute(input)) throw new Error("Project paths must be relative");
  const canonicalRoot = realpathSync(root);
  const target = resolve(canonicalRoot, input);
  const rel = relative(canonicalRoot, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Path outside project workspace");
  let cursor = canonicalRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (
      existsSync(cursor) ||
      (() => {
        try {
          return lstatSync(cursor).isSymbolicLink();
        } catch {
          return false;
        }
      })()
    ) {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("Symlink project paths are not supported");
    }
  }
  return target;
}

const schema = `
CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE model_profiles(id TEXT PRIMARY KEY, provider TEXT NOT NULL, endpoint TEXT NOT NULL, model TEXT NOT NULL, credential_ref TEXT);
CREATE TABLE connections(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL, config_json TEXT NOT NULL, credential_ref TEXT, UNIQUE(project_id,provider));
CREATE TABLE task_runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE step_runs(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES task_runs(id), state TEXT NOT NULL, input_ref TEXT, output_ref TEXT);
CREATE TABLE artifact_versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), baseline_id TEXT REFERENCES artifact_versions(id), relative_path TEXT NOT NULL, content_hash TEXT NOT NULL, source_refs_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE approvals(id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifact_versions(id), content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE sync_receipts(id TEXT PRIMARY KEY, step_id TEXT NOT NULL REFERENCES step_runs(id), provider TEXT NOT NULL, remote_id TEXT, state TEXT NOT NULL, result_json TEXT NOT NULL);
`;
export interface Migration {
  version: number;
  sql: string;
}
export const migrations: Migration[] = [
  { version: 1, sql: schema },
  {
    version: 2,
    sql: "CREATE TABLE model_capabilities(project_id TEXT PRIMARY KEY REFERENCES projects(id), report_json TEXT NOT NULL);",
  },
];

export function openProjectDatabase(
  path: string,
  steps: Migration[] = migrations,
): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path);
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
  );
  const current = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
  const latest = steps.at(-1)?.version ?? 0;
  if (current > latest) {
    db.close();
    throw new Error(
      "Database is newer than this application; downgrade refused",
    );
  }
  if (current === latest) return db;
  const backup = `${path}.v${current}.backup`;
  try {
    if (existed) copyFileSync(path, backup);
    db.exec("BEGIN IMMEDIATE");
    for (const migration of steps.filter((s) => s.version > current)) {
      if (!Number.isSafeInteger(migration.version) || migration.version < 1)
        throw new Error("Invalid migration version");
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version=${migration.version}`);
    }
    db.exec("COMMIT");
    return db;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* BEGIN may have failed. */
    }
    db.close();
    if (existed && existsSync(backup)) copyFileSync(backup, path);
    throw error;
  }
}
