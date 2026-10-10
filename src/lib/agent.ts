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
  views_t0: number;
  views_t1: number;
  collected_at: string;
}

export interface TrendCandidate extends ScrapedData {
  categories: string[];
  breakout: "high" | "medium" | "low";
  score: number;
  reason: string;
  velocity: number;
}

export async function processCandidate(data: ScrapedData): Promise<TrendCandidate> {
  const velocity = data.views_t0 > 0 ? (data.views_t1 - data.views_t0) / data.views_t0 : 0;
  
  if (!process.env.GRAFILAB_API_KEY) {
    // Fallback if no API key
    return {
      ...data,
      velocity,
      categories: ["demo"],
      breakout: velocity > 2 ? "high" : "low",
      score: Math.min(velocity / 10, 1),
      reason: `Velocity is ${velocity.toFixed(2)}x (fallback reason).`
    };
  }

  const prompt = `
Analyze this trending content candidate:
Title: "${data.title}"
Creator: ${data.creator}
Platform: ${data.platform}
Velocity: ${velocity.toFixed(2)} (views grew from ${data.views_t0} to ${data.views_t1})

Return STRICT JSON with no other text:
{
  "categories": ["list", "of", "relevant", "categories"],
  "breakout": "high|medium|low",
  "score": 0.0 to 1.0,
  "reason": "One plain sentence explaining why it's heating up."
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
