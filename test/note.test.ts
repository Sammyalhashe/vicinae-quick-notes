import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cycleState,
  deriveTitle,
  editNote,
  type Metadata,
  normalizeTags,
  parseNote,
  render,
  rewriteNote,
  slugify,
  sortNotes,
  writeNote,
} from "../src/note.ts";

const date = new Date(2026, 0, 2, 3, 4, 5);
const cases: Array<[string, Metadata]> = [
  ["none", { state: "NONE", tags: [] }],
  ["state only", { state: "TODO", tags: [] }],
  [
    "dates only",
    { state: "NONE", scheduled: "2026-01-05", deadline: "2026-01-09", tags: [] },
  ],
  ["tags only", { state: "NONE", tags: ["alpha", "team@home"] }],
  [
    "all",
    {
      state: "DONE",
      scheduled: "2026-01-05",
      deadline: "2026-01-09",
      tags: ["alpha", "team@home"],
    },
  ],
];

for (const format of ["markdown", "org"] as const) {
  for (const [name, metadata] of cases) {
    test(`${format} round-trips ${name}`, () => {
      const content = render(format, {
        title: "Named note",
        body: "Body\n\n---\n* TODO later body heading",
        explicitTitle: true,
        date,
        metadata,
      });
      const parsed = parseNote(format, content);
      assert.equal(parsed.title, "Named note");
      assert.equal(parsed.body, "Body\n\n---\n* TODO later body heading");
      assert.deepEqual(parsed.metadata, metadata);
    });
  }
}

test("renders exact Org heading, planning, tags, and English weekday syntax", () => {
  assert.equal(
    render("org", {
      title: "Named note",
      body: "Body",
      explicitTitle: true,
      date,
      metadata: {
        state: "TODO",
        scheduled: "2026-01-05",
        deadline: "2026-01-09",
        tags: ["alpha", "beta"],
      },
    }),
    "#+title: Named note\n" +
      "#+date: [2026-01-02 Fri 03:04]\n" +
      "#+filetags: :alpha:beta:\n" +
      "* TODO Named note\n" +
      "SCHEDULED: <2026-01-05 Mon> DEADLINE: <2026-01-09 Fri>\n\n" +
      "Body\n",
  );
});

test("renders exact Markdown schema and omits unset metadata", () => {
  assert.equal(
    render("markdown", {
      title: "Named note",
      body: "Body",
      explicitTitle: true,
      date,
      metadata: { state: "NONE", tags: [] },
    }),
    `---\ntitle: Named note\ncreated: ${date.toISOString()}\n---\n# Named note\n\nBody\n`,
  );
});

test("parses phase-1 Markdown and Org files", () => {
  const markdown = parseNote("markdown", "# Old title\n\nOld body\n");
  assert.equal(markdown.title, "Old title");
  assert.equal(markdown.body, "Old body");
  assert.deepEqual(markdown.metadata, { state: "NONE", tags: [] });

  const org = parseNote(
    "org",
    "#+title: Old title\n#+date: [2026-01-02 Friday 03:04]\n\n* TODO body heading\n---\n",
  );
  assert.equal(org.title, "Old title");
  assert.equal(org.body, "* TODO body heading\n---");
  assert.deepEqual(org.metadata, { state: "NONE", tags: [] });
});

test("parsers tolerate CRLF and metadata-like body lines", () => {
  const markdown = parseNote(
    "markdown",
    "---\r\ntitle: CRLF\r\nstatus: todo\r\n---\r\n# CRLF\r\n\r\nBody\r\n---\r\nstatus: done\r\n",
  );
  assert.equal(markdown.metadata.state, "TODO");
  assert.equal(markdown.body, "Body\n---\nstatus: done");

  const org = parseNote(
    "org",
    "#+title: CRLF\r\n#+date: [2026-01-02 Fri 03:04]\r\n* DONE CRLF\r\n\r\nBody\r\n* TODO later\r\nDEADLINE: <2030-01-01 Tue>\r\n",
  );
  assert.equal(org.metadata.state, "DONE");
  assert.equal(org.metadata.deadline, undefined);
  assert.equal(org.body, "Body\n* TODO later\nDEADLINE: <2030-01-01 Tue>");
});

test("hand-edited front matter preserves unknown lines and odd spacing", () => {
  const input =
    "---\n  title : Hand edited  \ncustom: keep: exactly\n status : done\nunknown line\n tags : [one, #two]\ncreated : 2025-03-04T05:06:07.000Z\n---\n# Hand edited\n\nBody\n";
  const parsed = parseNote("markdown", input);
  assert.equal(parsed.title, "Hand edited");
  assert.equal(parsed.metadata.state, "DONE");
  assert.deepEqual(parsed.metadata.tags, ["one", "two"]);
  assert.deepEqual(parsed.markdownUnknownLines, ["custom: keep: exactly", "unknown line"]);
  const rerendered = render("markdown", { ...parsed, date, metadata: parsed.metadata });
  assert.ok(rerendered.includes("custom: keep: exactly\nunknown line\n---"));
});

test("cycles states", () => {
  assert.equal(cycleState("TODO"), "DONE");
  assert.equal(cycleState("DONE"), "NONE");
  assert.equal(cycleState("NONE"), "TODO");
});

test("normalizes tag edge cases", () => {
  assert.deepEqual(
    normalizeTags(" #alpha, :beta  alpha bad-tag @team #%keep 😀 empty- "),
    ["alpha", "beta", "badtag", "@team", "%keep", "empty"],
  );
  assert.deepEqual(normalizeTags(["one,two", "##three", "one"]), ["one", "two", "three"]);
  assert.deepEqual(normalizeTags(" , : # 😀 "), []);
});

test("editNote sets and clears dates without changing the body", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-note-edit-"));
  const notePath = path.join(dir, "note.md");
  try {
    const original = render("markdown", {
      title: "Edit me",
      body: "Body\n---\nkeep me",
      explicitTitle: true,
      date,
      metadata: { state: "NONE", tags: [] },
    });
    await writeFile(notePath, original);
    let stats = await stat(notePath);
    assert.deepEqual(
      await editNote(
        notePath,
        { scheduled: "2026-02-02", deadline: "2026-02-03" },
        stats.mtimeMs,
      ),
      { conflict: false },
    );
    let parsed = parseNote("markdown", await readFile(notePath, "utf8"));
    assert.equal(parsed.body, "Body\n---\nkeep me");
    assert.equal(parsed.metadata.scheduled, "2026-02-02");
    assert.equal(parsed.metadata.deadline, "2026-02-03");

    stats = await stat(notePath);
    await editNote(notePath, { scheduled: undefined, deadline: undefined }, stats.mtimeMs);
    parsed = parseNote("markdown", await readFile(notePath, "utf8"));
    assert.equal(parsed.metadata.scheduled, undefined);
    assert.equal(parsed.metadata.deadline, undefined);
    assert.equal(parsed.body, "Body\n---\nkeep me");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("editNote detects an mtime conflict and does not overwrite", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-note-conflict-"));
  const notePath = path.join(dir, "note.org");
  try {
    await writeFile(
      notePath,
      render("org", {
        title: "Conflict",
        body: "Original body",
        explicitTitle: true,
        date,
        metadata: { state: "TODO", tags: [] },
      }),
    );
    const oldStats = await stat(notePath);
    const future = new Date(oldStats.mtimeMs + 10_000);
    await utimes(notePath, future, future);
    const touched = await readFile(notePath, "utf8");
    assert.deepEqual(await editNote(notePath, { state: "DONE" }, oldStats.mtimeMs), {
      conflict: true,
    });
    assert.equal(await readFile(notePath, "utf8"), touched);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rewriteNote updates the editable fields and preserves unknown front matter", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-note-rewrite-"));
  const notePath = path.join(dir, "note.md");
  try {
    await writeFile(
      notePath,
      "---\ntitle: Before\ncustom: unchanged\ncreated: 2025-03-04T05:06:07.000Z\n---\n# Before\n\nOld body\n",
    );
    const stats = await stat(notePath);
    assert.deepEqual(
      await rewriteNote(
        notePath,
        {
          title: "After",
          body: "New body",
          metadata: { state: "DONE", tags: ["edited"] },
        },
        stats.mtimeMs,
      ),
      { conflict: false },
    );
    const content = await readFile(notePath, "utf8");
    const parsed = parseNote("markdown", content);
    assert.equal(parsed.title, "After");
    assert.equal(parsed.body, "New body");
    assert.deepEqual(parsed.metadata, { state: "DONE", tags: ["edited"] });
    assert.ok(content.includes("custom: unchanged"));
    assert.ok(content.includes("created: 2025-03-04T05:06:07.000Z"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sorts open TODOs by relevant date, undated TODOs last, then others by mtime", () => {
  const fixture = [
    { path: "done-new", mtimeMs: 90, metadata: { state: "DONE", tags: [] } },
    { path: "todo-undated", mtimeMs: 100, metadata: { state: "TODO", tags: [] } },
    {
      path: "todo-deadline",
      mtimeMs: 1,
      metadata: { state: "TODO", deadline: "2026-01-03", tags: [] },
    },
    {
      path: "todo-scheduled",
      mtimeMs: 2,
      metadata: {
        state: "TODO",
        scheduled: "2026-01-02",
        deadline: "2026-01-01",
        tags: [],
      },
    },
    { path: "none-old", mtimeMs: 10, metadata: { state: "NONE", tags: [] } },
  ] satisfies Array<{ path: string; mtimeMs: number; metadata: Metadata }>;
  assert.deepEqual(sortNotes(fixture).map((note) => note.path), [
    "todo-scheduled",
    "todo-deadline",
    "todo-undated",
    "done-new",
    "none-old",
  ]);
});

test("derives titles and slugifies edge cases", () => {
  assert.equal(deriveTitle("  Explicit  ", "Ignored"), "Explicit");
  assert.equal(deriveTitle("", "\n  ## * Derived title\nBody"), "Derived title");
  assert.equal(slugify("😀✨"), "note");
  assert.equal(slugify("Crème brûlée"), "creme-brulee");
  assert.equal(slugify("a".repeat(200)), "a".repeat(50));
});

test("writes concurrent notes atomically without collisions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-note-write-"));
  try {
    const paths = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeNote(
          dir,
          "markdown",
          {
            title: "Concurrent",
            body: `Body ${index}`,
            metadata: { state: "TODO", tags: ["batch"] },
          },
          date,
          "test.example",
        ),
      ),
    );
    assert.equal(new Set(paths).size, 20);
    assert.ok(
      paths.every((notePath) =>
        path.basename(notePath).startsWith("20260102-030405-concurrent-test"),
      ),
    );
    const parsed = await Promise.all(
      paths.map(async (notePath) => parseNote("markdown", await readFile(notePath, "utf8"))),
    );
    assert.deepEqual(
      parsed.map((note) => note.body).sort(),
      Array.from({ length: 20 }, (_, index) => `Body ${index}`).sort(),
    );
    assert.ok(parsed.every((note) => note.metadata.state === "TODO"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
