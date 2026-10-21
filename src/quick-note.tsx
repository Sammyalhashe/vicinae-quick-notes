import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  LocalStorage,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import config from "./config.json";
import {
  draftKey,
  isDraftStateEqual,
  parseDraft,
  serializeDraft,
  type DraftState,
} from "./draft";
import {
  dateFromString,
  type Metadata,
  type NoteFile,
  type NoteFormat,
  type NoteState,
  normalizeTags,
  rewriteNote,
  writeNote,
} from "./note";

export interface QuickNoteProps {
  note?: NoteFile;
  onSaved?: () => void | Promise<void>;
}

const isNoteFormat = (value: unknown): value is NoteFormat =>
  value === "markdown" || value === "org";
const isNoteState = (value: unknown): value is NoteState =>
  value === "NONE" || value === "TODO" || value === "DONE";
const dateValue = (value: unknown): string | null => {
  if (!(value instanceof Date)) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const initialDraftState = (note: NoteFile | undefined, format: NoteFormat): DraftState => ({
  title: note?.title ?? "",
  body: note?.body ?? "",
  format,
  state: note?.metadata.state ?? "NONE",
  scheduled: note?.metadata.scheduled ?? null,
  deadline: note?.metadata.deadline ?? null,
  tags: note?.metadata.tags.join(", ") ?? "",
});

interface PendingDraftWrite {
  key: string;
  serialized: string | undefined;
}

export default function QuickNote({ note, onSaved }: QuickNoteProps = {}) {
  const [draft, setDraft] = useState<DraftState>();
  const [initialDraft, setInitialDraft] = useState<DraftState>();
  const [loadedStorageKey, setLoadedStorageKey] = useState<string>();
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [bodyError, setBodyError] = useState<string>();
  const storageKey = draftKey(note);
  const currentStorageKey = useRef(storageKey);
  const queuedDraftValue = useRef<string | undefined>(undefined);
  const pendingDraft = useRef<PendingDraftWrite | undefined>(undefined);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftWrites = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const { pop } = useNavigation();
  currentStorageKey.current = storageKey;

  function enqueueDraftWrite(write: PendingDraftWrite) {
    if (currentStorageKey.current === write.key) {
      queuedDraftValue.current = write.serialized;
    }
    draftWrites.current = draftWrites.current.catch(() => undefined).then(async () => {
      if (write.serialized === undefined) {
        await LocalStorage.removeItem(write.key);
      } else {
        await LocalStorage.setItem(write.key, write.serialized);
      }
      if (currentStorageKey.current !== write.key) return;
      if (queuedDraftValue.current !== write.serialized) return;
      if (mounted.current) setHasStoredDraft(write.serialized !== undefined);
    });
    void draftWrites.current.catch(() => undefined);
  }

  function flushPendingDraftWrite() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = undefined;
    const write = pendingDraft.current;
    pendingDraft.current = undefined;
    if (write) enqueueDraftWrite(write);
  }

  useEffect(() => {
    let active = true;
    flushPendingDraftWrite();
    setDraft(undefined);
    setInitialDraft(undefined);
    setLoadedStorageKey(undefined);
    setHasStoredDraft(false);
    queuedDraftValue.current = undefined;

    void Promise.all([
      note
        ? Promise.resolve(note.format)
        : LocalStorage.getItem<string>("format").catch(() => undefined),
      LocalStorage.getItem<string>(storageKey).catch(() => undefined),
    ]).then(([storedFormat, serialized]) => {
      if (!active) return;
      const format = isNoteFormat(storedFormat)
        ? storedFormat
        : (config.defaultFormat as NoteFormat);
      const initial = initialDraftState(note, format);
      const restored = parseDraft(serialized);
      queuedDraftValue.current = serialized;
      setInitialDraft(initial);
      setDraft(restored ?? initial);
      setLoadedStorageKey(storageKey);
      setHasStoredDraft(Boolean(restored));
      if (restored) {
        void showToast({ style: Toast.Style.Success, title: "Restored unsaved draft" });
      }
    });

    return () => {
      active = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!draft || !initialDraft || loadedStorageKey !== storageKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const serialized = isDraftStateEqual(draft, initialDraft)
      ? undefined
      : serializeDraft(draft);
    if (serialized === queuedDraftValue.current) {
      pendingDraft.current = undefined;
      draftTimer.current = undefined;
      return;
    }
    pendingDraft.current = { key: storageKey, serialized };
    draftTimer.current = setTimeout(flushPendingDraftWrite, 300);
  }, [draft, initialDraft, loadedStorageKey, storageKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flushPendingDraftWrite();
    };
  }, []);

  async function clearDraft() {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = undefined;
    pendingDraft.current = undefined;
    await draftWrites.current.catch(() => undefined);
    await LocalStorage.removeItem(storageKey);
    if (currentStorageKey.current !== storageKey) return;
    queuedDraftValue.current = undefined;
    if (mounted.current) setHasStoredDraft(false);
  }

  async function discardDraft() {
    if (!initialDraft) return;
    try {
      await clearDraft();
      setDraft(initialDraft);
      setBodyError(undefined);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not discard draft",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!draft || !initialDraft || loadedStorageKey !== storageKey) return <Form isLoading />;
  const loadedDraft = draft;
  const differsFromInitial = !isDraftStateEqual(loadedDraft, initialDraft);

  async function save() {
    const metadata: Metadata = {
      state: isNoteState(loadedDraft.state) ? loadedDraft.state : "NONE",
      scheduled: loadedDraft.scheduled ?? undefined,
      deadline: loadedDraft.deadline ?? undefined,
      tags: normalizeTags(loadedDraft.tags),
    };

    if (!loadedDraft.body.trim()) {
      setBodyError("Body is required");
      return;
    }

    try {
      if (note) {
        const result = await rewriteNote(
          note.path,
          { title: loadedDraft.title, body: loadedDraft.body, metadata },
          note.mtimeMs,
        );
        if (result.conflict) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Note changed on disk",
            message: "Reloaded the notes list; reopen the note to edit the latest version.",
          });
          await onSaved?.();
          return;
        }
        await clearDraft();
        await onSaved?.();
        pop();
        return;
      }

      const notePath = await writeNote(config.notesDir, loadedDraft.format, {
        title: loadedDraft.title,
        body: loadedDraft.body,
        metadata,
      });
      await LocalStorage.setItem("format", loadedDraft.format);
      await clearDraft();
      await showHUD(`Saved ${path.basename(notePath)}`);
      await closeMainWindow();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not save note",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle={note ? "Edit Note" : "Quick Note"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={note ? "Save Changes" : "Save Note"} onSubmit={save} />
          {(hasStoredDraft || differsFromInitial) && (
            <Action title="Discard Draft" onAction={discardDraft} />
          )}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        placeholder="Optional — defaults to first line"
        value={draft.title}
        onChange={(title) => setDraft((current) => current && { ...current, title })}
      />
      <Form.TextArea
        id="body"
        title="Body"
        autoFocus
        placeholder={draft.format === "org" ? "Write org…" : "Write markdown…"}
        value={draft.body}
        error={bodyError}
        onChange={(body) => {
          setDraft((current) => current && { ...current, body });
          if (body.trim()) setBodyError(undefined);
        }}
      />
      {!note && (
        <Form.Dropdown
          id="format"
          title="Format"
          value={draft.format}
          onChange={(format) =>
            setDraft((current) => current && { ...current, format: format as NoteFormat })
          }
        >
          <Form.Dropdown.Item title="Markdown" value="markdown" />
          <Form.Dropdown.Item title="Org-mode" value="org" />
        </Form.Dropdown>
      )}
      <Form.Dropdown
        id="state"
        title="State"
        value={draft.state}
        onChange={(state) =>
          setDraft((current) => current && { ...current, state: state as NoteState })
        }
      >
        <Form.Dropdown.Item title="None" value="NONE" />
        <Form.Dropdown.Item title="TODO" value="TODO" />
        <Form.Dropdown.Item title="DONE" value="DONE" />
      </Form.Dropdown>
      <Form.DatePicker
        id="scheduled"
        title="Scheduled"
        type={Form.DatePicker.Type.Date}
        value={dateFromString(draft.scheduled ?? undefined)}
        onChange={(scheduled) =>
          setDraft((current) => current && { ...current, scheduled: dateValue(scheduled) })
        }
      />
      <Form.DatePicker
        id="deadline"
        title="Deadline"
        type={Form.DatePicker.Type.Date}
        value={dateFromString(draft.deadline ?? undefined)}
        onChange={(deadline) =>
          setDraft((current) => current && { ...current, deadline: dateValue(deadline) })
        }
      />
      <Form.TextField
        id="tags"
        title="Tags"
        info="comma or space separated"
        value={draft.tags}
        onChange={(tags) => setDraft((current) => current && { ...current, tags })}
      />
    </Form>
  );
}
