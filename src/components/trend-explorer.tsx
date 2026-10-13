"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SOURCE_MAX_AGE_MS } from "@/lib/post-policy";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  Flame,
  LayoutGrid,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  categories,
  cleanTrendMatterReason,
  growth,
  matchesCategories,
  matchesCategory,
  normalizeTrends,
  starterIdea,
  trendGrowthReasons,
  type Trend,
} from "@/lib/trends";
import { PredictionViews } from "./prediction-views";
import { sameBatchFilters, type RefreshBatch } from "@/lib/refresh-batch";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  useWorkspaceView,
  navigateWorkspace,
} from "@/hooks/use-workspace-view";
import {
  starterTemplates,
  type ContentDraft,
  type SavedIdea,
} from "@/lib/workspace";
import {
  ContentPlanner,
  DraftEditor,
  SavedIdeas,
  StarterLibrary,
  WorkspaceSettings,
  navigation,
  viewLabels,
  type WorkspaceView,
  type ConnectionStatus,
} from "./workspace-panels";
import "./trend-explorer.css";
import "./workspace.css";
import { refreshIdeas } from "@/lib/scan-client";

async function loadConnections(
  signal?: AbortSignal,
): Promise<ConnectionStatus> {
  const response = await fetch("/api/health", {
    cache: "no-store",
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(10000),
    ]),
  });
  if (!response.ok) throw new Error("Status unavailable");
  const services = (await response.json()).services;
  if (
    !services ||
    !["discovery", "analysis", "storage", "cloud", "ready"].every(
      (key) => typeof services[key] === "boolean",
    )
  ) {
    throw new Error("Status unavailable");
  }
  return services;
}

function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="filter-trigger" aria-label={label}>
        {options.find((option) => option.value === value)?.label}
        <ChevronDown size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="filter-menu"
          align="end"
          sideOffset={6}
          collisionPadding={12}
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenu.RadioItem
                className="filter-option"
                key={option.value}
                value={option.value}
              >
                <span className="filter-check">
                  <DropdownMenu.ItemIndicator>
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
// Limit preview recovery requests across cards and the open dialog.
let previewRequests = 0;
const previewWaiters: (() => void)[] = [];
const previewBlobs = new Map<string, Blob>();
async function previewSlot(eager: boolean) {
  if (previewRequests >= 3)
    await new Promise<void>((resolve) =>
      eager ? previewWaiters.unshift(resolve) : previewWaiters.push(resolve),
    );
  else previewRequests++;
  return () => {
    const next = previewWaiters.shift();
    if (next) next();
    else previewRequests--;
  };
}
function TrendArtwork({
  trend,
  eager = false,
  onOpen,
}: {
  trend: Trend;
  eager?: boolean;
  onOpen?: (button: HTMLButtonElement) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  const source = trend.previewUrl || trend.image;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "",
      started = false;
    async function load() {
      if (started) return;
      started = true;
      setImage("");
      setFailed(false);
      if (!source) {
        setFailed(true);
        return;
      }
      const cached = previewBlobs.get(source);
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setImage(objectUrl);
        return;
      }
      const release = await previewSlot(eager);
      try {
        if (controller.signal.aborted) return;
        const response = await fetch(source, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(60000),
          ]),
        });
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("Invalid preview");
        if (!controller.signal.aborted) {
          if (previewBlobs.size >= 100)
            previewBlobs.delete(previewBlobs.keys().next().value!);
          previewBlobs.set(source, blob);
          objectUrl = URL.createObjectURL(blob);
          setImage(objectUrl);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        release();
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "200px" },
    );
    if (eager) void load();
    else if (container.current) observer.observe(container.current);
    return () => {
      controller.abort();
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, attempt, eager]);
  const artwork =
    image && !failed ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={trend.title}
        onError={() => {
          if (source) previewBlobs.delete(source);
          setFailed(true);
        }}
      />
    ) : (
      <span className="preview-loading">
        {failed ? "Preview could not load" : "Loading preview…"}
      </span>
    );
  return (
    <div ref={container} className="trend-art" aria-busy={!image && !failed}>
      {onOpen ? (
        <button
          className="preview-open"
          aria-label={`Open details for ${trend.title}`}
          aria-haspopup="dialog"
          onClick={(event) => onOpen(event.currentTarget)}
        >
          {artwork}
        </button>
      ) : (
        artwork
      )}
      {failed && (
        <div className="preview-recovery">
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </button>
          {trend.url && (
            <a href={trend.url} target="_blank" rel="noreferrer">
              Watch original
            </a>
          )}
        </div>
      )}
    </div>
  );
}
export default function TrendExplorer({
  initialTrends,
}: {
  initialTrends: Trend[];
}) {
  const [trends, setTrends] = useState(initialTrends);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState("score");
  const workspace = useWorkspace();
  const saved = workspace.data.bookmarks.map((idea) => idea.id);
  const business = workspace.data.business;
  const view = useWorkspaceView();
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [editing, setEditing] = useState<ContentDraft | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  async function checkConnections(signal?: AbortSignal) {
    try {
      setConnections(await loadConnections(signal));
      setConnectionMessage("");
    } catch {
      if (!signal?.aborted)
        setConnectionMessage(
          "Connection status is unavailable. You can keep using your workspace.",
        );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    loadConnections(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setConnections(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setConnectionMessage(
            "Connection status is unavailable. You can keep using your workspace.",
          );
      });
    return () => controller.abort();
  }, []);
  function navigate(next: WorkspaceView) {
    setWorkspaceQuery("");
    navigateWorkspace(next);
  }
  function setBusiness(value: string) {
    workspace.update((current) => ({ ...current, business: value }));
  }
  function newDraft(values: Partial<ContentDraft> = {}) {
    setEditing({
      id: crypto.randomUUID(),
      caption: "",
      notes: "",
      platform: "TikTok",
      status: "draft",
      scheduledFor: "",
      sourceUrl: "",
      sourceId: "",
      updatedAt: new Date().toISOString(),
      ...values,
      title: values.title?.slice(0, 160) || "",
    });
  }
  function createFromTemplate(template: (typeof starterTemplates)[number]) {
    newDraft({
      title: template.title,
      caption: template.caption,
      notes: template.notes,
    });
  }
  function saveDraft(draft: ContentDraft) {
    try {
      workspace.update((current) => ({
        ...current,
        drafts: [
          ...current.drafts.filter((item) => item.id !== draft.id),
          draft,
        ],
      }));
      setEditing(null);
      navigate("planner");
      setMessage(`Saved “${draft.title}” to your content plan.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save this post.",
      );
    }
  }
  function createFromSaved(idea: SavedIdea) {
    const trend = trends.find((trend) => trend.id === idea.id);
    const brief = workspace.data.briefs.find((brief) => brief.id === idea.id);
    newDraft({
      title: idea.title,
      sourceId: idea.id,
      sourceUrl: idea.url,
      platform: idea.platform,
      caption:
        brief?.caption ?? (trend ? starterIdea(trend, business).hook : ""),
      notes: trend
        ? starterIdea(trend, business)
            .steps.map((step, i) => `${i + 1}. ${step}`)
            .join("\n")
        : "",
    });
  }
  const [selected, setSelected] = useState<Trend | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  // Expiry is local: no paid request is triggered by opening or leaving the page open.
  useEffect(() => {
    if (!trends.length) return;
    const expiresAt = Math.min(
      ...trends.map(
        (post) => Date.parse(post.sourceVerifiedAt) + SOURCE_MAX_AGE_MS,
      ),
    );
    const timeout = setTimeout(
      () => {
        setTrends((current) =>
          current.filter(
            (post) =>
              Date.parse(post.sourceVerifiedAt) + SOURCE_MAX_AGE_MS >
              Date.now(),
          ),
        );
      },
      Math.max(0, expiresAt - Date.now() + 1),
    );
    return () => clearTimeout(timeout);
  }, [trends]);
  const [howOpen, setHowOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [refreshBatch, setRefreshBatch] = useState<RefreshBatch | null>(null);
  const [message, setMessage] = useState("");
  const activeFilters = useRef({
    categories: selectedCategories,
    platform,
    query,
  });
  useEffect(() => {
    activeFilters.current = { categories: selectedCategories, platform, query };
  }, [selectedCategories, platform, query]);
  const filtered = trends
    .filter(
      (trend) =>
        matchesCategories(trend, selectedCategories) &&
        (platform === "all" || trend.platform === platform) &&
        `${trend.title} ${trend.reason} ${trend.creator}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => {
      if (sort === "views") return b.currentViews - a.currentViews;
      if (sort === "recent")
        return Date.parse(b.sourceVerifiedAt) - Date.parse(a.sourceVerifiedAt);
      if (sort === "growth")
        return (growth(b) ?? -Infinity) - (growth(a) ?? -Infinity);
      return b.score - a.score;
    });
  const batchIds = new Set(refreshBatch?.ids || []);
  const batchPosts = filtered.filter((post) => batchIds.has(post.id));
  const remainingPosts = filtered.filter((post) => !batchIds.has(post.id));
  const visible = refreshBatch
    ? [...batchPosts, ...remainingPosts].slice(0, visibleCount)
    : filtered.slice(0, visibleCount);
  const selectedAvailable =
    selected !== null && trends.some((post) => post.id === selected.id);
  function toggleSave(trend: Trend) {
    const wasSaved = saved.includes(trend.id);
    workspace.update((current) => ({
      ...current,
      bookmarks: wasSaved
        ? current.bookmarks.filter((idea) => idea.id !== trend.id)
        : [
            ...current.bookmarks,
            {
              id: trend.id,
              title: trend.title,
              creator: trend.creator,
              platform: trend.platform,
              url: trend.url || "",
              savedAt: new Date().toISOString(),
            },
          ],
    }));
    setMessage(
      wasSaved
        ? `Removed ${trend.title} from saved ideas.`
        : `Saved ${trend.title} to your ideas.`,
    );
  }
  function openIdea(trend: Trend, trigger: HTMLButtonElement) {
    detailTrigger.current = trigger;
    setSelected(trend);
    setCaption(
      workspace.data.briefs.find((brief) => brief.id === trend.id)?.caption ??
        starterIdea(trend, business).hook,
    );
    setCopied(false);
  }
  function editCaption(value: string) {
    setCaption(value);
    setCopied(false);
    if (selected)
      workspace.update((current) => ({
        ...current,
        briefs: [
          ...current.briefs.filter((brief) => brief.id !== selected.id),
          { id: selected.id, caption: value },
        ],
      }));
  }
  function resetFilters() {
    setRefreshBatch(null);
    setSelectedCategories([]);
    setQuery("");
    setPlatform("all");
    setVisibleCount(12);
  }
  function toggleCategory(id: string) {
    setRefreshBatch(null);
    setVisibleCount(12);
    if (id === "all") {
      setSelectedCategories([]);
      return;
    }
    setSelectedCategories((previous) =>
      previous.includes(id)
        ? previous.filter((category) => category !== id)
        : previous.length < 4
          ? [...previous, id]
          : previous,
    );
  }
  const [scanning, setScanning] = useState(false);
  const pollController = useRef<AbortController | null>(null);
  useEffect(() => () => pollController.current?.abort(), []);
  const applyCollection = useCallback((data: unknown, keepCurrent = false) => {
    // Successful responses contain the full saved collection, including removals.
    const incoming = [
      ...new Map(normalizeTrends(data).map((post) => [post.id, post])).values(),
    ];
    setTrends((current) =>
      keepCurrent
        ? [
            ...new Map(
              [...current, ...incoming].map((post) => [post.id, post]),
            ).values(),
          ]
        : incoming,
    );
    setSelected((current) =>
      current
        ? incoming.find((post) => post.id === current.id) || current
        : null,
    );
  }, []);
  async function runLiveScan() {
    if (pollController.current) return;
    const controller = new AbortController();
    pollController.current = controller;
    const requestedFilters = { categories: [...selectedCategories], platform };
    setScanning(true);
    try {
      await refreshIdeas({
        signal: controller.signal,
        ...requestedFilters,
        onCollection: applyCollection,
        onMessage: setMessage,
        onComplete: (result) => {
          const filters = activeFilters.current;
          const hasMatches = normalizeTrends(result.data.candidates).some(
            (post) =>
              matchesCategories(post, filters.categories) &&
              (filters.platform === "all" ||
                post.platform === filters.platform) &&
              `${post.title} ${post.reason} ${post.creator}`
                .toLowerCase()
                .includes(filters.query.toLowerCase().trim()),
          );
          if (result.batch && sameBatchFilters(requestedFilters, filters)) {
            setRefreshBatch(result.batch);
            setVisibleCount((count) => Math.max(count, 12));
            const batch: RefreshBatch = result.batch;
            setMessage(
              `${batch.ids.length} ideas ready · ${batch.fresh_count} fresh, ${batch.reused_count} saved.${batch.ids.length < 12 ? " Fewer than 12 verified matches are available." : ""}`,
            );
          } else {
            setMessage(
              hasMatches
                ? "Ideas updated. Your current filters are applied."
                : "No matching ideas found. Try another topic.",
            );
          }
        },
      });
    } finally {
      if (pollController.current === controller) pollController.current = null;
      if (!controller.signal.aborted) setScanning(false);
    }
  }
  async function copyBrief() {
    if (!selected) return;
    const idea = starterIdea(selected, business);
    try {
      await navigator.clipboard.writeText(
        `${business.trim() || "My business"} — ${selected.title}\n\nPost idea\n${caption}\n\nShot list\n${idea.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}\n\nStarter template inspired by a stored trend.`,
      );
      setCopied(true);
    } catch {
      setMessage(
        "Clipboard is unavailable. You can select and copy the text in the brief.",
      );
    }
  }
  return (
    <div className="explorer">
      <a
        className="skip-link"
        href="#workspace-title"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("workspace-title")?.focus();
          document.getElementById("workspace-title")?.scrollIntoView();
        }}
      >
        Skip to workspace
      </a>
      <aside className="workspace-sidebar">
        <button
          className="brand"
          onClick={() => {
            resetFilters();
            navigate("discover");
          }}
          aria-label="Pretrends home"
        >
          <span className="brand-symbol">
            <Radar size={23} strokeWidth={1.7} />
          </span>
          pretrends<span className="brand-period">.</span>
        </button>
        <span className="sidebar-label">YOUR CREATIVE SPACE</span>
        <nav aria-label="Workspace">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`sidebar-link ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "saved" && (
                <span className="nav-count">{saved.length}</span>
              )}
              {item.id === "planner" && workspace.data.drafts.length > 0 && (
                <span className="nav-count">
                  {workspace.data.drafts.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <span className="tip-star" aria-hidden="true">
            ✳
          </span>
          <h2>
            Small sparks.
            <br />
            Big possibilities.
          </h2>
          <p>Your next great post starts with a little curiosity.</p>
          <button onClick={() => setHowOpen(true)}>
            Find your starting point <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`sidebar-link ${view === "settings" ? "active" : ""}`}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            <span>Workspace settings</span>
          </button>
          <button className="sidebar-link" onClick={() => setHowOpen(true)}>
            <CircleHelp size={18} />
            <span>A little help</span>
          </button>
          <div className="workspace-profile">
            <span className="profile-avatar">
              {business.trim().slice(0, 1).toUpperCase() || "Y"}
            </span>
            <div>
              <strong>{business || "Your workspace"}</strong>
              <span>Personal · Saved in this browser</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div>
            <span className="topbar-workspace">Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <span>{viewLabels[view]}</span>
          </div>
          <button
            className="workspace-mode"
            onClick={() => navigate("settings")}
          >
            <span
              className={`status-dot ${connections?.ready ? "ready" : ""}`}
            />
            {connections === null
              ? "Personal workspace"
              : connections.ready
                ? "Discovery configured"
                : "Planner ready"}
            <ChevronDown size={13} />
          </button>
        </header>
        <main className="page-width workspace-main">
          {view === "discover" ? (
            <section
              className="discovery-hero"
              aria-labelledby="workspace-title"
            >
              <div className="hero-copy">
                <span className="eyebrow">
                  <span className="little-star">✳</span> A LITTLE AHEAD OF THE
                  CURVE
                </span>
                <h1 id="workspace-title" tabIndex={-1}>
                  Your next good idea
                  <br />
                  is <em>closer than you think.</em>
                </h1>
                <p>
                  Find the signal. Add your own twist.
                  <br />
                  Turn a little inspiration into your next business post.
                </p>
                <button className="hero-link" onClick={() => setHowOpen(true)}>
                  Let’s find your spark <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <div className="radar-orbit orbit-one" />
                <div className="radar-orbit orbit-two" />
                <div className="radar-orbit orbit-three" />
                <span className="hero-asterisk">✳</span>
                <span className="orbit-spark spark-a">✦</span>
                <span className="orbit-spark spark-b">✧</span>
                <div className="hero-floating floating-signal">
                  <span>
                    <TrendingUp size={19} />
                  </span>
                  <div>
                    <strong>See the signal</strong>
                    <small>Find something worth creating</small>
                  </div>
                </div>
                <div className="hero-floating floating-idea">
                  <Sparkles size={25} />
                  <span>
                    Your point of view.
                    <br />
                    <strong>That’s the good part.</strong>
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">YOUR CREATIVE SPACE</span>
                <h1 id="workspace-title" tabIndex={-1}>
                  {view === "saved"
                    ? "Good ideas, kept close."
                    : view === "planner"
                      ? "From someday to post day."
                      : "Make yourself at home."}
                </h1>
                <p>
                  {view === "saved"
                    ? "Your collection of sparks, ready for your own twist."
                    : view === "planner"
                      ? "A clear place for every idea, from the first draft to the final post."
                      : "Your business, your connections, and everything you’ve been creating."}
                </p>
              </div>
              {view === "planner" && (
                <button className="primary-button" onClick={() => newDraft()}>
                  <Plus size={16} /> New post
                </button>
              )}
            </div>
          )}
          {view === "discover" && (
            <div className="workspace-stats">
              <div>
                <span className="stat-icon">
                  <LayoutGrid size={19} />
                </span>
                <span>
                  <small>Verified ideas</small>
                  <strong>
                    {trends.length.toLocaleString()}
                    <em>ready to explore</em>
                  </strong>
                </span>
              </div>
              <button onClick={() => navigate("saved")}>
                <span className="stat-icon">
                  <Bookmark size={19} />
                </span>
                <span>
                  <small>Saved for later</small>
                  <strong>
                    {saved.length}
                    <em>little sparks</em>
                  </strong>
                </span>
                <ArrowUpRight size={15} />
              </button>
              <button onClick={() => navigate("planner")}>
                <span className="stat-icon">
                  <CalendarDays size={19} />
                </span>
                <span>
                  <small>In your content plan</small>
                  <strong>
                    {
                      workspace.data.drafts.filter(
                        (draft) => draft.status !== "published",
                      ).length
                    }
                    <em>ideas in motion</em>
                  </strong>
                </span>
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {workspace.error && (
            <div className="inline-notice" role="alert">
              <CircleHelp size={16} />
              {workspace.error}
              <button
                className="text-button"
                onClick={() => navigate("settings")}
              >
                Open backups
              </button>
            </div>
          )}
          {connectionMessage && (
            <p className="inline-notice" role="status">
              {connectionMessage}
            </p>
          )}
          {message && (
            <div className="status-message" role="status">
              <CircleHelp size={15} />
              <span>{message}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setMessage("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {view === "discover" && (
            <section
              id="ideas"
              tabIndex={-1}
              className="ideas-section"
              aria-labelledby="ideas-heading"
            >
              <div className="section-heading">
                <div>
                  <div className="eyebrow section-eyebrow">
                    YOUR DISCOVERY FEED
                  </div>
                  <h2 id="ideas-heading">
                    Find something that feels like you.
                  </h2>
                  <p>
                    Real posts. Visible activity. A fresh perspective for your
                    business.
                  </p>
                </div>
                <div className="collection-actions">
                  <button
                    className="collection-button collection-button-primary"
                    onClick={() => runLiveScan()}
                    disabled={scanning}
                  >
                    <RefreshCw
                      size={14}
                      className={scanning ? "spinning" : ""}
                    />
                    {scanning ? "Finding ideas…" : "Find fresh ideas"}
                  </button>
                </div>
              </div>
              <div className="filter-row">
                <div className="category-list" aria-label="Filter by topic">
                  {categories.map((cat) => {
                    const isSelected =
                      cat.id === "all"
                        ? selectedCategories.length === 0
                        : selectedCategories.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        aria-pressed={isSelected}
                        disabled={
                          cat.id !== "all" &&
                          !isSelected &&
                          selectedCategories.length >= 4
                        }
                        className={`category-button ${isSelected ? "category-active" : ""}`}
                        onClick={() => toggleCategory(cat.id)}
                      >
                        {cat.id === "all" ? (
                          <Sparkles size={14} />
                        ) : (
                          isSelected && <Check size={14} />
                        )}
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
                <div className="category-hint">
                  <span>
                    Select up to 4 categories. Videos must match every selected
                    category.
                  </span>
                  <span>{selectedCategories.length}/4 selected</span>
                </div>
              </div>
              <div className="collection-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Search ideas"
                    placeholder="Find something for your business…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setVisibleCount(12);
                    }}
                  />
                  {query && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <div className="toolbar-selects">
                  <FilterMenu
                    label="Filter by platform"
                    value={platform}
                    options={[
                      { value: "all", label: "All platforms" },
                      { value: "TikTok", label: "TikTok" },
                      { value: "Instagram", label: "Instagram" },
                    ]}
                    onChange={(value) => {
                      setRefreshBatch(null);
                      setPlatform(value);
                      setVisibleCount(12);
                    }}
                  />
                  <FilterMenu
                    label="Sort ideas"
                    value={sort}
                    options={[
                      { value: "growth", label: "View growth" },
                      { value: "score", label: "Signal score" },
                      { value: "views", label: "Most views" },
                      { value: "recent", label: "Recently checked" },
                    ]}
                    onChange={setSort}
                  />
                </div>
              </div>
              <div className="collection-caption">
                <span>
                  {filtered.length} {filtered.length === 1 ? "idea" : "ideas"}{" "}
                  to explore
                </span>
                <span>
                  <ShieldCheck size={13} /> Source-verified collection
                </span>
              </div>
              <div className="trend-grid">
                {visible.map((trend) => {
                  const savedIdea = saved.includes(trend.id);
                  const percent = growth(trend);
                  return (
                    <article className="trend-card" key={trend.id}>
                      <div className="card-image">
                        <TrendArtwork
                          trend={trend}
                          onOpen={(button) => openIdea(trend, button)}
                        />
                        <span className="platform-tag">
                          {trend.platform === "TikTok"
                            ? "♪"
                            : trend.platform === "YouTube"
                              ? "▶"
                              : trend.platform === "X"
                                ? "𝕏"
                                : "◎"}{" "}
                          {trend.platform}
                        </span>
                        <button
                          className={`bookmark-button ${savedIdea ? "is-saved" : ""}`}
                          aria-label={`${savedIdea ? "Unsave" : "Save"} ${trend.title}`}
                          aria-pressed={savedIdea}
                          onClick={() => toggleSave(trend)}
                        >
                          <Bookmark
                            size={17}
                            fill={savedIdea ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      <div className="card-content">
                        <div className="card-kicker">
                          <span>
                            {categories
                              .filter(
                                (cat) =>
                                  cat.id !== "all" &&
                                  matchesCategory(trend, cat.id),
                              )
                              .map((cat) => cat.label)
                              .join(" · ")}
                          </span>
                          <span
                            className={`signal-badge ${
                              trend.score >= 80
                                ? "signal-strong"
                                : trend.score >= 50
                                  ? "signal-medium"
                                  : "signal-weak"
                            }`}
                          >
                            <Flame size={12} />
                            {!trend.hasBaseline
                              ? "First observation"
                              : trend.score >= 80
                                ? "Trending signal"
                                : trend.score >= 50
                                  ? "Mid signal"
                                  : "Weak signal"}
                          </span>
                        </div>
                        <h3>
                          <button
                            className="card-open"
                            aria-haspopup="dialog"
                            aria-label={`View details for ${trend.title}`}
                            onClick={(event) =>
                              openIdea(trend, event.currentTarget)
                            }
                          >
                            {trend.title}
                          </button>
                        </h3>
                        <PredictionViews trend={trend} compact />
                        <div className="card-metrics">
                          <span
                            className={`growth-value ${percent !== null && percent < 0 ? "growth-negative" : ""}`}
                          >
                            <ArrowUpRight size={14} />
                            {percent === null
                              ? "First observation"
                              : `${percent > 0 ? "+" : ""}${percent.toLocaleString()}% measured growth`}
                          </span>
                          <span>
                            {refreshBatch && batchIds.has(trend.id)
                              ? "Refresh batch"
                              : "Stored"}
                          </span>
                        </div>
                        <button
                          className="card-action"
                          aria-haspopup="dialog"
                          onClick={(event) =>
                            openIdea(trend, event.currentTarget)
                          }
                        >
                          View trend <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {visible.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Radar size={28} strokeWidth={1.3} />
                  </span>
                  <h3>
                    {trends.length
                      ? "Nothing here with those filters. Yet."
                      : "A fresh space for your next discovery."}
                  </h3>
                  <p>
                    {trends.length
                      ? "Try a broader search or a different combination of categories."
                      : connections?.ready
                        ? "Choose a topic and find fresh ideas to build your collection."
                        : "Live discovery is waiting for its connections. In the meantime, turn a starter format into your first post."}
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (trends.length) resetFilters();
                      else navigate("settings");
                    }}
                  >
                    {trends.length ? "Clear filters" : "View connections"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {visible.length < filtered.length && (
                <div className="load-more">
                  <button
                    className="outline-button"
                    onClick={() => setVisibleCount((previous) => previous + 12)}
                  >
                    Show next {Math.min(12, filtered.length - visible.length)}{" "}
                    ideas <ChevronDown size={15} />
                  </button>
                  <span>
                    Showing {visible.length} of {filtered.length} ideas
                  </span>
                </div>
              )}
            </section>
          )}
          {(view === "saved" || view === "planner") && (
            <label className="search-field workspace-search">
              <Search size={16} />
              <input
                aria-label={
                  view === "saved"
                    ? "Search saved ideas"
                    : "Search content plan"
                }
                value={workspaceQuery}
                onChange={(event) => setWorkspaceQuery(event.target.value)}
                placeholder={
                  view === "saved"
                    ? "Find a saved spark…"
                    : "Find a post in your plan…"
                }
              />
              {workspaceQuery && (
                <button
                  aria-label="Clear workspace search"
                  onClick={() => setWorkspaceQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
          )}
          {view === "saved" && (
            <SavedIdeas
              bookmarks={workspace.data.bookmarks}
              availableIds={new Set(trends.map((trend) => trend.id))}
              query={workspaceQuery}
              onCreate={createFromSaved}
              onExplore={() => navigate("discover")}
              onRemove={(id) =>
                workspace.update((current) => ({
                  ...current,
                  bookmarks: current.bookmarks.filter((idea) => idea.id !== id),
                }))
              }
            />
          )}
          {view === "planner" && (
            <ContentPlanner
              drafts={workspace.data.drafts}
              onCreate={() => newDraft()}
              onEdit={setEditing}
              query={workspaceQuery}
              onDelete={(id) =>
                workspace.update((current) => ({
                  ...current,
                  drafts: current.drafts.filter((draft) => draft.id !== id),
                }))
              }
              onUndo={(draft) =>
                workspace.update((current) => ({
                  ...current,
                  drafts: [
                    ...current.drafts.filter((item) => item.id !== draft.id),
                    draft,
                  ],
                }))
              }
            />
          )}
          {view === "settings" && (
            <WorkspaceSettings
              data={workspace.data}
              update={workspace.update}
              connections={connections}
              onCheck={() => void checkConnections()}
            />
          )}
          {(view === "discover" ||
            (view === "planner" && !workspace.data.drafts.length)) && (
            <StarterLibrary onCreate={createFromTemplate} />
          )}
          <footer className="workspace-footer">
            <span>Made for your next good idea.</span>
            <span>
              Less scrolling. More creating. <Sparkles size={13} />
            </span>
          </footer>
        </main>
      </div>
      {editing && (
        <DraftEditor
          key={editing.id + editing.updatedAt}
          draft={editing}
          onSave={saveDraft}
          onClose={() => setEditing(null)}
        />
      )}

      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent className="idea-dialog how-dialog">
          <span className="eyebrow">FROM SCROLLING TO CREATING</span>
          <DialogTitle>One trend. Your own twist.</DialogTitle>
          <DialogDescription>
            A simple way to find your next business post.
          </DialogDescription>
          <ol className="how-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Find your spark</h3>
                <p>
                  Choose a topic that fits your business. Browse ideas from
                  different platforms.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Check the signal</h3>
                <p>
                  Compare the two view counts and read the explanation. Growth
                  is a clue, not a promise of success.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make it yours</h3>
                <p>
                  Add your business name, edit the starter hook, and copy your
                  post brief.
                </p>
              </div>
            </li>
          </ol>
          <div className="honest-note">
            Browse saved posts or find fresh trends. Live posts include AI
            guidance when available. Saved ideas and your content plan stay in
            this browser. Back them up in workspace settings.
          </div>
          <a
            className="research-link"
            href="https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag//"
            target="_blank"
            rel="noreferrer"
          >
            Explore TikTok&apos;s trend discovery tool{" "}
            <ExternalLink size={13} />
          </a>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="idea-dialog trend-detail-dialog"
          overlayClassName="trend-detail-overlay"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (detailTrigger.current?.isConnected)
              detailTrigger.current.focus({ preventScroll: true });
            else
              document.getElementById("ideas")?.focus({ preventScroll: true });
          }}
        >
          {selected && (
            <>
              <div className="detail-cover">
                <TrendArtwork trend={selected} eager />
                <span className="detail-cover-label">
                  {selected.platform} · Stored trend
                </span>
              </div>
              <div className="detail-content">
                <header className="detail-heading">
                  <div className="detail-categories">
                    {categories
                      .filter(
                        (category) =>
                          category.id !== "all" &&
                          matchesCategory(selected, category.id),
                      )
                      .map((category) => (
                        <span key={category.id}>{category.label}</span>
                      ))}
                  </div>
                  <span className="detail-eyebrow">Predict</span>
                  <DialogTitle>{selected.title}</DialogTitle>
                  <DialogDescription>
                    By @{selected.creator.replace(/^@/, "")} ·{" "}
                    {selected.platform}
                  </DialogDescription>
                </header>
                <section className="views-panel" aria-label="Video views">
                  {!selectedAvailable && (
                    <p role="status">
                      This post is no longer available in the current results.
                      You can still copy your brief.
                    </p>
                  )}
                  {selectedAvailable && (
                    <>
                      <PredictionViews trend={selected} />
                      <p className="views-checked">
                        Last checked:{" "}
                        {new Date(selected.sourceVerifiedAt).toLocaleString()}
                      </p>
                    </>
                  )}
                  {selected.url && (
                    <a
                      className="detail-video-link"
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Watch original video <ExternalLink size={15} />
                    </a>
                  )}
                </section>
                <section className="detail-explanation">
                  <h3>Why this trend matters</h3>
                  <p>
                    {cleanTrendMatterReason(
                      selected.reason,
                      selected.categoryEvidence,
                    )}
                  </p>
                  <div className="growth-reasons">
                    <h4 className="growth-reasons-title">
                      <TrendingUp size={16} />
                      Why this video is projected to grow
                    </h4>
                    <ul className="growth-reasons-list">
                      {trendGrowthReasons(selected, trends).map(
                        (point, index) => (
                          <li key={index} className="growth-reason-item">
                            <span
                              className="growth-reason-bullet"
                              aria-hidden="true"
                            />
                            <div className="growth-reason-text">
                              <strong>{point.title}:</strong> {point.detail}
                            </div>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                </section>
                <section className="detail-plan">
                  <div className="detail-plan-heading">
                    <Sparkles size={19} />
                    <div>
                      <h3>Action: make this trend your own</h3>
                      <p>
                        {selected.decision ||
                          "Start with one simple post. Here’s how."}
                      </p>
                    </div>
                  </div>
                  <ol>
                    {starterIdea(selected, business).steps.map(
                      (step, index) => (
                        <li key={step}>
                          <span className="detail-step-number">
                            0{index + 1}
                          </span>
                          <div>
                            <h4>
                              {
                                [
                                  "Set up your idea",
                                  "Bring it to life",
                                  "Start a conversation",
                                ][index]
                              }
                            </h4>
                            <p>{step}</p>
                          </div>
                        </li>
                      ),
                    )}
                  </ol>
                </section>
                <details className="detail-caption">
                  <summary>
                    Write your first post <ChevronDown size={16} />
                  </summary>
                  <div className="detail-caption-fields">
                    <div className="brief-header">
                      <Sparkles size={16} />
                      <h3>Your starter brief</h3>
                      <span>Editable template</span>
                    </div>
                    <label className="brief-label">
                      Your business name
                      <input
                        value={business}
                        placeholder="e.g. Luna Café"
                        maxLength={80}
                        onChange={(event) => {
                          setBusiness(event.target.value);
                          setCopied(false);
                        }}
                      />
                    </label>
                    <label className="brief-label">
                      Start your post with…
                      <textarea
                        value={caption}
                        rows={3}
                        maxLength={10000}
                        onChange={(event) => {
                          editCaption(event.target.value);
                        }}
                      />
                    </label>
                    <button
                      className="text-button"
                      onClick={() =>
                        editCaption(starterIdea(selected, business).hook)
                      }
                    >
                      Use starter hook for {business.trim() || "my business"}{" "}
                      <Sparkles size={13} />
                    </button>
                  </div>
                </details>
                <div className="brief-actions">
                  <button
                    className="outline-button"
                    onClick={() => {
                      newDraft({
                        title: selected.title,
                        caption,
                        notes: starterIdea(selected, business)
                          .steps.map((step, i) => `${i + 1}. ${step}`)
                          .join("\n"),
                        sourceId: selected.id,
                        sourceUrl: selected.url || "",
                        platform: selected.platform,
                      });
                      setSelected(null);
                    }}
                  >
                    <CalendarDays size={15} /> Add to planner
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => toggleSave(selected)}
                  >
                    <Bookmark
                      size={15}
                      fill={
                        saved.includes(selected.id) ? "currentColor" : "none"
                      }
                    />
                    {saved.includes(selected.id) ? "Saved idea" : "Save idea"}
                  </button>
                  <button className="primary-button" onClick={copyBrief}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Brief copied" : "Copy post brief"}
                  </button>
                </div>
                <p className="brief-footnote">
                  {selected.aiStatus === "complete"
                    ? "AI suggestions · Review and adapt them for your business."
                    : "AI guidance unavailable · These steps are editable templates."}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
