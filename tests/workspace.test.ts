import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftsCsv,
  emptyWorkspace,
  mergeWorkspace,
  parseWorkspace,
  validPlanDate,
  type ContentDraft,
} from "../src/lib/workspace";
import { GET } from "../src/app/api/health/route";

const draft: ContentDraft = {
  id: "draft-1",
  title: "Cafe story",
  caption: "Behind the counter",
  notes: "Film the morning prep",
  platform: "Instagram",
  status: "planned",
  scheduledFor: "2026-10-20",
  sourceId: "",
  sourceUrl: "https://www.instagram.com/p/example/",
  updatedAt: "2026-10-13T00:00:00Z",
};
test("workspace backup round-trips captions, saved references and plans without retaining unknown fields", () => {
  const data = {
    ...emptyWorkspace,
    business: "Luna Café",
    drafts: [draft],
    bookmarks: [
      {
        id: "TikTok:123",
        title: "My reference",
        creator: "chef",
        platform: "TikTok",
        url: "https://www.tiktok.com/@chef",
        savedAt: draft.updatedAt,
      },
    ],
    briefs: [{ id: "TikTok:123", caption: "Custom hook\nSecond line" }],
  };
  assert.deepEqual(
    parseWorkspace(
      JSON.parse(JSON.stringify({ ...data, untrusted: "discard" })),
    ),
    data,
  );
});
test("invalid backups cannot inject links, invalid dates or malformed collections", () => {
  for (const patch of [
    { sourceUrl: "javascript:alert(1)" },
    { scheduledFor: "2026-02-30" },
    { scheduledFor: "" },
    { status: "unknown" },
    { title: "  " },
    { updatedAt: "invalid" },
  ]) {
    assert.throws(() =>
      parseWorkspace({ ...emptyWorkspace, drafts: [{ ...draft, ...patch }] }),
    );
  }
  assert.throws(() => parseWorkspace({ ...emptyWorkspace, version: 2 }));
  assert.throws(() => parseWorkspace({ ...emptyWorkspace, bookmarks: null }));
  assert.throws(() =>
    parseWorkspace({
      ...emptyWorkspace,
      briefs: Array(1001).fill({ id: "x", caption: "y" }),
    }),
  );
  assert.equal(validPlanDate("2028-02-29"), true);
  assert.equal(validPlanDate("2026-02-29"), false);
});
test("backup imports preserve existing items and take the newest version of a draft", () => {
  const current = {
    ...emptyWorkspace,
    business: "Keep me",
    drafts: [draft, { ...draft, id: "draft-2" }],
  };
  const incoming = {
    ...emptyWorkspace,
    business: "Other",
    drafts: [{ ...draft, caption: "Newer", updatedAt: "2026-10-14T00:00:00Z" }],
  };
  const merged = mergeWorkspace(current, incoming);
  assert.equal(merged.business, "Keep me");
  assert.equal(merged.drafts.length, 2);
  assert.equal(
    merged.drafts.find((item) => item.id === draft.id)?.caption,
    "Newer",
  );
  assert.equal(mergeWorkspace(merged, current).drafts[0].caption, "Newer");
});
test("CSV preserves quotes, commas and newlines and neutralizes spreadsheet formulas", () => {
  const csv = draftsCsv([
    {
      ...draft,
      title: '=HYPERLINK("x")',
      caption: 'Hello, "friend"\nNext line',
      notes: "  +SUM(1,1)",
    },
  ]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"Hello, ""friend""\nNext line"/);
  assert.match(csv, /"'  \+SUM\(1,1\)"/);
});
test("health reports configuration without leaking credentials and disables HTTP caching", async () => {
  const env = { ...process.env };
  try {
    process.env.APIFY_API_TOKEN = "private-token";
    process.env.GRAFILAB_API_KEY = "private-key";
    process.env.VERCEL = "1";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const response = await GET();
    const data = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(data.services, {
      discovery: true,
      analysis: true,
      storage: false,
      cloud: true,
      ready: false,
    });
    assert.doesNotMatch(JSON.stringify(data), /private-token|private-key/);
  } finally {
    process.env = env;
  }
});
