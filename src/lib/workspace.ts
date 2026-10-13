export const WORKSPACE_KEY = "pretrends.workspace.v1";
export const draftStatuses = ["draft", "planned", "published"] as const;
export type DraftStatus = (typeof draftStatuses)[number];
export type SavedIdea = {
  id: string;
  title: string;
  creator: string;
  platform: string;
  url: string;
  savedAt: string;
};
export type ContentDraft = {
  id: string;
  title: string;
  caption: string;
  notes: string;
  platform: string;
  status: DraftStatus;
  scheduledFor: string;
  sourceUrl: string;
  sourceId: string;
  updatedAt: string;
};
export type Workspace = {
  version: 1;
  business: string;
  bookmarks: SavedIdea[];
  drafts: ContentDraft[];
  briefs: { id: string; caption: string }[];
};
export const emptyWorkspace: Workspace = {
  version: 1,
  business: "",
  bookmarks: [],
  drafts: [],
  briefs: [],
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid workspace file.");
  return value as Record<string, unknown>;
}
function string(value: unknown, limit = 10000): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error("Invalid workspace field.");
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error(
      "Workspace must contain at most 1,000 items per collection.",
    );
  return value;
}
function url(value: unknown): string {
  const result = string(value, 2048);
  if (result && !/^https?:\/\//i.test(result))
    throw new Error("Source links must start with http:// or https://.");
  if (result) {
    try {
      new URL(result);
    } catch {
      throw new Error("Invalid source link.");
    }
  }
  return result;
}
function timestamp(value: unknown): string {
  const result = string(value, 40);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error("Invalid saved date.");
  return result;
}
export function validPlanDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (items.some((item) => !item.id.trim()))
    throw new Error("Missing item ID.");
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
// Whitelist fields and validate persisted/imported data before it reaches the UI.
export function parseWorkspace(value: unknown): Workspace {
  const data = record(value);
  if (data.version !== 1)
    throw new Error("This is not a supported Pretrends backup.");
  return {
    version: 1,
    business: string(data.business, 80),
    bookmarks: unique(
      list(data.bookmarks).map((value) => {
        const item = record(value);
        return {
          id: string(item.id, 200),
          title: string(item.title, 500),
          creator: string(item.creator, 200),
          platform: string(item.platform, 40),
          url: url(item.url),
          savedAt: timestamp(item.savedAt),
        };
      }),
    ),
    drafts: unique(
      list(data.drafts).map((value) => {
        const item = record(value);
        if (!draftStatuses.includes(item.status as DraftStatus))
          throw new Error("Invalid draft status.");
        const scheduledFor = string(item.scheduledFor, 10);
        if (
          !validPlanDate(scheduledFor) ||
          (item.status === "planned" && !scheduledFor)
        )
          throw new Error("A planned post needs a valid date.");
        const title = string(item.title, 160).trim();
        if (!title) throw new Error("Give your post a title.");
        return {
          id: string(item.id, 200),
          title,
          caption: string(item.caption),
          notes: string(item.notes),
          platform: string(item.platform, 40),
          status: item.status as DraftStatus,
          scheduledFor,
          sourceUrl: url(item.sourceUrl),
          sourceId: string(item.sourceId, 200),
          updatedAt: timestamp(item.updatedAt),
        };
      }),
    ),
    briefs: unique(
      list(data.briefs).map((value) => {
        const item = record(value);
        return { id: string(item.id, 200), caption: string(item.caption) };
      }),
    ),
  };
}
export function mergeWorkspace(
  current: Workspace,
  incoming: Workspace,
): Workspace {
  const drafts = new Map(current.drafts.map((draft) => [draft.id, draft]));
  for (const draft of incoming.drafts) {
    const existing = drafts.get(draft.id);
    if (
      !existing ||
      Date.parse(draft.updatedAt) > Date.parse(existing.updatedAt)
    )
      drafts.set(draft.id, draft);
  }
  return parseWorkspace({
    ...current,
    business: current.business || incoming.business,
    bookmarks: unique([...incoming.bookmarks, ...current.bookmarks]),
    drafts: [...drafts.values()],
    briefs: unique([...incoming.briefs, ...current.briefs]),
  });
}
export function draftsCsv(drafts: ContentDraft[]): string {
  const cell = (value: string) => {
    // Neutralize formulas when opening a user-authored caption in a spreadsheet.
    const safe =
      /^[\s]*[=+@-]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    [
      "Title",
      "Platform",
      "Status",
      "Planned date",
      "Caption",
      "Shot list / notes",
      "Source",
    ],
    ...drafts.map((draft) => [
      draft.title,
      draft.platform,
      draft.status,
      draft.scheduledFor,
      draft.caption,
      draft.notes,
      draft.sourceUrl,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export function downloadFile(name: string, contents: string, type: string) {
  const objectUrl = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export const starterTemplates = [
  {
    title: "A little behind the scenes",
    label: "BUILD CONNECTION",
    tone: "lilac",
    format: "15–30 sec · Behind the scenes",
    caption:
      "A little of what happens before it reaches you. Here’s how we make it happen.",
    notes:
      "1. Open with the finished product.\n2. Film three quick moments from your process.\n3. End with the person behind the work and a question.",
  },
  {
    title: "One product. Three ways.",
    label: "SHOW YOUR VALUE",
    tone: "peach",
    format: "20–40 sec · Product story",
    caption:
      "One favourite, three ways to make it yours. Which one would you pick?",
    notes:
      "1. Introduce your product in a close-up.\n2. Show three ways to use or style it.\n3. Invite viewers to choose their favourite.",
  },
  {
    title: "The question we always get",
    label: "SHARE WHAT YOU KNOW",
    tone: "sage",
    format: "15–30 sec · Quick answer",
    caption:
      "You asked, so let’s talk about it. Here’s the one thing we wish everyone knew.",
    notes:
      "1. Put a common customer question on screen.\n2. Demonstrate the answer with your product.\n3. Ask what they want to know next.",
  },
] as const;
