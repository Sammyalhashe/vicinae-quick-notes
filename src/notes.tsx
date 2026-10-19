import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import config from "./config.json";
import {
  cycleState,
  dateFromString,
  editNote,
  type MetadataPatch,
  type NoteFile,
  normalizeTags,
  scanNotes,
} from "./note";
import QuickNote from "./quick-note";

type StateFilter = "ALL" | "TODO" | "DONE" | "NONE" | "ALL_NOT_DONE";
type DateField = "scheduled" | "deadline";

const dateValue = (value: unknown): string | undefined => {
  if (!(value instanceof Date)) return undefined;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

function DateForm({
  note,
  field,
  mutate,
}: {
  note: NoteFile;
  field: DateField;
  mutate: (note: NoteFile, patch: MetadataPatch) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const title = field === "scheduled" ? "Scheduled" : "Deadline";
  return (
    <Form
      navigationTitle={`Set ${title}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={`Set ${title}`}
            onSubmit={async (values) => {
              await mutate(note, { [field]: dateValue(values.date) });
              pop();
            }}
          />
          {note.metadata[field] && (
            <Action
              title={`Clear ${title}`}
              onAction={() => {
                void mutate(note, { [field]: undefined }).then(pop);
              }}
            />
          )}
        </ActionPanel>
      }
    >
      <Form.DatePicker
        id="date"
        title={title}
        type={Form.DatePicker.Type.Date}
        defaultValue={dateFromString(note.metadata[field])}
      />
    </Form>
  );
}

function TagsForm({
  note,
  mutate,
}: {
  note: NoteFile;
  mutate: (note: NoteFile, patch: MetadataPatch) => Promise<void>;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="Edit Tags"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Tags"
            onSubmit={async (values) => {
              const value = typeof values.tags === "string" ? values.tags : "";
              await mutate(note, { tags: normalizeTags(value) });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="tags"
        title="Tags"
        info="comma or space separated"
        defaultValue={note.metadata.tags.join(", ")}
      />
    </Form>
  );
}

function stateColor(note: NoteFile): Color {
  if (note.metadata.state === "TODO") return Color.Orange;
  if (note.metadata.state === "DONE") return Color.Green;
  return Color.SecondaryText;
}

function accessories(note: NoteFile): List.Item.Accessory[] {
  const values: List.Item.Accessory[] = [
    { tag: { value: note.metadata.state, color: stateColor(note) } },
  ];
  if (note.metadata.scheduled) {
    values.push({
      text: dateFromString(note.metadata.scheduled),
      icon: Icon.Calendar,
      tooltip: "Scheduled",
    });
  }
  if (note.metadata.deadline) {
    values.push({
      text: dateFromString(note.metadata.deadline),
      icon: Icon.Clock,
      tooltip: "Deadline",
    });
  }
  values.push(...note.metadata.tags.map((tag) => ({ tag })));
  return values;
}

export default function Notes() {
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [filter, setFilter] = useState<StateFilter>("ALL_NOT_DONE");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setNotes(await scanNotes(config.notesDir));
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not load notes",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mutate = useCallback(
    async (note: NoteFile, patch: MetadataPatch) => {
      try {
        const result = await editNote(note.path, patch, note.mtimeMs);
        if (result.conflict) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Note changed on disk",
            message: "Reloaded without overwriting the newer version.",
          });
        }
        await reload();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not update note",
          message: error instanceof Error ? error.message : String(error),
        });
        await reload();
      }
    },
    [reload],
  );

  const visible = filter === "ALL" ? notes : filter === "ALL_NOT_DONE" ? notes.filter(note => note.metadata.state !== "DONE") : notes.filter((note) => note.metadata.state === filter);
  return (
    <List
      isLoading={loading}
      searchBarPlaceholder="Search titles and tags"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by state"
          value={filter}
          onChange={(value) => setFilter(value as StateFilter)}
        >
          <List.Dropdown.Item title="All" value="ALL" />
          <List.Dropdown.Item title="TODO" value="TODO" />
          <List.Dropdown.Item title="DONE" value="DONE" />
          <List.Dropdown.Item title="None" value="NONE" />
        </List.Dropdown>
      }
    >
      {visible.map((note) => (
        <List.Item
          key={note.path}
          id={note.path}
          title={note.title || "Untitled"}
          keywords={note.metadata.tags}
          accessories={accessories(note)}
          actions={
            <ActionPanel>
              <Action
                title={`Cycle State to ${cycleState(note.metadata.state)}`}
                icon={Icon.ArrowClockwise}
                autoFocus
                onAction={() => void mutate(note, { state: cycleState(note.metadata.state) })}
              />
              <Action.Push
                title="Set/Clear Scheduled"
                icon={Icon.Calendar}
                target={<DateForm note={note} field="scheduled" mutate={mutate} />}
              />
              <Action.Push
                title="Set/Clear Deadline"
                icon={Icon.Clock}
                target={<DateForm note={note} field="deadline" mutate={mutate} />}
              />
              <Action.Push
                title="Edit Tags"
                icon={Icon.Tag}
                target={<TagsForm note={note} mutate={mutate} />}
              />
              <Action.Push
                title="Edit Note"
                icon={Icon.Pencil}
                target={<QuickNote note={note} onSaved={reload} />}
              />
              <Action.Open title="Open" target={note.path} icon={Icon.BlankDocument} />
              <Action.CopyToClipboard title="Copy Path" content={note.path} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
