import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveTitle, render, slugify, writeNote } from "../src/note.ts";

const date = new Date(2026, 0, 2, 3, 4, 5);

test("renders markdown with and without an explicit title", () => {
  assert.equal(
    render("markdown", {
      title: "Named note",
      body: "Body",
      explicitTitle: true,
      date,
    }),
    "# Named note\n\nBody\n",
  );
  assert.equal(
    render("markdown", {
      title: "Derived title",
      body: "Derived title\nBody",
      explicitTitle: false,
      date,
    }),
    "Derived title\nBody\n",
  );
});

test("renders Org-mode with and without an explicit title", () => {
  const expectedDate = "#+date: [2026-01-02 Friday 03:04]";
  assert.equal(
    render("org", {
      title: "Named note",
      body: "Body",
      explicitTitle: true,
      date,
    }),
    `#+title: Named note\n${expectedDate}\n\nBody\n`,
  );
  assert.equal(
    render("org", {
      title: "Derived title",
      body: "* Derived title\nBody",
      explicitTitle: false,
      date,
    }),
    `#+title: Derived title\n${expectedDate}\n\n* Derived title\nBody\n`,
  );
});

test("derives a title from the first non-empty body line", () => {
  assert.equal(deriveTitle("  Explicit  ", "Ignored"), "Explicit");
  assert.equal(deriveTitle("", "\n  ## * Derived title\nBody"), "Derived title");
});

test("slugifies edge cases", () => {
  assert.equal(slugify("😀✨"), "note");
  assert.equal(slugify("Crème brûlée"), "creme-brulee");
  assert.equal(slugify("a".repeat(200)), "a".repeat(50));
  assert.equal(slugify("### Leading heading"), "leading-heading");
  assert.equal(slugify("word-".repeat(20)), "word-word-word-word-word-word-word-word-word-word");
});

test("writes concurrent notes without collisions or lost content", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quick-note-test-"));

  try {
    const paths = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeNote(
          dir,
          "markdown",
          { title: "Concurrent", body: `Body ${index}` },
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

    const contents = await Promise.all(paths.map((notePath) => readFile(notePath, "utf8")));
    assert.deepEqual(
      contents.sort(),
      Array.from({ length: 20 }, (_, index) => `# Concurrent\n\nBody ${index}\n`).sort(),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
