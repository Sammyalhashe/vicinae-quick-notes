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
import { useEffect, useState } from "react";
import config from "./config.json";
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
const dateValue = (value: unknown): string | undefined => {
  if (!(value instanceof Date)) return undefined;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

export default function QuickNote({ note, onSaved }: QuickNoteProps = {}) {
  const [format, setFormat] = useState<NoteFormat | undefined>(note?.format);
  const [body, setBody] = useState(note?.body ?? "");
  const [bodyError, setBodyError] = useState<string>();
  const { pop } = useNavigation();

  useEffect(() => {
    if (note) return;
    void LocalStorage.getItem<string>("format").then(
      (storedFormat) => {
        setFormat(
          isNoteFormat(storedFormat) ? storedFormat : (config.defaultFormat as NoteFormat),
        );
      },
      () => setFormat(config.defaultFormat as NoteFormat),
    );
  }, [note]);

  if (!format) return <Form isLoading />;
  const loadedFormat = format;

  async function save(values: Form.Values) {
    const submittedBody = typeof values.body === "string" ? values.body : "";
    const submittedTitle = typeof values.title === "string" ? values.title : "";
    const submittedFormat = isNoteFormat(values.format) ? values.format : loadedFormat;
    const metadata: Metadata = {
      state: isNoteState(values.state) ? values.state : "NONE",
      scheduled: dateValue(values.scheduled),
      deadline: dateValue(values.deadline),
      tags: normalizeTags(typeof values.tags === "string" ? values.tags : ""),
    };

    if (!submittedBody.trim()) {
      setBodyError("Body is required");
      return;
    }

    try {
      if (note) {
        const result = await rewriteNote(
          note.path,
          { title: submittedTitle, body: submittedBody, metadata },
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
        await onSaved?.();
        pop();
        return;
      }

      const notePath = await writeNote(config.notesDir, submittedFormat, {
        title: submittedTitle,
        body: submittedBody,
        metadata,
      });
      await LocalStorage.setItem("format", submittedFormat);
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
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        placeholder="Optional — defaults to first line"
        defaultValue={note?.title}
      />
      <Form.TextArea
        id="body"
        title="Body"
        autoFocus
        placeholder={format === "org" ? "Write org…" : "Write markdown…"}
        value={body}
        error={bodyError}
        onChange={(value) => {
          setBody(value);
          if (value.trim()) setBodyError(undefined);
        }}
      />
      {!note && (
        <Form.Dropdown
          id="format"
          title="Format"
          value={format}
          onChange={(value) => setFormat(value as NoteFormat)}
        >
          <Form.Dropdown.Item title="Markdown" value="markdown" />
          <Form.Dropdown.Item title="Org-mode" value="org" />
        </Form.Dropdown>
      )}
      <Form.Dropdown id="state" title="State" defaultValue={note?.metadata.state ?? "NONE"}>
        <Form.Dropdown.Item title="None" value="NONE" />
        <Form.Dropdown.Item title="TODO" value="TODO" />
        <Form.Dropdown.Item title="DONE" value="DONE" />
      </Form.Dropdown>
      <Form.DatePicker
        id="scheduled"
        title="Scheduled"
        type={Form.DatePicker.Type.Date}
        defaultValue={dateFromString(note?.metadata.scheduled)}
      />
      <Form.DatePicker
        id="deadline"
        title="Deadline"
        type={Form.DatePicker.Type.Date}
        defaultValue={dateFromString(note?.metadata.deadline)}
      />
      <Form.TextField
        id="tags"
        title="Tags"
        info="comma or space separated"
        defaultValue={note?.metadata.tags.join(", ")}
      />
    </Form>
  );
}
