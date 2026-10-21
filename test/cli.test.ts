import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseNote, render } from "../src/note.ts";

const cliPath = path.resolve("src/cli.ts");

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("todos prints TODO and DONE notes as JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-notes-cli-todos-"));
  try {
    await writeFile(
      path.join(dir, "todo.md"),
      render("markdown", {
        title: "Open task",
        body: "",
        explicitTitle: true,
        date: new Date(2026, 0, 2),
        metadata: {
          state: "TODO",
          scheduled: "2026-01-03",
          tags: ["sync"],
        },
      }),
    );
    await writeFile(
      path.join(dir, "done.org"),
      render("org", {
        title: "Finished task",
        body: "",
        explicitTitle: true,
        date: new Date(2026, 0, 2),
        metadata: { state: "DONE", deadline: "2026-01-04", tags: [] },
      }),
    );
    await writeFile(path.join(dir, "plain.md"), "# Not a task\n");

    const result = await runCli(["todos", dir]);
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.length, 2);
    assert.deepEqual(
      output.map(({ title, state }: { title: string; state: string }) => ({ title, state })),
      [
        { title: "Open task", state: "TODO" },
        { title: "Finished task", state: "DONE" },
      ],
    );
    assert.deepEqual(output[0].tags, ["sync"]);
    assert.equal(output[0].scheduled, "2026-01-03");
    assert.equal("deadline" in output[0], false);
    assert.equal(output[1].deadline, "2026-01-04");
    assert.equal(typeof output[0].mtimeMs, "number");
    assert.equal(output[0].path, path.join(dir, "todo.md"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("set-state updates a note", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-notes-cli-state-"));
  const notePath = path.join(dir, "note.md");
  try {
    await writeFile(notePath, "# Change me\n");
    const result = await runCli(["set-state", notePath, "DONE"]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    const parsed = parseNote("markdown", await readFile(notePath, "utf8"));
    assert.equal(parsed.metadata.state, "DONE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("add creates markdown and org notes with requested metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-notes-cli-add-"));
  try {
    const markdown = await runCli(["add", dir, "--title", "Default task"]);
    assert.equal(markdown.code, 0);
    const markdownPath = markdown.stdout.trim();
    assert.equal(path.extname(markdownPath), ".md");
    assert.deepEqual(parseNote("markdown", await readFile(markdownPath, "utf8")).metadata, {
      state: "TODO",
      tags: [],
    });

    const org = await runCli([
      "add",
      dir,
      "--title",
      "Completed task",
      "--format",
      "org",
      "--state",
      "DONE",
      "--deadline",
      "2026-02-03",
    ]);
    assert.equal(org.code, 0);
    const orgPath = org.stdout.trim();
    assert.equal(path.extname(orgPath), ".org");
    assert.deepEqual(parseNote("org", await readFile(orgPath, "utf8")).metadata, {
      state: "DONE",
      deadline: "2026-02-03",
      tags: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad arguments print usage and exit 1", async () => {
  for (const args of [[], ["unknown"], ["set-state", "note.md", "OPEN"]]) {
    const result = await runCli(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage:/);
  }
});

test("set-state exits 2 when the note changes during editing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-notes-cli-conflict-"));
  const notePath = path.join(dir, "large.md");
  try {
    await writeFile(notePath, `# Large note\n\n${"body\n".repeat(1_000_000)}`);
    const child = runCli(["set-state", notePath, "DONE"]);
    const initial = await stat(notePath);
    let touching = true;
    let offset = 1;
    const touchLoop = (async () => {
      while (touching) {
        const time = new Date(initial.mtimeMs + offset);
        offset += 1;
        await utimes(notePath, time, time);
      }
    })();
    const result = await child;
    touching = false;
    await touchLoop;
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Conflict/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
