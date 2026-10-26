import { logger } from "./logger";

/** Project and team ids in Figma URLs are numeric. Anything else never reaches the API path. */
const NUMERIC_ID_RE = /^[0-9]{3,}$/;

const API = "https://api.figma.com/v1";

export interface ProjectFile {
  key: string;
  name: string;
  last_modified?: string;
}

export interface ProjectContext {
  projectId: string;
  projectName: string;
  files: ProjectFile[];
  fetchedAt: number;
}

/** The REST token is read-only by design — it lists files, it never edits them. */
function getToken(): string | null {
  return process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? null;
}

export function hasToken(): boolean {
  return getToken() !== null;
}

async function figmaRest<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error("FIGMA_TOKEN is not set. A read-only personal access token is needed to list project files.");
  }
  const res = await fetch(`${API}${path}`, { headers: { "X-Figma-Token": token } });
  if (res.status === 403) {
    throw new Error("Figma rejected the token (403). Check that it is valid and can read this project.");
  }
  if (res.status === 404) {
    throw new Error(`Not found (404): ${path}. Check the id, and that the token's account can see it.`);
  }
  if (!res.ok) {
    throw new Error(`Figma REST ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

/** The files of one project. Reaching a file still needs its plugin — see ensureFileOpen. */
export async function listProjectFiles(projectId: string): Promise<{ projectName: string; files: ProjectFile[] }> {
  if (!NUMERIC_ID_RE.test(projectId)) throw new Error(`Invalid project id: ${projectId}`);
  const data = await figmaRest<{ name: string; files: ProjectFile[] }>(`/projects/${projectId}/files`);
  return { projectName: data.name, files: data.files ?? [] };
}

export async function listTeamProjects(teamId: string): Promise<{ id: string; name: string }[]> {
  if (!NUMERIC_ID_RE.test(teamId)) throw new Error(`Invalid team id: ${teamId}`);
  const data = await figmaRest<{ projects: { id: string; name: string }[] }>(`/teams/${teamId}/projects`);
  return data.projects ?? [];
}

/* ------------------------------------------------------------------ *
 * Session project context
 * ------------------------------------------------------------------ */

let context: ProjectContext | null = null;

export function setProjectContext(ctx: ProjectContext): void {
  context = ctx;
  logger.info(`Project context set: ${ctx.projectName} (${ctx.files.length} file(s))`);
}

export function getProjectContext(): ProjectContext | null {
  return context;
}

export type FileLookup =
  | { kind: "hit"; file: ProjectFile }
  | { kind: "none"; available: string[] }
  | { kind: "ambiguous"; matches: ProjectFile[] };

/**
 * Resolve a file within the connected project by key or by name.
 * Name matching is a case-insensitive substring, so an ambiguous query is reported
 * rather than guessed at — picking the wrong file here would edit the wrong file.
 */
export function resolveProjectFile(query: string, ctx: ProjectContext): FileLookup {
  const exact = ctx.files.find((f) => f.key === query);
  if (exact) return { kind: "hit", file: exact };

  const needle = query.toLowerCase();
  const matches = ctx.files.filter((f) => f.name.toLowerCase().includes(needle));
  if (matches.length === 1) return { kind: "hit", file: matches[0] };
  if (matches.length === 0) return { kind: "none", available: ctx.files.map((f) => f.name) };
  return { kind: "ambiguous", matches };
}
