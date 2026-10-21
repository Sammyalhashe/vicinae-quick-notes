import { stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  editNote,
  isDateString,
  type Metadata,
  type NoteFormat,
  type NoteState,
  scanNotes,
  writeNote,
} from "./note.ts";

const usage = `Usage:
  node src/cli.ts todos <notesDir>
  node src/cli.ts set-state <notePath> <TODO|DONE|NONE>
  node src/cli.ts add <notesDir> --title <title> [--format org|markdown] [--state TODO|DONE] [--deadline YYYY-MM-DD]`;

function fail(message?: string): number {
  if (message) console.error(message);
  console.error(usage);
  return 1;
}

function isState(value: string | undefined): value is NoteState {
  return value === "TODO" || value === "DONE" || value === "NONE";
}

async function todos(args: string[]): Promise<number> {
  if (args.length !== 1) return fail();
  const notes = (await scanNotes(args[0]))
    .filter((note) => note.metadata.state !== "NONE")
    .map((note) => ({
      path: note.path,
      title: note.title,
      state: note.metadata.state,
      scheduled: note.metadata.scheduled,
      deadline: note.metadata.deadline,
      tags: note.metadata.tags,
      mtimeMs: note.mtimeMs,
    }));
  console.log(JSON.stringify(notes));
  return 0;
}

async function setState(args: string[]): Promise<number> {
  if (args.length !== 2 || !isState(args[1])) return fail();
  const notePath = args[0];
  const stats = await stat(notePath);
  const result = await editNote(notePath, { state: args[1] }, stats.mtimeMs);
  if (result.conflict) {
    console.error(`Conflict while updating ${notePath}`);
    return 2;
  }
  return 0;
}

async function add(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        title: { type: "string" },
        format: { type: "string", default: "markdown" },
        state: { type: "string", default: "TODO" },
        deadline: { type: "string" },
      },
    });
  } catch (error) {
    return fail((error as Error).message);
  }

  const { title, format, state, deadline } = parsed.values;
  if (
    parsed.positionals.length !== 1 ||
    title === undefined ||
    (format !== "markdown" && format !== "org") ||
    (state !== "TODO" && state !== "DONE") ||
    (deadline !== undefined && !isDateString(deadline))
  ) {
    return fail();
  }

  const metadata: Metadata = { state, tags: [], deadline };
  const notePath = await writeNote(parsed.positionals[0], format as NoteFormat, {
    title,
    body: "",
    metadata,
  });
  console.log(notePath);
  return 0;
}

async function main(args: string[]): Promise<number> {
  const [command, ...commandArgs] = args;
  if (command === "todos") return todos(commandArgs);
  if (command === "set-state") return setState(commandArgs);
  if (command === "add") return add(commandArgs);
  return fail();
}

main(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  },
);
