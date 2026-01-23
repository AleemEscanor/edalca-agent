import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { RunnableConfig } from "@langchain/core/runnables";

// Create Bedrock runtime client
const runtimeClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
});

// ─────────────────────────────────────────────
// Knowledge Base Retrieval Tool
// ─────────────────────────────────────────────
export const queryKnowledgeBaseTool = tool(
  async ({ query }, config?: RunnableConfig) => {
    try {
      // 💡 Extract the onToken from the metadata we will pass in
      const onToken = config?.metadata?.onToken;

      if (typeof onToken === "function") {
        onToken(`📖 *Searching Knowledge Base for: "${query}"...*\n\n`);
      }

      console.log("Tool called - Query Documents Knowledge Base");
      console.log("Input query:", query);

      const kbId = process.env.KB_ID;

      if (!kbId) {
        return "❌ KB_ID is missing. Please set KB_ID in environment variables.";
      }

      // Call the Knowledge Base retrieve API
      const response = await runtimeClient.send(
        new RetrieveCommand({
          knowledgeBaseId: kbId,
          retrievalQuery: { text: query },
          retrievalConfiguration: {
            vectorSearchConfiguration: { numberOfResults: 5 },
          },
        })
      );

      const results = response.retrievalResults || [];

      if (!results.length) {
        return "No relevant information found in the knowledge base.";
      }      

      // Format the results into paired strings
      const formattedResults = results
        .reduce((acc: Record<string, string[]>, r) => {
          const text = r.content?.text || "No content";
          const source = r.location?.s3Location?.uri || "Unknown Source";
          if (!acc[source]) {
        acc[source] = [];
          }
          acc[source].push(text);
          return acc;
        }, {})
        const resultsBySource = Object.entries(formattedResults)
        .map(([source, texts], index) => 
          `Document Chunk [${index + 1}]:\nContent: ${texts.join("\n")}\nSource URL: ${source}`
        )
        .join("\n\n---\n\n");

      console.log('resultsBySource', resultsBySource);

      return resultsBySource;
    } catch (error: any) {
      console.error("Knowledge base query failed:", error);
      return `❌ Failed to query knowledge base: ${error.message}`;
    }
  },
  {
    name: "query_documents_kb",
    description:
      "MUST use this tool to search internal technical manuals and company documents. You MUST provide a specific search 'query' string based on the user's request.",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe("The user's natural language question."),
    }),
  }
);
