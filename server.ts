import express, { Request, Response } from "express";
import { callAgent } from "./index";
import dotenv from "dotenv";
import initializeMongoConnection from "./local_runner";
import cors from "cors";
import { BedrockAgentCoreControlClient } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { getOrCreateActiveSession } from "./utils";

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
    console.log("-Request Body", req.body);

    const { prompt: userQuery, chatId, sessionId, userId, organizationId } = req.body;

    if (!userQuery || typeof userQuery !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid 'prompt' in request payload." });
    }

    // ----- SESSION INTEGRATION -----
    const session = await getOrCreateActiveSession(client, chatId, sessionId, userQuery);

    console.log(`- Using sessionId: ${session._id}, memoryId: ${session.memoryId}`);

    const agentResponse = await callAgent(userQuery, `thread-${Date.now()}`, {
      memoryClient,
      memoryId: session.memoryId,
      actor_id: userId,
      session_id: sessionId,
      organizationId,
    });

    const responseTime = Date.now() - startTime;
    console.log(`✅ Agent responded successfully in ${responseTime}ms`);

    res.status(200).json({
      output: {
        message: agentResponse.message,
        sources: agentResponse?.sources,
        metadata: {
          responseTime,
          sessionId: session.sessionId,
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
  // console.log("🏓 Health check requested");
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
