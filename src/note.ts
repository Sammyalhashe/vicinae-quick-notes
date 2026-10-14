import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type NoteFormat = "markdown" | "org";

export interface NoteInput {
  title?: string;
  body: string;
}

interface RenderInput {
  title: string;
  body: string;
  explicitTitle: boolean;
  date: Date;
}

const pad = (value: number) => String(value).padStart(2, "0");

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

  const firstLine = body.split("\n").find((line) => line.trim());
  return firstLine?.replace(/^[#*\s]+/, "").trim() ?? "";
}

export function render(format: NoteFormat, input: RenderInput): string {
  if (format === "markdown") {
    return input.explicitTitle
      ? `# ${input.title}\n\n${input.body}\n`
      : `${input.body}\n`;
  }

  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const date = `${input.date.getFullYear()}-${pad(input.date.getMonth() + 1)}-${pad(input.date.getDate())}`;
  const time = `${pad(input.date.getHours())}:${pad(input.date.getMinutes())}`;

  return `#+title: ${input.title}\n#+date: [${date} ${weekdays[input.date.getDay()]} ${time}]\n\n${input.body}\n`;
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
