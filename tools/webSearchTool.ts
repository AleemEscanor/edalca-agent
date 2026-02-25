import { GoogleGenAI } from "@google/genai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const webSearchGroundingTool = tool(async ({ query }) => {
    console.log('🔍 Grounding Searxh tool called with query', query)
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Call Gemini Natively with Grounding
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash", // Use a stable model here
    contents: [{ role: "user", parts: [{ text: query }] }],
    config: {
      tools: [{ googleSearch: {} }] 
    }
  });

  if (!response) return "Found Nothing on Web Search";
  
  const candidate = response.candidates?.[0];
  if (!candidate) return "Found Nothing on Web Search";
  
  const text = candidate.content?.parts?.[0]?.text ?? "";
  const metadata = candidate.groundingMetadata;

  // IMPORTANT: You must manually format the links so the outer agent sees them
  let sourcesList = "\n\nWeb Sources:\n";
  metadata?.groundingChunks?.forEach((chunk, i) => {
    sourcesList += `[Web ${i+1}] ${chunk?.web?.title}: ${chunk?.web?.uri}\n`;
  });

  return `RESEARCH REPORT:\n${text}\n${sourcesList}`;
}, {
  name: "deep_web_research",
  description: "Use this for complex questions that require current web information.",
  schema: z.object({ query: z.string() })
});