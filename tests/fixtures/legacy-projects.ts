import type { DatabaseSync } from "node:sqlite";
import { ProjectRepository as Repository } from "../../src/projects/repository.js";
/** Existing workflow suites exercise migrated projects whose default release keeps old paths. */
export class ProjectRepository extends Repository {
  constructor(private fixtureDb: DatabaseSync, statePath: string) { super(fixtureDb, statePath); }
  override create(name: string, parent: string) {
    const project = super.create(name, parent);
    this.fixtureDb.prepare("INSERT INTO releases VALUES(?,?,?,?,?,?)").run(project.id, project.id, "默认版本", "", "", project.createdAt);
    return project;
  }
}
