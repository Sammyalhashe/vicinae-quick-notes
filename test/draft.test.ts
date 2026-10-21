import assert from "node:assert/strict";
import test from "node:test";
import {
  draftKey,
  isDraftStateEqual,
  parseDraft,
  serializeDraft,
  type DraftState,
} from "../src/draft.ts";

const draft: DraftState = {
  title: "Plan",
  body: "Draft body",
  format: "markdown",
  state: "TODO",
  scheduled: "2026-10-22",
  deadline: null,
  tags: "work, plan",
};

test("computes new and edit draft keys", () => {
  assert.equal(draftKey(), "draft:new");
  assert.equal(
    draftKey({ path: "/notes/plan.md", mtimeMs: 1234.5 }),
    "draft:edit:/notes/plan.md:1234.5",
  );
});

test("serializes and parses a draft", () => {
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
});

test("ignores corrupt draft JSON", () => {
  assert.equal(parseDraft("{not json"), undefined);
});

test("compares every draft field with the initial state", () => {
  assert.equal(isDraftStateEqual(draft, { ...draft }), true);
  assert.equal(isDraftStateEqual({ ...draft, tags: "personal" }, draft), false);
});

test("edit draft key changes when the note mtime changes", () => {
  const note = { path: "/notes/plan.md", mtimeMs: 1000 };
  assert.notEqual(draftKey(note), draftKey({ ...note, mtimeMs: 1001 }));
});
