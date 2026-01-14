import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

// Create Bedrock runtime client
const runtimeClient = new BedrockAgentRuntimeClient({
  region: process.env.AWS_REGION,
});

// ─────────────────────────────────────────────
// Knowledge Base Retrieval Tool
// ─────────────────────────────────────────────
export const queryGeneralKnowledgeTool = tool(
  async (input: any) => {
    try {
      const toolStartTime = Date.now();
      console.log("\n🔧 [QueryGeneralKnowledge Tool] Started");
      console.log(`⏱️ [QueryGeneralKnowledge Tool] Called with query:`, input.query);

      const kbId = process.env.GENERAL_KB_ID;

      if (!kbId) {
        return "❌ KB_ID is missing. Please set KB_ID in environment variables.";
      }

      // Call the Knowledge Base retrieve API
      console.log(`⏱️ [QueryGeneralKnowledge Tool] Retrieving from knowledge base...`);
      const retrieveStartTime = Date.now();
      const response = await runtimeClient.send(
        new RetrieveCommand({
          knowledgeBaseId: kbId,
          retrievalQuery: { text: input.query },
          retrievalConfiguration: {
            vectorSearchConfiguration: { numberOfResults: 5 },
          },
        })
      );
      console.log(`⏱️ [QueryGeneralKnowledge Tool] KB retrieval completed in ${Date.now() - retrieveStartTime}ms`);

      const results = response.retrievalResults || [];

      if (!results.length) {
        return "No relevant information found in the knowledge base.";
      }

      // Extract only text chunks
      const chunks = results
        .map((r) => r.content?.text)
        .filter(Boolean)
        .join("\n\n---\n\n");

      // Extract S3 source locations for transparency
      const sources = results.map((r) => r.location?.s3Location).filter(Boolean);

      console.log(`⏱️ [QueryKnowledgeBase Tool] Total time: ${Date.now() - toolStartTime}ms\n`);
      return JSON.stringify(
        {
          answer: chunks,
          sources,
        },
        null,
        2
      );
    } catch (error: any) {
      console.error("Knowledge base query failed:", error);
      return `❌ Failed to query general knowledge base: ${error.message}`;
    }
  },
  {
    name: "query_general_knowledge_documents_kb",
    description:
      "Queries the Amazon Bedrock Knowledge Base for general knowledge documents information based on the user's question.",
    schema: z.object({
      query: z.string().describe("The user's natural language question."),
    }),
  }
);
