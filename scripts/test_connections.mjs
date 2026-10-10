import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
let failed = false;
for (const [name, url, key] of [
  ["Apify", "https://api.apify.com/v2/users/me", process.env.APIFY_API_TOKEN],
  [
    "Grafilab",
    "https://llm.grafilab.ai/v1/models",
    process.env.GRAFILAB_API_KEY,
  ],
]) {
  if (!key) {
    console.error(`${name}: key missing`);
    failed = true;
    continue;
  }
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    console.log(
      `${name}: ${response.ok ? "connected" : `HTTP ${response.status}`}`,
    );
    if (!response.ok) failed = true;
  } catch {
    console.error(`${name}: connection failed`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
