"use client";

import { useState } from "react";
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
  MoveUpRight,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
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
  topic,
  type Trend,
} from "@/lib/trends";
import "./trend-explorer.css";
const featuredIds = ["t16", "t7", "t26", "t24", "t10", "t29"];
function TrendArtwork({ trend }: { trend: Trend }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const category = topic(trend).id;
  if (trend.image && failedImage !== trend.image)
    return (
      <div className="trend-art">
        {/* Remote post thumbnails come from the scraper; fall back to category artwork if they expire. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trend.image}
          alt={trend.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(trend.image)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  if (category === "fashion")
    return (
      <div className="trend-art art-fashion" aria-hidden="true">
        <div className="art-grid" />
        <span className="art-sticker">OLD SCHOOL. NEW ENERGY.</span>
        <span className="fashion-lettering">
          {trend.id === "t16" ? (
            <>
              Back to
              <br />
              <i>2000.</i>
            </>
          ) : (
            <>
              Wear it.
              <br />
              <i>Again.</i>
            </>
          )}
        </span>
        <svg className="fashion-star" viewBox="0 0 100 100">
          <path
            d="M50 0 60 35 94 14 72 45 100 50 72 58 94 88 60 67 50 100 40 67 6 88 28 58 0 50 28 45 6 14 40 35Z"
            fill="currentColor"
          />
        </svg>
        <div className="art-bottom">
          <span>A LITTLE NOSTALGIA</span>
          <span>↗</span>
        </div>
      </div>
    );
  if (category === "food")
    return (
      <div className="trend-art art-food" aria-hidden="true">
        <span className="food-lettering">
          a little
          <br />
          <i>extra heat.</i>
        </span>
        <svg className="ramen-art" viewBox="0 0 300 220">
          <ellipse
            cx="150"
            cy="187"
            rx="96"
            ry="14"
            fill="#bb6949"
            opacity=".16"
          />
          <path d="M45 92Q53 177 150 181Q246 177 255 92Z" fill="#bc4534" />
          <path
            d="M58 118Q150 153 243 118M74 146Q150 171 226 146"
            fill="none"
            stroke="#f6cda5"
            strokeWidth="4"
          />
          <ellipse cx="150" cy="92" rx="105" ry="36" fill="#fff2d3" />
          <ellipse cx="150" cy="92" rx="93" ry="27" fill="#d67c40" />
          <path
            d="M73 94q30-36 58-4t60-1t37 6M74 83q30-23 58 1t63 1M87 104q25-27 54-2t58-7"
            fill="none"
            stroke="#f4d281"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <ellipse
            cx="174"
            cy="86"
            rx="23"
            ry="15"
            fill="#ffedcb"
            transform="rotate(-18 174 86)"
          />
          <ellipse cx="174" cy="86" rx="10" ry="9" fill="#f5ad32" />
          <path
            d="m110 85 11-8m-15 24 13-3m83-10 12 3m-66-19 4-9"
            stroke="#548249"
            strokeWidth="5"
          />
          <path
            d="m173 82 73-65m-62 66 74-63"
            stroke="#673e2b"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M106 48q-13-12 0-23m28 14q-13-12 0-23"
            fill="none"
            stroke="#fff4df"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className="art-bottom">
          <span>GOOD FOOD. GOOD CONTENT.</span>
          <span>↗</span>
        </div>
      </div>
    );
  if (category === "tech")
    return (
      <div className="trend-art art-tech" aria-hidden="true">
        <div className="tech-grid" />
        <span className="art-sticker tech-sticker">
          SMALL TOOLS. BIG POSSIBILITIES.
        </span>
        <span className="tech-lettering">
          Less busy.
          <br />
          <i>More clever.</i>
        </span>
        <div className="pixel-arrow">
          <MoveUpRight strokeWidth={1.1} />
        </div>
        <span className="code-tag">&gt; make_room_for_ideas</span>
        <div className="art-bottom">
          <span>YOUR NEXT SMART MOVE</span>
          <span>↗</span>
        </div>
      </div>
    );
  return (
    <div className={`trend-art art-other art-${category}`} aria-hidden="true">
      <div className="other-orbit orbit-one" />
      <div className="other-orbit orbit-two" />
      <span className="art-sticker">A FRESH POINT OF VIEW</span>
      <span className="other-lettering">
        {category === "music" || category === "dance" ? (
          <>
            Find your
            <br />
            <i>rhythm.</i>
          </>
        ) : category === "game" ? (
          <>
            Next
            <br />
            <i>level.</i>
          </>
        ) : (
          <>
            Something
            <br />
            <i>different.</i>
          </>
        )}
      </span>
      <Sparkles className="other-spark" strokeWidth={1} />
      <div className="art-bottom">
        <span>{topic(trend).label.toUpperCase()}</span>
        <span>↗</span>
      </div>
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
  const [sort, setSort] = useState("curated");
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Trend | null>(null);
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
      if (sort === "score") return b.score - a.score;
      const aRank = featuredIds.indexOf(a.id),
        bRank = featuredIds.indexOf(b.id);
      return (
        (aRank === -1 ? 100 : aRank) - (bRank === -1 ? 100 : bRank) ||
        b.score - a.score
      );
    });
  const visible = filtered.slice(0, visibleCount);
  const hasDemo = trends.some((trend) => trend.demo);
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
  function openIdea(trend: Trend) {
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
        `Found ${result.scraped_count} posts. ${(result.warnings || []).join(" ")}`,
      );
    } catch (error) {
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
        `${business.trim() || "My business"} — ${selected.title}\n\nPost idea\n${caption}\n\nShot list\n${idea.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}\n\nStarter template inspired by ${selected.demo ? "a sample trend" : "a stored trend"}.`,
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
            <button
              className="refresh-button"
              onClick={refresh}
              disabled={refreshing || scanning}
            >
              <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
              {refreshing ? "Refreshing…" : "Refresh ideas"}
            </button>
            <button
              className="refresh-button"
              onClick={runLiveScan}
              disabled={scanning || refreshing}
              style={{
                marginLeft: "8px",
                background: "#77628e",
                color: "white",
                borderColor: "#77628e",
              }}
            >
              <RefreshCw size={14} className={scanning ? "spinning" : ""} />
              {scanning ? "Scanning…" : "Find fresh trends"}
            </button>
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
              <label className="select-control">
                <select
                  aria-label="Filter by platform"
                  value={platform}
                  onChange={(event) => {
                    setPlatform(event.target.value);
                    setVisibleCount(24);
                  }}
                >
                  <option value="all">All platforms</option>
                  {Array.from(
                    new Set(trends.map((trend) => trend.platform)),
                  ).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <label className="select-control">
                <select
                  aria-label="Sort ideas"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="curated">Editor&apos;s picks</option>
                  <option value="growth">View growth</option>
                  <option value="score">Signal score</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </div>
          <div className="collection-caption">
            <span>
              {filtered.length} {filtered.length === 1 ? "idea" : "ideas"} to
              explore
            </span>
            <span>
              {hasDemo
                ? "Demo data · Not live predictions"
                : "Real posts · AI suggestions"}
            </span>
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
                    <button
                      className="art-button"
                      aria-label={`Explore ${trend.title}`}
                      onClick={() => openIdea(trend)}
                    >
                      <TrendArtwork trend={trend} />
                    </button>
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
                      <span className="signal-badge">
                        <Flame size={12} />
                        {!trend.hasBaseline
                          ? "First observation"
                          : trend.score >= 80
                            ? "Strong signal"
                            : trend.score >= 50
                              ? "Picking up"
                              : "Worth a look"}
                      </span>
                    </div>
                    <h3>
                      <button onClick={() => openIdea(trend)}>
                        {trend.title}
                      </button>
                    </h3>
                    <div className="card-description mt-2 text-sm flex flex-col gap-1.5 p-3 bg-slate-50 border border-slate-100 rounded-md">
                      <p>
                        <span className="font-semibold text-slate-800">
                          Predict:
                        </span>{" "}
                        {trend.title}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-800">
                          Why (Y):
                        </span>{" "}
                        {trend.reason}
                      </p>
                      <p className="text-blue-700">
                        <span className="font-semibold">Action (Z):</span>{" "}
                        {trend.decision}
                      </p>
                      {trend.url && (
                        <a
                          href={trend.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 underline font-medium mt-1 inline-flex items-center gap-1 w-max"
                        >
                          ▶ Watch Original Video
                        </a>
                      )}
                    </div>
                    <div className="card-metrics">
                      <span
                        className={`growth-value ${percent !== null && percent < 0 ? "growth-negative" : ""}`}
                      >
                        <ArrowUpRight size={14} />
                        {percent === null
                          ? "Baseline saved"
                          : `${percent > 0 ? "+" : ""}${percent.toLocaleString()}%`}{" "}
                        <span>{percent === null ? "yet" : "views"}</span>
                      </span>
                      <span>
                        {formatCount(trend.after ?? trend.before)} views{" "}
                        <span className="metric-dot">·</span>{" "}
                        {trend.demo ? "Sample" : "Stored"}
                      </span>
                    </div>
                    <button
                      className="card-action"
                      onClick={() => openIdea(trend)}
                    >
                      View trend <ArrowUpRight size={17} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="empty-state">
              <Bookmark size={30} strokeWidth={1.2} />
              <h3>No videos match these categories yet.</h3>
              <p>
                Try fewer categories, a different platform, or another search.
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
            guidance when available; sample ideas are labelled. Saved ideas stay
            for this session.
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
        <DialogContent className="idea-dialog trend-detail-dialog">
          {selected && (
            <>
              <div className="detail-cover">
                <TrendArtwork trend={selected} />
                <span className="detail-cover-label">
                  {selected.platform} ·{" "}
                  {selected.demo ? "Sample trend" : "Stored trend"}
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
                  <DialogTitle>{selected.title}</DialogTitle>
                  <DialogDescription>
                    By @{selected.creator.replace(/^@/, "")} ·{" "}
                    {selected.platform}
                  </DialogDescription>
                </header>
                <div className="evidence-panel">
                  <div className="evidence-title">
                    <Radar size={16} />
                    <strong>Behind the signal</strong>
                    <span>{selected.score}/100 · AI estimate</span>
                  </div>
                  <div className="view-comparison">
                    <div>
                      <span>Earlier views</span>
                      <strong>{formatCount(selected.before)}</strong>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <span>Later views</span>
                      <strong
                        className={
                          selected.after === null ? "waiting-views" : undefined
                        }
                      >
                        {selected.after === null
                          ? "Waiting for next fetch"
                          : formatCount(selected.after)}
                      </strong>
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
                      : selected.demo
                        ? "Sample view counts · Collection interval unavailable"
                        : "Starting views saved. Fetch this post again to compare the new views with this count."}
                  </span>
                  {selected.url && (
                    <a
                      className="research-link"
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View original source <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <section className="detail-explanation">
                  <h3>Why it’s getting attention</h3>
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
                      <h3>Make this trend your own</h3>
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
                  {selected.demo
                    ? "Sample guidance · Editable ideas, not a live AI prediction."
                    : selected.aiStatus === "complete"
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
