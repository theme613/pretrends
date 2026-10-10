/**
 * Quick connection test for Apify + Grafilab
 * Run: node scripts/test_connections.mjs
 */
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

// Manually load .env since this is a plain Node script
try {
  const env = readFileSync('.env', 'utf8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.trim().split('=');
    if (key && val.length) process.env[key] = val.join('=');
  });
} catch {
  console.error('❌  No .env file found! Create one first.\n');
  process.exit(1);
}

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const GRAFILAB_KEY = process.env.GRAFILAB_API_KEY;

console.log('\n========================================');
console.log('  TrendRadar — Connection Test');
console.log('========================================\n');

// ── 1. Check keys are present ─────────────────────────
console.log('1️⃣  Checking .env keys...');
if (!APIFY_TOKEN || APIFY_TOKEN === 'your_apify_token_here') {
  console.error('   ❌  APIFY_API_TOKEN is missing or still the placeholder!');
} else {
  console.log(`   ✅  APIFY_API_TOKEN found (${APIFY_TOKEN.substring(0, 8)}...)`);
}
if (!GRAFILAB_KEY || GRAFILAB_KEY === 'your_grafilab_key_here') {
  console.error('   ❌  GRAFILAB_API_KEY is missing or still the placeholder!');
} else {
  console.log(`   ✅  GRAFILAB_API_KEY found (${GRAFILAB_KEY.substring(0, 8)}...)`);
}

// ── 2. Test Apify ─────────────────────────────────────
console.log('\n2️⃣  Testing Apify connection...');
if (APIFY_TOKEN && APIFY_TOKEN !== 'your_apify_token_here') {
  try {
    const client = new ApifyClient({ token: APIFY_TOKEN });
    const user = await client.user().get();
    console.log(`   ✅  Apify connected! Account: ${user.username} | Plan: ${user.plan?.id || 'free'}`);
  } catch (e) {
    console.error(`   ❌  Apify failed: ${e.message}`);
  }
} else {
  console.log('   ⏭️  Skipped (no key)');
}

// ── 3. Test Grafilab / Qwen ───────────────────────────
console.log('\n3️⃣  Testing Grafilab (Qwen 3.7) connection...');
if (GRAFILAB_KEY && GRAFILAB_KEY !== 'your_grafilab_key_here') {
  try {
    const client = new OpenAI({
      apiKey: GRAFILAB_KEY,
      baseURL: 'https://llm.grafilab.ai/v1',
    });
    const resp = await client.chat.completions.create({
      model: 'qwen/qwen3.7-flash',
      messages: [{ role: 'user', content: 'Reply with exactly: {"status":"ok"}' }],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 20,
    });
    const reply = resp.choices[0].message.content;
    console.log(`   ✅  Grafilab connected! Qwen replied: ${reply}`);
  } catch (e) {
    console.error(`   ❌  Grafilab failed: ${e.message}`);
  }
} else {
  console.log('   ⏭️  Skipped (no key)');
}

console.log('\n========================================\n');
