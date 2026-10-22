import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type NoteFormat = "markdown" | "org";
export type NoteState = "NONE" | "TODO" | "DONE";
export type NotePriority = "A" | "B" | "C";

export interface Metadata {
  state: NoteState;
  priority?: NotePriority;
  scheduled?: string;
  deadline?: string;
  tags: string[];
}

export interface MetadataPatch {
  state?: NoteState;
  priority?: NotePriority;
  scheduled?: string;
  deadline?: string;
  tags?: string[];
}

export interface NoteInput {
  title?: string;
  body: string;
  metadata?: Metadata;
}

export interface RenderInput {
  title: string;
  body: string;
  explicitTitle: boolean;
  date: Date;
  creationDate?: Date;
  metadata?: Metadata;
  markdownUnknownLines?: string[];
  created?: string;
}

export interface ParsedNote {
  format: NoteFormat;
  title: string;
  body: string;
  explicitTitle: boolean;
  metadata: Metadata;
  created?: string;
  creationDate?: Date;
  markdownUnknownLines: string[];
}

export interface NoteFile extends ParsedNote {
  path: string;
  mtimeMs: number;
}

export interface EditResult {
  conflict: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const emptyMetadata = (): Metadata => ({ state: "NONE", tags: [] });
const withoutFinalNewline = (value: string): string =>
  value.endsWith("\n") ? value.slice(0, -1) : value;
const dateParts = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

export function isDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateParts(date) === value;
}

export function dateFromString(value: string | undefined): Date | null {
  if (!value || !isDateString(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function normalizeTags(value: string | string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of (Array.isArray(value) ? value.join(" ") : value).split(/[,\s]+/)) {
    const tag = part.replace(/^[#:]+/, "").replace(/[^A-Za-z0-9_@#%]/g, "");
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export function cycleState(state: NoteState): NoteState {
  if (state === "TODO") return "DONE";
  if (state === "DONE") return "NONE";
  return "TODO";
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "note";
}

export function deriveTitle(title: string | undefined, body: string): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) return trimmedTitle;
  const firstLine = body.split(/\r?\n/).find((line) => line.trim());
  return firstLine?.replace(/^[#*\s]+/, "").trim() ?? "";
}

function orgDate(value: string): string {
  const date = dateFromString(value);
  if (!date) throw new Error(`Invalid date: ${value}`);
  return `${value} ${weekdays[date.getDay()]}`;
}

function renderMarkdown(input: RenderInput, metadata: Metadata): string {
  const lines = ["---"];
  if (input.title) lines.push(`title: ${input.title}`);
  if (metadata.state !== "NONE") lines.push(`status: ${metadata.state.toLowerCase()}`);
  if (metadata.priority) lines.push(`priority: ${metadata.priority}`);
  if (metadata.scheduled) lines.push(`scheduled: ${metadata.scheduled}`);
  if (metadata.deadline) lines.push(`due: ${metadata.deadline}`);
  if (metadata.tags.length) lines.push(`tags: [${metadata.tags.join(", ")}]`);
  lines.push(`created: ${input.created ?? input.date.toISOString()}`);
  lines.push(...(input.markdownUnknownLines ?? []), "---");
  if (input.explicitTitle) lines.push(`# ${input.title}`, "");
  lines.push(input.body);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function renderOrg(input: RenderInput, metadata: Metadata): string {
  const created = input.creationDate ?? input.date;
  const createdDate = dateParts(created);
  const createdTime = `${pad(created.getHours())}:${pad(created.getMinutes())}`;
  const state = metadata.state === "NONE" ? "" : `${metadata.state} `;
  const priority = metadata.priority ? `[#${metadata.priority}] ` : "";
  const lines = [
    `#+title: ${input.title}`,
    `#+date: [${createdDate} ${weekdays[created.getDay()]} ${createdTime}]`,
  ];
  if (metadata.tags.length) lines.push(`#+filetags: :${metadata.tags.join(":")}:`);
  lines.push(`* ${state}${priority}${input.title}`);
  const planning: string[] = [];
  if (metadata.scheduled) planning.push(`SCHEDULED: <${orgDate(metadata.scheduled)}>`);
  if (metadata.deadline) planning.push(`DEADLINE: <${orgDate(metadata.deadline)}>`);
  if (planning.length) lines.push(planning.join(" "));
  lines.push("", input.body);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function render(format: NoteFormat, input: RenderInput): string {
  const metadata = input.metadata ?? emptyMetadata();
  return format === "markdown"
    ? renderMarkdown(input, metadata)
    : renderOrg(input, metadata);
}

function parseMarkdown(content: string): ParsedNote {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const metadata = emptyMetadata();
  const unknown: string[] = [];
  let title = "";
  let created: string | undefined;
  let contentStart = 0;

  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) {
      contentStart = close + 1;
      for (const line of lines.slice(1, close)) {
        const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/.exec(line);
        if (!match) {
          unknown.push(line);
          continue;
        }
        const [, key, value] = match;
        if (key === "title") title = value;
        else if (key === "status" && /^(todo|done)$/i.test(value)) {
          metadata.state = value.toUpperCase() as NoteState;
        } else if (key === "priority" && /^[ABC]$/i.test(value)) {
          metadata.priority = value.toUpperCase() as NotePriority;
        } else if (key === "scheduled" && isDateString(value)) metadata.scheduled = value;
        else if (key === "due" && isDateString(value)) metadata.deadline = value;
        else if (key === "tags" && /^\[.*\]$/.test(value)) {
          metadata.tags = normalizeTags(value.slice(1, -1));
        } else if (key === "created") created = value;
        else unknown.push(line);
      }
    }
  }

  const bodyLines = lines.slice(contentStart);
  let explicitTitle = false;
  const heading = /^#\s+(.+?)\s*$/.exec(bodyLines[0] ?? "");
  if (heading) {
    explicitTitle = true;
    if (!title) title = heading[1];
    bodyLines.shift();
    if (bodyLines[0] === "") bodyLines.shift();
  }
  const body = withoutFinalNewline(bodyLines.join("\n"));
  if (!title) title = deriveTitle(undefined, body);

  return {
    format: "markdown",
    title,
    body,
    explicitTitle,
    metadata,
    created,
    creationDate: created ? new Date(created) : undefined,
    markdownUnknownLines: unknown,
  };
}

function parseOrg(content: string): ParsedNote {
  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const metadata = emptyMetadata();
  let title = "";
  let creationDate: Date | undefined;
  let index = 0;

  while (/^#\+/.test(lines[index] ?? "")) {
    const line = lines[index];
    const titleMatch = /^#\+title:\s*(.*?)\s*$/i.exec(line);
    const dateMatch = /^#\+date:\s*\[(\d{4}-\d{2}-\d{2})\s+\S+\s+(\d{2}):(\d{2})\]\s*$/i.exec(line);
    const tagsMatch = /^#\+filetags:\s*:(.*):\s*$/i.exec(line);
    if (titleMatch) title = titleMatch[1];
    if (dateMatch && isDateString(dateMatch[1])) {
      const date = dateFromString(dateMatch[1]);
      if (date) {
        date.setHours(Number(dateMatch[2]), Number(dateMatch[3]));
        creationDate = date;
      }
    }
    if (tagsMatch) metadata.tags = normalizeTags(tagsMatch[1].split(":"));
    index += 1;
  }

  const heading = /^\*\s+(?:(TODO|DONE)\s+)?(?:\[#([ABC])\]\s+)?(.*?)\s*$/.exec(
    lines[index] ?? "",
  );
  if (heading) {
    metadata.state = (heading[1] as NoteState | undefined) ?? "NONE";
    if (heading[2]) metadata.priority = heading[2] as NotePriority;
    if (!title) title = heading[3];
    index += 1;
    const planning = lines[index] ?? "";
    const scheduled = /(?:^|\s)SCHEDULED:\s*<(\d{4}-\d{2}-\d{2})\s+\S+>/.exec(planning);
    const deadline = /(?:^|\s)DEADLINE:\s*<(\d{4}-\d{2}-\d{2})\s+\S+>/.exec(planning);
    if (scheduled && isDateString(scheduled[1])) metadata.scheduled = scheduled[1];
    if (deadline && isDateString(deadline[1])) metadata.deadline = deadline[1];
    if (scheduled || deadline) index += 1;
    if (lines[index] === "") index += 1;
  } else if (lines[index] === "") {
    index += 1;
  }

  const body = withoutFinalNewline(lines.slice(index).join("\n"));
  if (!title) title = deriveTitle(undefined, body);
  return {
    format: "org",
    title,
    body,
    explicitTitle: Boolean(title),
    metadata,
    creationDate,
    markdownUnknownLines: [],
  };
}

export function parseNote(format: NoteFormat, content: string): ParsedNote {
  return format === "markdown" ? parseMarkdown(content) : parseOrg(content);
}

function formatForPath(notePath: string): NoteFormat {
  return path.extname(notePath).toLowerCase() === ".org" ? "org" : "markdown";
}

async function atomicReplace(
  notePath: string,
  content: string,
  expectedMtimeMs: number,
): Promise<EditResult> {
  const dir = path.dirname(notePath);
  let tempPath = "";
  let handle;

  try {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      tempPath = path.join(
        dir,
        `.${path.basename(notePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`,
      );
      try {
        handle = await fs.open(tempPath, "wx");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!handle) throw new Error("Could not create a temporary note file");
    await handle.writeFile(content);
    await handle.close();
    handle = undefined;

    const current = await fs.stat(notePath);
    if (current.mtimeMs !== expectedMtimeMs) {
      await fs.unlink(tempPath);
      return { conflict: true };
    }
    await fs.rename(tempPath, notePath);
    return { conflict: false };
  } catch (error) {
    await handle?.close();
    if (tempPath) await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeNote(
  dir: string,
  format: NoteFormat,
  input: NoteInput,
  now = new Date(),
  host = os.hostname(),
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const title = deriveTitle(input.title, input.body);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const base = `${stamp}-${slugify(title)}-${host.split(".")[0]}`;
  const extension = format === "markdown" ? "md" : "org";
  const content = render(format, {
    title,
    body: input.body,
    explicitTitle: Boolean(input.title?.trim()),
    date: now,
    metadata: input.metadata,
  });

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const notePath = path.join(dir, `${base}${suffix}.${extension}`);
    let file;
    try {
      file = await fs.open(notePath, "wx");
      await file.writeFile(content);
      return notePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await file?.close();
    }
  }
  throw new Error("Could not create a unique note filename after 1000 attempts");
}

export async function editNote(
  notePath: string,
  patch: MetadataPatch,
  expectedMtimeMs: number,
): Promise<EditResult> {
  const format = formatForPath(notePath);
  const parsed = parseNote(format, await fs.readFile(notePath, "utf8"));
  const metadata: Metadata = { ...parsed.metadata, tags: [...parsed.metadata.tags] };
  const has = (key: keyof MetadataPatch) =>
    Object.prototype.hasOwnProperty.call(patch, key);
  if (has("state")) metadata.state = patch.state ?? "NONE";
  if (has("priority")) metadata.priority = patch.priority;
  if (has("scheduled")) metadata.scheduled = patch.scheduled;
  if (has("deadline")) metadata.deadline = patch.deadline;
  if (has("tags")) metadata.tags = normalizeTags(patch.tags ?? []);
  const content = render(format, {
    ...parsed,
    date: parsed.creationDate ?? new Date(),
    metadata,
  });
  return atomicReplace(notePath, content, expectedMtimeMs);
}

export async function rewriteNote(
  notePath: string,
  input: NoteInput,
  expectedMtimeMs: number,
): Promise<EditResult> {
  const format = formatForPath(notePath);
  const parsed = parseNote(format, await fs.readFile(notePath, "utf8"));
  const title = deriveTitle(input.title, input.body);
  const content = render(format, {
    title,
    body: input.body,
    explicitTitle: Boolean(input.title?.trim()),
    date: parsed.creationDate ?? new Date(),
    creationDate: parsed.creationDate,
    created: parsed.created,
    metadata: input.metadata,
    markdownUnknownLines: parsed.markdownUnknownLines,
  });
  return atomicReplace(notePath, content, expectedMtimeMs);
}

export async function scanNotes(dir: string): Promise<NoteFile[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const notes = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.(?:md|org)$/i.test(entry.name))
      .map(async (entry): Promise<NoteFile> => {
        const notePath = path.join(dir, entry.name);
        const [content, stats] = await Promise.all([
          fs.readFile(notePath, "utf8"),
          fs.stat(notePath),
        ]);
        return {
          ...parseNote(formatForPath(notePath), content),
          path: notePath,
          mtimeMs: stats.mtimeMs,
        };
      }),
  );
  return sortNotes(notes);
}

export function sortNotes<T extends Pick<NoteFile, "metadata" | "mtimeMs" | "path">>(
  notes: T[],
): T[] {
  return [...notes].sort((left, right) => {
    const leftTodo = left.metadata.state === "TODO";
    const rightTodo = right.metadata.state === "TODO";
    if (leftTodo !== rightTodo) return leftTodo ? -1 : 1;
    if (leftTodo) {
      const priorityOrder = { A: 0, B: 1, C: 2 } as const;
      const leftPriority = left.metadata.priority ? priorityOrder[left.metadata.priority] : 3;
      const rightPriority = right.metadata.priority ? priorityOrder[right.metadata.priority] : 3;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftDate = left.metadata.scheduled ?? left.metadata.deadline;
      const rightDate = right.metadata.scheduled ?? right.metadata.deadline;
      if (Boolean(leftDate) !== Boolean(rightDate)) return leftDate ? -1 : 1;
      if (leftDate !== rightDate) return (leftDate ?? "").localeCompare(rightDate ?? "");
    }
    return right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path);
  });
}
