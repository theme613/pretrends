import OpenAI from 'openai';

const apiKey = process.env.GRAFILAB_API_KEY || 'dummy';
const client = new OpenAI({
  apiKey,
  baseURL: 'https://llm.grafilab.ai/v1',
});

export interface ScrapedData {
  id: string;
  title: string;
  creator: string;
  platform: string;
  url: string;
  views_t0: number; // e.g., 3 days ago
  views_t1: number; // e.g., today
  audio_name?: string; // Optional: for tracking trending sounds/music
  audio_uses_t0?: number;
  audio_uses_t1?: number;
  timeframe_days?: number; // Defaults to 3
  collected_at: string;
}

export interface TrendCandidate extends ScrapedData {
  categories: string[];
  breakout: "high" | "medium" | "low";
  score: number;
  reason: string;
  decision: string; // The "So do Z" step
  velocity: number;
}

export async function processCandidate(data: ScrapedData): Promise<TrendCandidate> {
  const velocity = data.views_t0 > 0 ? (data.views_t1 - data.views_t0) / data.views_t0 : 0;
  
  let audioVelocity = 0;
  if (data.audio_uses_t0 && data.audio_uses_t1 && data.audio_uses_t0 > 0) {
    audioVelocity = (data.audio_uses_t1 - data.audio_uses_t0) / data.audio_uses_t0;
  }
  
  if (!process.env.GRAFILAB_API_KEY) {
    // Fallback if no API key
    return {
      ...data,
      velocity,
      categories: ["demo"],
      breakout: velocity > 2 ? "high" : "low",
      score: Math.min(velocity / 10, 1),
      reason: `Velocity is ${velocity.toFixed(2)}x.`,
      decision: "Monitor closely for another 24 hours before deploying capital/effort."
    };
  }

  const prompt = `
You are an elite trend-forecasting AI for a hackathon. Your job is to output: "Our AI predicts X, it's high risk/opportunity because Y, so do Z."
Look for UNUSUAL anomalies—like a massive spike in people using a specific music track or post format over a short timeframe (e.g., 3 days).

Candidate Data:
Title/Trend: "${data.title}"
Creator: ${data.creator}
Platform: ${data.platform}
Timeframe Analyzed: ${data.timeframe_days || 3} days
View Velocity: ${velocity.toFixed(2)}x growth (views grew from ${data.views_t0} to ${data.views_t1})
${data.audio_name ? `Audio/Music Track: "${data.audio_name}"\nAudio Usage Velocity: ${audioVelocity.toFixed(2)}x growth (people using this sound grew from ${data.audio_uses_t0} to ${data.audio_uses_t1})` : "Audio/Music Track: N/A"}

Instructions:
1. Detect: Look at the velocity.
2. Categorize: Score it 0.0 to 1.0 (1.0 = explosive anomaly).
3. Explain (The Y): Why is this happening?
4. Prioritize/Decide (The Z): What is the specific business/creator action to take?

Return STRICT JSON with no other text:
{
  "categories": ["list", "of", "relevant", "categories"],
  "breakout": "high|medium|low",
  "score": 0.0 to 1.0 (float),
  "reason": "The 'because Y' explanation (one sentence).",
  "decision": "The 'so do Z' recommendation (one sentence action)."
}
`;

  try {
    const response = await client.chat.completions.create({
      model: 'qwen/qwen3.7-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      top_p: 0.95,
      response_format: { type: "json_object" }
    });

    const resultText = response.choices[0].message.content || '{}';
    const result = JSON.parse(resultText);

    return {
      ...data,
      velocity,
      categories: result.categories || [],
      breakout: result.breakout || "low",
      score: typeof result.score === 'number' ? result.score : Math.min(velocity / 5, 1),
      reason: result.reason || `Velocity is ${velocity.toFixed(2)}x`
    };
  } catch (error) {
    console.error("AI processing failed for", data.title, error);
    return {
      ...data,
      velocity,
      categories: ["unknown"],
      breakout: velocity > 1 ? "medium" : "low",
      score: Math.min(velocity / 10, 1),
      reason: `Velocity is ${velocity.toFixed(2)}x (fallback due to AI error).`
    };
  }
}
