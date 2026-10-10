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
  formatCount,
  growth,
  matchesCategories,
  matchesCategory,
  normalizeTrends,
  starterIdea,
  type Trend,
} from "@/lib/trends";
import { forecastMessage } from "@/lib/forecast";
import "./trend-explorer.css";
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
function TrendArtwork({
  trend,
  eager = false,
}: {
  trend: Trend;
  eager?: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  if (trend.image && failedImage !== trend.image)
    return (
      <div className="trend-art" aria-busy={loadedImage !== trend.image}>
        {loadedImage !== trend.image && (
          <span className="preview-loading">Loading preview…</span>
        )}
        {/* Remote post thumbnails come from the scraper; fall back to category artwork if they expire. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trend.image}
          alt={trend.title}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedImage(trend.image)}
          onError={() => setFailedImage(trend.image)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loadedImage === trend.image ? 1 : 0,
          }}
        />
      </div>
    );
  return (
    <div className="trend-art art-unavailable">
      <span>Preview unavailable</span>
      <small>Open details to watch the original video.</small>
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
        setSelected((current) =>
          current &&
          Date.parse(current.sourceVerifiedAt) + SOURCE_MAX_AGE_MS <= Date.now()
            ? null
            : current,
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
  const [visibleCount, setVisibleCount] = useState(24);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
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
  const visible = filtered.slice(0, visibleCount);
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
    setSelectedCategories([]);
    setQuery("");
    setPlatform("all");
    setVisibleCount(24);
  }
  function toggleCategory(id: string) {
    setVisibleCount(24);
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
  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/trends", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load trends");
      setTrends(normalizeTrends(await response.json()));
      setMessage(
        "Ideas refreshed from the latest stored data. This does not run a live scan.",
      );
    } catch {
      setMessage(
        "Could not refresh ideas. Your current ideas are still available. Please try again.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  const [scanning, setScanning] = useState(false);
  async function runLiveScan() {
    setScanning(true);
    setMessage(
      "Collecting posts across several topics and preparing your ideas. This can take several minutes…",
    );
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selectedCategories, platform }),
        cache: "no-store",
      });
      let result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Scan failed. Please try again.");
      if (response.status === 202) {
        const id = result.id;
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const progressResponse = await fetch(
            `/api/scan?id=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const progress = await progressResponse.json();
          if (!progressResponse.ok || progress.status === "failed")
            throw new Error(progress.error || "Scan failed. Please try again.");
          if (progress.status === "complete") {
            result = progress.result;
            break;
          }
          setMessage(
            progress.total
              ? `${progress.stage}: ${progress.processed} of ${progress.total} posts…`
              : progress.stage,
          );
        }
      }
      setTrends(normalizeTrends(result.data.candidates));
      setVisibleCount(24);
      setMessage(
        `Collected ${result.scraped_count} real posts; ${result.verified_count ?? 0} passed visual checks. ${(result.warnings || []).join(" ")}`,
      );
    } catch (error) {
      try {
        const latest = await fetch("/api/trends", { cache: "no-store" });
        if (latest.ok) setTrends(normalizeTrends(await latest.json()));
        else setTrends([]);
      } catch {
        setTrends([]);
      }

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Please try again.",
      );
    } finally {
      setScanning(false);
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
          aria-label="TrendRadar home"
        >
          <span className="brand-symbol">
            <Radar size={23} strokeWidth={1.7} />
          </span>
          trendradar<span className="brand-period">.</span>
        </button>
      </header>

      <main className="page-width">
        <section
          id="ideas"
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
                className="collection-button"
                onClick={refresh}
                disabled={refreshing || scanning}
              >
                <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
                {refreshing ? "Refreshing…" : "Refresh ideas"}
              </button>
              <button
                className="collection-button collection-button-primary"
                onClick={runLiveScan}
                disabled={scanning || refreshing}
              >
                <RefreshCw size={14} className={scanning ? "spinning" : ""} />
                {scanning ? "Scanning…" : "Find fresh trends"}
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
                  setVisibleCount(24);
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
                  setPlatform(value);
                  setVisibleCount(24);
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
                    <TrendArtwork trend={trend} />
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
                    <div className="card-metrics">
                      <span
                        className={`growth-value ${percent !== null && percent < 0 ? "growth-negative" : ""}`}
                      >
                        <ArrowUpRight size={14} />
                        {percent === null
                          ? "Baseline saved"
                          : `${percent > 0 ? "+" : ""}${percent.toLocaleString()}%`}{" "}
                        {percent !== null && <span>views</span>}
                      </span>
                      <span>
                        {formatCount(trend.after ?? trend.before)} views{" "}
                        <span className="metric-dot">·</span> Stored
                      </span>
                    </div>
                    <span className="card-action" aria-hidden="true">
                      View trend <ArrowUpRight size={17} />
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="empty-state">
              <Bookmark size={30} strokeWidth={1.2} />
              <h3>No verified videos match yet.</h3>
              <p>
                Run a scan to verify real videos, or try fewer categories.
                Unconfirmed and expired posts stay hidden.
              </p>
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
                onClick={() => setVisibleCount((previous) => previous + 24)}
              >
                Show next {Math.min(24, filtered.length - visible.length)} ideas{" "}
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
        <span className="footer-brand">trendradar.</span>
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
            detailTrigger.current?.focus({ preventScroll: true });
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
                <div
                  className={`evidence-panel evidence-panel--${selected.score >= 80 ? "strong" : selected.score >= 50 ? "medium" : "weak"}`}
                >
                  <div className="evidence-title">
                    <Radar size={16} />
                    <strong>Behind the signal</strong>
                    <span>{selected.score}/100 · AI estimate</span>
                  </div>
                  <div className="view-comparison">
                    <div>
                      <span>
                        {selected.hasBaseline
                          ? "Earlier views"
                          : "Starting views"}
                      </span>
                      <strong>{formatCount(selected.before)}</strong>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <span>Current views</span>
                      <strong>{formatCount(selected.currentViews)}</strong>
                    </div>
                    <span className="growth-pill">
                      {growth(selected) === null
                        ? selected.hasBaseline
                          ? "No growth rate"
                          : "Baseline saved"
                        : `${(growth(selected) ?? 0) > 0 ? "+" : ""}${growth(selected)}%`}
                    </span>
                  </div>

                  <span className="evidence-source">
                    {selected.baselineAt && selected.collectedAt
                      ? `${new Date(selected.baselineAt).toLocaleString()} → ${new Date(selected.collectedAt).toLocaleString()}`
                      : "Starting views saved. Fetch again later to measure growth."}
                  </span>
                  <span className="evidence-source">
                    Last verified:{" "}
                    {new Date(selected.sourceVerifiedAt).toLocaleString()}
                  </span>
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
                </div>
                <section
                  className="prediction-panel"
                  aria-label="View forecast"
                >
                  <div className="prediction-title">
                    <TrendingUp size={16} />
                    <strong>Estimated total views in 3 days</strong>
                    {selected.predictedViews !== null && (
                      <span className="prediction-estimate">
                        {formatCount(selected.predictedViews)} views
                      </span>
                    )}
                  </div>
                  <p className="forecast-note">
                    {forecastMessage(selected.forecast.status)}
                  </p>
                  {selected.forecast.status === "ready" && (
                    <p className="forecast-note">
                      Based on {formatCount(selected.forecast.views_per_hour)}{" "}
                      views gained per hour between your last two fetches.
                      Target:{" "}
                      {new Date(selected.forecast.target_at!).toLocaleString()}.
                    </p>
                  )}
                </section>
                <section className="detail-explanation">
                  <h3>Why this trend matters</h3>
                  <p>
                    {selected.reason}{" "}
                    {selected.after !== null &&
                    selected.before !== null &&
                    selected.after > selected.before
                      ? `Views increased from ${formatCount(selected.before)} to ${formatCount(selected.after)} in the available records. This suggests growing interest, but it is too early to know how long it will last.`
                      : !selected.hasBaseline
                        ? "The starting view count is saved. Growth will be measured after the next fetch."
                        : "Check whether this idea fits your customers."}
                  </p>
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
