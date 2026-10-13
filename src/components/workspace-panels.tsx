"use client";

import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  Check,
  CircleHelp,
  Download,
  FileText,
  Lightbulb,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  downloadFile,
  draftsCsv,
  draftStatuses,
  mergeWorkspace,
  parseWorkspace,
  starterTemplates,
  validPlanDate,
  type ContentDraft,
  type SavedIdea,
  type Workspace,
} from "@/lib/workspace";

export type WorkspaceView = "discover" | "saved" | "planner" | "settings";
export type ConnectionStatus = {
  discovery: boolean;
  analysis: boolean;
  storage: boolean;
  cloud: boolean;
  ready: boolean;
};
export const viewLabels: Record<WorkspaceView, string> = {
  discover: "Discover",
  saved: "Saved ideas",
  planner: "Content planner",
  settings: "Workspace settings",
};
export const navigation = [
  { id: "discover", label: "Discover", icon: Sparkles },
  { id: "saved", label: "Saved ideas", icon: Bookmark },
  { id: "planner", label: "Content planner", icon: CalendarDays },
] as const;

export function StarterLibrary({
  onCreate,
}: {
  onCreate: (template: (typeof starterTemplates)[number]) => void;
}) {
  return (
    <section className="starter-library" aria-labelledby="starter-heading">
      <div className="panel-section-heading">
        <div>
          <span className="eyebrow">LESS BLANK PAGE. MORE POSSIBILITIES.</span>
          <h2 id="starter-heading">Start with a format that fits.</h2>
        </div>
        <span className="muted-note">
          Editable starters · No live trend claims
        </span>
      </div>
      <div className="starter-grid">
        {starterTemplates.map((template, index) => (
          <button
            className={`starter-card ${template.tone}`}
            key={template.title}
            onClick={() => onCreate(template)}
          >
            <div className="starter-art" aria-hidden="true">
              <span className="format-number">0{index + 1}</span>
              <span className={`format-symbol format-${index}`}>
                <span />
                <span />
                <span />
              </span>
              <ArrowUpRight size={20} />
            </div>
            <div className="starter-copy">
              <span className="eyebrow">{template.label}</span>
              <h3>{template.title}</h3>
              <p>{template.format}</p>
              <span className="starter-action">
                Make it yours <ArrowRight size={15} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SavedIdeas({
  bookmarks,
  availableIds,
  onRemove,
  onCreate,
  onExplore,
  query,
}: {
  bookmarks: SavedIdea[];
  availableIds: Set<string>;
  onRemove: (id: string) => void;
  onCreate: (idea: SavedIdea) => void;
  onExplore: () => void;
  query: string;
}) {
  const filtered = bookmarks.filter((idea) =>
    `${idea.title} ${idea.creator} ${idea.platform}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  if (!filtered.length)
    return (
      <div className="workspace-empty">
        <Bookmark size={30} />
        <h2>
          {query
            ? "No saved ideas match your search."
            : "Keep the ideas that feel like you."}
        </h2>
        <p>
          {query
            ? "Try a different title, creator, or platform."
            : "Bookmark a trend while you browse. It will be here when you’re ready to create."}
        </p>
        <button className="primary-button" onClick={onExplore}>
          Explore ideas <ArrowRight size={16} />
        </button>
      </div>
    );
  return (
    <div className="saved-grid">
      {filtered.map((idea) => (
        <article className="saved-card" key={idea.id}>
          <div className="saved-card-top">
            <span className="platform-pill">{idea.platform}</span>
            <button
              className="icon-button"
              aria-label={`Remove ${idea.title} from saved ideas`}
              onClick={() => onRemove(idea.id)}
            >
              <Bookmark fill="currentColor" size={18} />
            </button>
          </div>
          <h2>{idea.title}</h2>
          <p>@{idea.creator.replace(/^@/, "")}</p>
          <span
            className={`source-status ${availableIds.has(idea.id) ? "current" : ""}`}
          >
            {availableIds.has(idea.id)
              ? "In the current verified collection"
              : "Saved reference · source needs a fresh check"}
          </span>
          <div className="saved-card-bottom">
            <button className="text-button" onClick={() => onCreate(idea)}>
              Create a post <ArrowRight size={15} />
            </button>
            {idea.url && (
              <a
                href={idea.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open original for ${idea.title}`}
              >
                <ArrowUpRight size={19} />
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

const statusLabels = {
  draft: "Drafts",
  planned: "Planned",
  published: "Published",
};
export function ContentPlanner({
  drafts,
  onEdit,
  onCreate,
  onDelete,
  query,
  onUndo,
}: {
  drafts: ContentDraft[];
  onEdit: (draft: ContentDraft) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  query: string;
  onUndo: (draft: ContentDraft) => void;
}) {
  const [deleted, setDeleted] = useState<ContentDraft | null>(null);
  const filtered = drafts.filter((draft) =>
    `${draft.title} ${draft.caption} ${draft.platform}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <>
      <div className="planner-intro">
        <span>
          <CalendarDays size={16} /> Your creative week, a little more
          organised.
        </span>
        <button
          className="text-button"
          disabled={!drafts.length}
          onClick={() =>
            downloadFile(
              "pretrends-content-plan.csv",
              "\uFEFF" + draftsCsv(drafts),
              "text/csv;charset=utf-8",
            )
          }
        >
          <Download size={15} /> Export CSV
        </button>
      </div>
      {deleted && (
        <div role="status" className="inline-notice">
          Post removed.
          <button
            className="text-button"
            onClick={() => {
              onUndo(deleted);
              setDeleted(null);
            }}
          >
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss undo"
            onClick={() => setDeleted(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="planner-board">
        {draftStatuses.map((status) => {
          const items = filtered
            .filter((draft) => draft.status === status)
            .sort((a, b) =>
              status === "planned"
                ? a.scheduledFor.localeCompare(b.scheduledFor)
                : b.updatedAt.localeCompare(a.updatedAt),
            );
          return (
            <section
              className={`planner-column column-${status}`}
              key={status}
              aria-label={statusLabels[status]}
            >
              <div className="column-heading">
                <span className="status-dot" />
                <h2>{statusLabels[status]}</h2>
                <span className="column-count">{items.length}</span>
                {status === "draft" && (
                  <button
                    className="icon-button"
                    aria-label="Add a draft"
                    onClick={onCreate}
                  >
                    <Plus size={17} />
                  </button>
                )}
              </div>
              {items.map((draft) => (
                <article key={draft.id} className="plan-card">
                  <button
                    className="plan-card-open"
                    onClick={() => onEdit(draft)}
                    aria-label={`Edit ${draft.title}`}
                  >
                    <span className="platform-pill">{draft.platform}</span>
                    <h3>{draft.title}</h3>
                    <p>
                      {draft.caption || "Add your hook and make it your own."}
                    </p>
                    <span className="plan-date">
                      <CalendarDays size={13} />
                      {draft.scheduledFor
                        ? new Date(
                            `${draft.scheduledFor}T12:00:00`,
                          ).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "No date yet"}
                    </span>
                  </button>
                  <button
                    className="delete-draft icon-button"
                    aria-label={`Delete ${draft.title}`}
                    onClick={() => {
                      setDeleted(draft);
                      onDelete(draft.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              ))}
              {!items.length && (
                <div className="column-empty">
                  <FileText size={23} strokeWidth={1.3} />
                  <p>
                    {query
                      ? "No matching posts"
                      : status === "draft"
                        ? "A good idea starts here."
                        : status === "planned"
                          ? "Give a draft a date to add it here."
                          : "Mark a post published once it’s live."}
                  </p>
                  {status === "draft" && !query && (
                    <button className="text-button" onClick={onCreate}>
                      Create your first post <Plus size={14} />
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <p className="planner-footnote">
        <CircleHelp size={14} /> Dates are reminders in your plan. Publish your
        finished posts on the original platform.
      </p>
    </>
  );
}

export function DraftEditor({
  draft,
  onSave,
  onClose,
}: {
  draft: ContentDraft;
  onSave: (draft: ContentDraft) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState("");
  const change = (field: keyof ContentDraft, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="idea-dialog draft-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("workspace-title")?.focus();
        }}
      >
        <span className="eyebrow">
          <Lightbulb size={15} /> YOUR NEXT POST
        </span>
        <DialogTitle>Make a little progress.</DialogTitle>
        <DialogDescription>
          Turn a spark into something ready to share.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.title.trim()) {
              setError("Give your post a title.");
              return;
            }
            if (
              !validPlanDate(form.scheduledFor) ||
              (form.status === "planned" && !form.scheduledFor)
            ) {
              setError("Choose a date for your planned post.");
              return;
            }
            onSave({
              ...form,
              title: form.title.trim(),
              updatedAt: new Date().toISOString(),
            });
          }}
        >
          <label className="brief-label">
            Post title
            <input
              autoFocus
              required
              maxLength={160}
              value={form.title}
              onChange={(event) => change("title", event.target.value)}
              placeholder="Give your next good idea a name"
            />
          </label>
          <div className="form-row">
            <label className="brief-label">
              Platform
              <select
                aria-label="Platform"
                value={form.platform}
                onChange={(event) => change("platform", event.target.value)}
              >
                {[
                  ...new Set([
                    "TikTok",
                    "Instagram",
                    "YouTube",
                    "Other",
                    form.platform,
                  ]),
                ].map((platform) => (
                  <option key={platform}>{platform}</option>
                ))}
              </select>
            </label>
            <label className="brief-label">
              Status
              <select
                aria-label="Status"
                value={form.status}
                onChange={(event) => change("status", event.target.value)}
              >
                <option value="draft">Draft</option>
                <option value="planned">Planned</option>
                <option value="published">Published</option>
              </select>
            </label>
            <label className="brief-label">
              Planned date
              <input
                type="date"
                required={form.status === "planned"}
                value={form.scheduledFor}
                onChange={(event) => change("scheduledFor", event.target.value)}
              />
            </label>
          </div>
          <label className="brief-label">
            Caption & opening hook
            <textarea
              rows={4}
              maxLength={10000}
              value={form.caption}
              onChange={(event) => change("caption", event.target.value)}
              placeholder="What will make someone stop scrolling?"
            />
          </label>
          <label className="brief-label">
            Shot list & notes
            <textarea
              rows={4}
              maxLength={10000}
              value={form.notes}
              onChange={(event) => change("notes", event.target.value)}
              placeholder="Plan the shots, props, and details you want to remember."
            />
          </label>
          {form.sourceUrl && (
            <a
              className="text-button"
              href={form.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View inspiration <ArrowUpRight size={14} />
            </a>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button type="button" className="outline-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              <Check size={16} /> Save post
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSettings({
  data,
  update,
  connections,
  onCheck,
}: {
  data: Workspace;
  update: (change: (current: Workspace) => Workspace) => void;
  connections: ConnectionStatus | null;
  onCheck: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <div className="settings-grid">
      <section className="settings-card">
        <div className="settings-icon">
          <Settings2 size={21} />
        </div>
        <h2>A space for your business.</h2>
        <p>Personalise your starter briefs. Changes save as you type.</p>
        <label className="brief-label">
          Business name
          <input
            maxLength={80}
            value={data.business}
            onChange={(event) =>
              update((current) => ({
                ...current,
                business: event.target.value,
              }))
            }
            placeholder="e.g. Luna Café"
          />
        </label>
        <div className="settings-note">
          <Bookmark size={17} />
          <p>
            Your workspace is saved in this browser. Use a backup to move it to
            another device or keep a copy before clearing browser data.
          </p>
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-icon">
          <Download size={21} />
        </div>
        <h2>Keep your good ideas.</h2>
        <p>Back up saved ideas, briefs, and your content plan.</p>
        <div className="backup-summary">
          <span>
            <strong>{data.bookmarks.length}</strong> saved ideas
          </span>
          <span>
            <strong>{data.drafts.length}</strong> posts
          </span>
        </div>
        <div className="backup-actions">
          <button
            className="primary-button"
            onClick={() => {
              downloadFile(
                "pretrends-workspace.json",
                JSON.stringify(data, null, 2),
                "application/json",
              );
              setMessage("Workspace backup downloaded.");
            }}
          >
            <Download size={15} /> Download backup
          </button>
          <label className="outline-button import-button">
            <Upload size={15} /> Import backup
            <input
              aria-label="Import workspace backup"
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 5 * 1024 * 1024)
                    throw new Error("Choose a backup smaller than 5 MB.");
                  const incoming = parseWorkspace(
                    JSON.parse(await file.text()),
                  );
                  update((current) => mergeWorkspace(current, incoming));
                  setMessage(
                    "Backup imported. Existing work is kept; newer drafts are merged.",
                  );
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "This backup could not be read.",
                  );
                }
              }}
            />
          </label>
        </div>
        <p className="muted-note">
          Import merges with your workspace. It does not replace your existing
          work.
        </p>
        {message && (
          <p className="inline-notice" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="settings-card connection-card">
        <div className="connection-heading">
          <div>
            <span className="eyebrow">LIVE DISCOVERY</span>
            <h2>Connected to the right signals.</h2>
          </div>
          <button className="outline-button" onClick={onCheck}>
            Check status
          </button>
        </div>
        <p>
          Fresh searches need a collection service and video analysis. Your
          planner works independently.
        </p>
        <div className="connection-list">
          {[
            {
              name: "Social video discovery",
              description: "Apify · TikTok and Instagram",
              configured: connections?.discovery,
            },
            {
              name: "Video understanding",
              description: "Grafilab · Visual activity checks",
              configured: connections?.analysis,
            },
            {
              name: "Collection storage",
              description: connections?.cloud
                ? "Vercel Blob · Shared collection"
                : "Local disk · This server",
              configured: connections?.storage,
            },
          ].map((item) => (
            <div className="connection-row" key={item.name}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </span>
              <span
                className={`connection-badge ${item.configured ? "connected" : ""}`}
              >
                {connections === null
                  ? "Status unavailable"
                  : item.configured
                    ? "Configured"
                    : "Setup needed"}
              </span>
            </div>
          ))}
        </div>
        <p className="muted-note">
          Status checks configuration only; provider access is checked during a
          search.
        </p>
        {connections && !connections.ready && (
          <div className="settings-note">
            <CircleHelp size={18} />
            <p>
              The site owner needs to configure the services listed in the
              project’s setup guide. Until then, create posts with the editable
              starter formats.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
