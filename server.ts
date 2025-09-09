import express, { Request, Response } from "express";
import { callAgent } from "./index";
import dotenv from "dotenv";
import initializeMongoConnection from "./local_runner";
import cors from "cors";
import { BedrockAgentCoreControlClient } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { getOrCreateMemory } from "./utils";

dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
// Middleware
app.use(express.json());
app.use(cors());

const client = new BedrockAgentCoreControlClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const memoryClient = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Handle invocation requests from the Bedrock AgentCore Runtime
app.post("/invocations", async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    await initializeMongoConnection();
    console.log("req.body", req.body);

    const { prompt: userQuery, sessionId, userId } = req.body;
    console.log(
      "  - Query:" +
        `${userQuery.substring(0, 100)}${userQuery.length > 100 ? "..." : ""}`
    );

    if (!userQuery || typeof userQuery !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'prompt' in request payload." });
    }

    const threadId = `session-${Date.now()}`;

    console.log("🔍 Processing request:");
    console.log("  - Thread ID:" + `${threadId}`);

    const memoryId = await getOrCreateMemory(client, sessionId);
    console.log(memoryId, "memoryId");

    const memoryConfig = {
      memoryClient: memoryClient,
      memory_id: memoryId,
      actor_id: userId,
      session_id: sessionId
    }

    const agentResponse = await callAgent(userQuery, threadId, memoryConfig);

    const responseTime = Date.now() - startTime;
    console.log(`✅ Agent responded successfully in ${responseTime}ms`);

    res.status(200).json({
      output: {
        message: agentResponse,
        metadata: {
          responseTime,
          sessionId: threadId,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.error(`❌ Agent invocation failed after ${responseTime}ms`, error);
    res.status(500).json({
      error: "Agent processing failed.",
      details: error?.message,
    });
  }
});
// Health check endpoint with more details
app.get("/ping", (req: Request, res: Response) => {
  console.log("🏓 Health check requested");
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
// Start the server
app.listen(port, () => {
  console.log(`🚀 Agent server listening at http://localhost:${port}`);
});
