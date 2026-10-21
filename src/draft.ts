import type { NoteFormat, NoteState } from "./note";

export interface DraftState {
  title: string;
  body: string;
  format: NoteFormat;
  state: NoteState;
  scheduled: string | null;
  deadline: string | null;
  tags: string;
}

export interface DraftNote {
  path: string;
  mtimeMs: number;
}

export function draftKey(note?: DraftNote): string {
  return note ? `draft:edit:${note.path}:${note.mtimeMs}` : "draft:new";
}

export function serializeDraft(state: DraftState): string {
  return JSON.stringify(state);
}

export function parseDraft(value: unknown): DraftState | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const draft = parsed as Record<string, unknown>;
    if (typeof draft.title !== "string" || typeof draft.body !== "string") return undefined;
    if (draft.format !== "markdown" && draft.format !== "org") return undefined;
    if (draft.state !== "NONE" && draft.state !== "TODO" && draft.state !== "DONE") {
      return undefined;
    }
    if (draft.scheduled !== null && typeof draft.scheduled !== "string") return undefined;
    if (draft.deadline !== null && typeof draft.deadline !== "string") return undefined;
    if (typeof draft.tags !== "string") return undefined;

    return {
      title: draft.title,
      body: draft.body,
      format: draft.format,
      state: draft.state,
      scheduled: draft.scheduled,
      deadline: draft.deadline,
      tags: draft.tags,
    };
  } catch {
    return undefined;
  }
}

export function isDraftStateEqual(state: DraftState, initialState: DraftState): boolean {
  return (
    state.title === initialState.title &&
    state.body === initialState.body &&
    state.format === initialState.format &&
    state.state === initialState.state &&
    state.scheduled === initialState.scheduled &&
    state.deadline === initialState.deadline &&
    state.tags === initialState.tags
  );
}
