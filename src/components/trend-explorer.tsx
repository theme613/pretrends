"use client";

import { useEffect, useRef, useState } from "react";
import { SOURCE_MAX_AGE_MS } from "@/lib/post-policy";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  Flame,
  Radar,
  RefreshCw,
  Search,
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
import "./trend-explorer.css";

class IdeaUpdateError extends Error {
  // A conflict means another scan owns the collection; nothing needs recovering.
  constructor(message: string, readonly conflict = false) { super(message); }
}
const updateFailed = "Could not update ideas. Your saved ideas are still here. Please try again.";
const updateTimedOut = "This search took too long. Your saved ideas are still here. Please try again.";
async function readScanResponse(response: Response) {
  const result = await response.json().catch(() => null);
  if (response.status === 504) throw new IdeaUpdateError(updateTimedOut);
  if (result?.code === "MISSING_CONFIGURATION") {
    throw new IdeaUpdateError("Fresh ideas are not set up on this website yet. Your saved ideas are still available.");
  }
  if (response.status === 409 && typeof result?.error === "string") throw new IdeaUpdateError(result.error, true);
  if (!response.ok || !result || result.status === "failed") throw new IdeaUpdateError(updateFailed);
  return result;
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
  if (previewRequests >= 3) await new Promise<void>((resolve) => eager ? previewWaiters.unshift(resolve) : previewWaiters.push(resolve));
  else previewRequests++;
  return () => { const next = previewWaiters.shift(); if (next) next(); else previewRequests--; };
}
function TrendArtwork({ trend, eager = false, onOpen }: {
  trend: Trend; eager?: boolean; onOpen?: (button: HTMLButtonElement) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  const source = trend.previewUrl || trend.image;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "", started = false;
    async function load() {
      if (started) return;
      started = true;
      setImage(""); setFailed(false);
      if (!source) { setFailed(true); return; }
      const cached = previewBlobs.get(source);
      if (cached) { objectUrl = URL.createObjectURL(cached); setImage(objectUrl); return; }
      const release = await previewSlot(eager);
      try {
        if (controller.signal.aborted) return;
        const response = await fetch(source, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("Invalid preview");
        if (!controller.signal.aborted) {
          if (previewBlobs.size >= 100) previewBlobs.delete(previewBlobs.keys().next().value!);
          previewBlobs.set(source, blob);
          objectUrl = URL.createObjectURL(blob); setImage(objectUrl);
        }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { release(); }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: "200px" });
    if (eager) void load(); else if (container.current) observer.observe(container.current);
    return () => { controller.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, attempt, eager]);
  const artwork = image && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt={trend.title} onError={() => { if (source) previewBlobs.delete(source); setFailed(true); }} />
  ) : <span className="preview-loading">{failed ? "Preview could not load" : "Loading preview…"}</span>;
  return <div ref={container} className="trend-art" aria-busy={!image && !failed}>
    {onOpen ? <button className="preview-open" aria-label={`Open details for ${trend.title}`} aria-haspopup="dialog" onClick={(event) => onOpen(event.currentTarget)}>{artwork}</button> : artwork}
    {failed && <div className="preview-recovery">
      <button onClick={() => setAttempt((value) => value + 1)}>Retry preview</button>
      {trend.url && <a href={trend.url} target="_blank" rel="noreferrer">Watch original</a>}
    </div>}
  </div>;
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
  const [saved, setSaved] = useState<string[]>([]);
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
  const [business, setBusiness] = useState("");
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [refreshBatch, setRefreshBatch] = useState<RefreshBatch | null>(null);
  const [message, setMessage] = useState("");
  const activeFilters = useRef({ categories: selectedCategories, platform, query });
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
  const selectedAvailable = selected !== null && trends.some((post) => post.id === selected.id);
  function toggleSave(trend: Trend) {
    const wasSaved = saved.includes(trend.id);
    setSaved((previous) =>
      wasSaved
        ? previous.filter((id) => id !== trend.id)
        : [...previous, trend.id],
    );
    setMessage(
      wasSaved
        ? `Removed ${trend.title} from saved ideas.`
        : `Saved ${trend.title} for this session.`,
    );
  }
  function openIdea(trend: Trend, trigger: HTMLButtonElement) {
    detailTrigger.current = trigger;
    setSelected(trend);
    setCaption(starterIdea(trend, business).hook);
    setCopied(false);
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
  function applyCollection(data: unknown, keepCurrent = false) {
    // Successful responses contain the full saved collection, including removals.
    const incoming = [...new Map(normalizeTrends(data).map((post) => [post.id, post])).values()];
    setTrends((current) => keepCurrent ? [...new Map([...current, ...incoming].map((post) => [post.id, post])).values()] : incoming);
    setSelected((current) => current ? incoming.find((post) => post.id === current.id) || current : null);
  }
  async function runLiveScan() {
    if (pollController.current) return;
    const controller = new AbortController();
    pollController.current = controller;
    const requestedFilters = { categories: [...selectedCategories], platform };
    setScanning(true);
    setMessage("Finding fresh ideas…");
    const delayed = "Still finding ideas. You can keep browsing.";
    const slowTimer = setTimeout(() => setMessage(delayed), 40000);
    // Visibility changes wake the existing poll; they do not start another scan.
    const waitForPoll = () => new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); document.removeEventListener("visibilitychange", wake); controller.signal.removeEventListener("abort", abort); };
      const wake = () => { if (document.visibilityState === "visible") { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, document.visibilityState === "hidden" ? 10000 : 2000);
      document.addEventListener("visibilitychange", wake);
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const started = Date.now();
    const requestSignal = (timeout = 20000) => AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    try {
      const response = await fetch("/api/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selectedCategories, platform, mode: "refresh" }),
        cache: "no-store", signal: requestSignal(310000),
      });
      let result = await readScanResponse(response);
      if (response.status === 202) {
        const id = result.id;
        let revision = -1;
        while (true) {
          if (Date.now() - started > 15 * 60000) throw new IdeaUpdateError(updateTimedOut);
          const progressResponse = await fetch(`/api/scan?id=${encodeURIComponent(id)}&since=${revision}`, { cache: "no-store", signal: requestSignal() });
          const progress = await readScanResponse(progressResponse);
          if (progress.data) applyCollection(progress.data.candidates);
          revision = progress.revision ?? revision;
          if (progress.status === "complete") { result = progress.result; break; }
          setMessage(Date.now() - started >= 40000 ? delayed : "Finding fresh ideas…");
          await waitForPoll();
        }
      }
      if (!Array.isArray(result?.data?.candidates)) throw new IdeaUpdateError(updateFailed);
      applyCollection(result.data.candidates);
      const filters = activeFilters.current;
      const hasMatches = normalizeTrends(result.data.candidates).some((post) =>
        matchesCategories(post, filters.categories) &&
        (filters.platform === "all" || post.platform === filters.platform) &&
        `${post.title} ${post.reason} ${post.creator}`.toLowerCase().includes(filters.query.toLowerCase().trim()),
      );
      if (result.batch && sameBatchFilters(requestedFilters, filters)) {
        setRefreshBatch(result.batch);
        setVisibleCount((count) => Math.max(count, 12));
        const batch: RefreshBatch = result.batch;
        setMessage(`${batch.ids.length} ideas ready · ${batch.fresh_count} fresh, ${batch.reused_count} saved.${batch.ids.length < 12 ? " Fewer than 12 verified matches are available." : ""}`);
      } else {
        setMessage(hasMatches ? "Ideas updated. Your current filters are applied." : "No matching ideas found. Try another topic.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof IdeaUpdateError && error.conflict) {
        setMessage(error.message);
        return;
      }
      try {
        const latest = await fetch("/api/trends", { cache: "no-store", signal: requestSignal() });
        if (latest.ok) {
          const collection = await latest.json();
          if (Array.isArray(collection)) applyCollection(collection, true);
        }

      } catch { /* Keep the current verified ideas available if the read fails. */ }
      if (!controller.signal.aborted) setMessage(error instanceof IdeaUpdateError ? error.message : error instanceof Error && error.name === "TimeoutError" ? updateTimedOut : updateFailed);
    } finally {
      clearTimeout(slowTimer);
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
      <a className="skip-link" href="#ideas">
        Skip to ideas
      </a>
      <header className="site-header page-width">
        <button
          className="brand"
          onClick={resetFilters}
          aria-label="Pretrends home"
        >
          <span className="brand-symbol">
            <Radar size={23} strokeWidth={1.7} />
          </span>
          pretrends<span className="brand-period">.</span>
        </button>
      </header>

      <main className="page-width">
        <section
          id="ideas" tabIndex={-1}
          className="ideas-section"
          aria-labelledby="ideas-heading"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow section-eyebrow">
                A FRESH PLACE TO START
              </div>
              <h1 id="ideas-heading">Small sparks. Big possibilities.</h1>
              <p>
                Pick a trend. See the signal. Give it your own business twist.
              </p>
            </div>
            <div className="collection-actions">
              <button
                className="collection-button collection-button-primary"
                onClick={() => runLiveScan()}
                disabled={scanning}
              >
                <RefreshCw size={14} className={scanning ? "spinning" : ""} />
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
                <button aria-label="Clear search" onClick={() => setQuery("")}>
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
                  ...Array.from(
                    new Set(trends.map((trend) => trend.platform)),
                  ).map((name) => ({ value: name, label: name })),
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
                ]}
                onChange={setSort}
              />
            </div>
          </div>
          <div className="collection-caption">
            <span>
              {filtered.length} {filtered.length === 1 ? "idea" : "ideas"} to
              explore
            </span>
            <span>Real posts · AI suggestions</span>
          </div>
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
          <div className="trend-grid">
            {visible.map((trend) => {
              const savedIdea = saved.includes(trend.id);
              const percent = growth(trend);
              return (
                <article className="trend-card" key={trend.id}>
                  <div className="card-image">
                    <TrendArtwork trend={trend} onOpen={(button) => openIdea(trend, button)} />
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
                      <span className={`growth-value ${percent !== null && percent < 0 ? "growth-negative" : ""}`}>
                        <ArrowUpRight size={14} />
                        {percent === null ? "First observation" : `${percent > 0 ? "+" : ""}${percent.toLocaleString()}% measured growth`}
                      </span>
                      <span>{refreshBatch && batchIds.has(trend.id) ? "Refresh batch" : "Stored"}</span>
                    </div>
                    <button className="card-action" aria-haspopup="dialog" onClick={(event) => openIdea(trend, event.currentTarget)}>
                      View trend <ArrowUpRight size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {visible.length === 0 && (
            <div className="empty-state">
              <Bookmark size={30} strokeWidth={1.2} />
              <h3>No matching ideas found.</h3>
              <p>Try another topic.</p>
              <button
                className="primary-button"
                onClick={() => {
                  resetFilters();
                }}
              >
                Explore all ideas <ArrowRight size={16} />
              </button>
            </div>
          )}
          {visible.length < filtered.length && (
            <div className="load-more">
              <button
                className="outline-button"
                onClick={() => setVisibleCount((previous) => previous + 12)}
              >
                Show next {Math.min(12, filtered.length - visible.length)} ideas{" "}
                <ChevronDown size={15} />
              </button>
              <span>
                Showing {visible.length} of {filtered.length} ideas
              </span>
            </div>
          )}
        </section>
        <section className="closing-note">
          <span className="closing-spark">✳</span>
          <div>
            <span className="eyebrow">YOUR BUSINESS. YOUR POINT OF VIEW.</span>
            <h2>
              You don’t need to follow every trend.
              <br />
              <i>Just find the one that feels like you.</i>
            </h2>
          </div>
          <button className="closing-link" onClick={() => setHowOpen(true)}>
            A little help getting started <ArrowUpRight size={18} />
          </button>
        </section>
      </main>
      <footer className="page-width site-footer">
        <span className="footer-brand">pretrends.</span>
        <span>A little ahead of the curve.</span>
        <span>
          Built for the next good idea <Sparkles size={13} />
        </span>
      </footer>

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
            guidance when available. Saved ideas stay for this session.
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
            if (detailTrigger.current?.isConnected) detailTrigger.current.focus({ preventScroll: true });
            else document.getElementById("ideas")?.focus({ preventScroll: true });
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
                  {!selectedAvailable && <p role="status">This post is no longer available in the current results. You can still copy your brief.</p>}
                  {selectedAvailable && <>
                  <PredictionViews trend={selected} />
                  <p className="views-checked">
                    Last checked: {new Date(selected.sourceVerifiedAt).toLocaleString()}
                  </p>
                  </>}
                  {selected.url && (
                    <a className="detail-video-link" href={selected.url} target="_blank" rel="noreferrer">
                      Watch original video <ExternalLink size={15} />
                    </a>
                  )}
                </section>
                <section className="detail-explanation">
                  <h3>Why this trend matters</h3>
                  <p>{cleanTrendMatterReason(selected.reason, selected.categoryEvidence)}</p>
                  <div className="growth-reasons">
                    <h4 className="growth-reasons-title">
                      <TrendingUp size={16} />
                      Why this video is projected to grow
                    </h4>
                    <ul className="growth-reasons-list">
                      {trendGrowthReasons(selected, trends).map((point, index) => (
                        <li key={index} className="growth-reason-item">
                          <span className="growth-reason-bullet" aria-hidden="true" />
                          <div className="growth-reason-text">
                            <strong>{point.title}:</strong> {point.detail}
                          </div>
                        </li>
                      ))}
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
                          setCaption(
                            starterIdea(selected, event.target.value).hook,
                          );
                          setCopied(false);
                        }}
                      />
                    </label>
                    <label className="brief-label">
                      Start your post with…
                      <textarea
                        value={caption}
                        rows={3}
                        onChange={(event) => {
                          setCaption(event.target.value);
                          setCopied(false);
                        }}
                      />
                    </label>
                  </div>
                </details>
                <div className="brief-actions">
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
