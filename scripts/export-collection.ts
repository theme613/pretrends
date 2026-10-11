import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { latestTrends } from "../src/lib/scan-store";

// Export existing verified observations only. This never starts a paid scan or
// changes verification dates; expired and unavailable posts stay excluded.
async function main() {
  const candidates = await latestTrends();
  if (!candidates.length) throw new Error("No verified ideas to export. The existing deployment collection was kept.");
  const filename = path.join(process.cwd(), "data/scans/collection-index.json");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filename), { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, candidates }));
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
  console.log(`Prepared ${candidates.length} verified ideas for deployment in data/scans/collection-index.json.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
