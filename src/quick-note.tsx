import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  LocalStorage,
  showHUD,
  showToast,
  Toast,
} from "@vicinae/api";
import path from "node:path";
import { useEffect, useState } from "react";
import config from "./config.json";
import { type NoteFormat, writeNote } from "./note";

const isNoteFormat = (value: unknown): value is NoteFormat =>
  value === "markdown" || value === "org";

export default function QuickNote() {
  const [format, setFormat] = useState<NoteFormat>();
  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState<string>();

  useEffect(() => {
    void LocalStorage.getItem<string>("format").then(
      (storedFormat) => {
        setFormat(
          isNoteFormat(storedFormat) ? storedFormat : (config.defaultFormat as NoteFormat),
        );
      },
      () => setFormat(config.defaultFormat as NoteFormat),
    );
  }, []);

  if (!format) return <Form isLoading />;
  const loadedFormat = format;

  async function save(values: Form.Values) {
    const submittedBody = typeof values.body === "string" ? values.body : "";
    const submittedTitle = typeof values.title === "string" ? values.title : "";
    const submittedFormat = isNoteFormat(values.format) ? values.format : loadedFormat;

    if (!submittedBody.trim()) {
      setBodyError("Body is required");
      return;
    }

    try {
      const notePath = await writeNote(config.notesDir, submittedFormat, {
        title: submittedTitle,
        body: submittedBody,
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
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Note" onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        placeholder="Optional — defaults to first line"
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
      <Form.Dropdown
        id="format"
        title="Format"
        value={format}
        onChange={(value) => setFormat(value as NoteFormat)}
      >
        <Form.Dropdown.Item title="Markdown" value="markdown" />
        <Form.Dropdown.Item title="Org-mode" value="org" />
      </Form.Dropdown>
    </Form>
  );
}
