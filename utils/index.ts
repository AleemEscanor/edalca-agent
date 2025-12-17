import {
  BedrockAgentCoreControlClient,
  CreateMemoryCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import AgentMemory from "../model/agent/agentModel";

export function sanitizeMemoryName(chatId: string): string {
  // Replace invalid characters with underscores
  let base = chatId.replace(/[^a-zA-Z0-9_]/g, "_");

  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(base)) {
    base = `m_${base}`;
  }

  // Truncate to max 48 characters
  return base.slice(0, 48);
}

export async function getOrCreateMemory(client: any, chatId: string) {
  // Check if memory already exists for this user
  let memory = await AgentMemory.findOne({ chatId: chatId });

  if (!memory) {
    // Create a new memory in Bedrock
    const memoryName = sanitizeMemoryName(chatId);

    const params = {
      name: memoryName,
      description: `Persistent memory for user ${chatId}`,
      eventExpiryDuration: 100,
    };

    const result: any = await client.send(new CreateMemoryCommand(params));
    const newMemoryId = result?.memory?.id; // depends on AWS SDK response shape
    // Save in MongoDB
    memory = await AgentMemory.create({
      chatId: chatId,
      memoryId: newMemoryId,
    });
  }

  return memory.memoryId;
}

import { BaseMessage } from "@langchain/core/messages";
import ChatSession from "../model/agent/ChatSessionModel";
import { ChatOpenAI } from "@langchain/openai";

/**
 * Cleans up past conversation messages by removing any messages
 * before a successful tool call that contains a `reset: true` flag.
 *
 * This is useful for removing stale "draft" states once a work order
 * has been successfully created, preventing old data from leaking into
 * a new work order creation flow.
 *
 * @param pastMessages - Array of past conversation messages
 * @returns A cleaned array of messages starting *after* the last reset point
 */
export function cleanPastMessagesAfterReset(
  pastMessages: BaseMessage[]
): BaseMessage[] {
  const cleanedMessages: BaseMessage[] = [];

  let resetFound = false;

  // Reverse loop to find the most recent reset point
  for (let i = pastMessages.length - 1; i >= 0; i--) {
    const msg = pastMessages[i];

    let content: any;

    try {
      // Try to parse content if it's a JSON string
      content =
        typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;

      // If a tool message explicitly marked a reset
      if (content?.reset === true) {
        resetFound = true;
        break;
      }
    } catch (err) {
      // Skip invalid or non-tool message content
    }

    // Add message to the beginning of cleaned list
    cleanedMessages.unshift(msg);
  }

  // If reset was found, return messages after it (cleanedMessages)
  // If not found, return the full history (no cleanup)
  return resetFound ? cleanedMessages : pastMessages;
}

export function extractSourcesFromMessages(messages: any): string[] | null {
  const urls = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // Case 1: JSON string content
    if (typeof msg.content === "string") {
      try {
        const parsed = JSON.parse(msg.content);
        parsed?.sources?.forEach((s: any) => urls.add(s?.uri));
      } catch {}
    }

    // Case 2: structured content
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        part?.sources?.forEach((u: string) => urls.add(u));
      }
    }

    if (urls.size > 0) break; // keep "last message wins" behavior
  }

  return urls.size ? [...urls] : null;
}

export async function getOrCreateActiveSession(
  client: BedrockAgentCoreControlClient,
  chatId: string,
  sessionId: string,
  userQuery: string
) {
  let session = await ChatSession.findOne({
    chatId: chatId,
    _id: sessionId,
    isActive: true,
  });
  const model = new ChatOpenAI({
    model: "gpt-4o-mini-2024-07-18",
    temperature: 0.2,
  });
  if (!session?.memoryId) {
    // Create Bedrock memory
    const memoryName = `user_${chatId}`;
    const result: any = await client.send(
      new CreateMemoryCommand({
        name: memoryName,
        description: `Memory for chat session ${chatId}`,
        eventExpiryDuration: 30, // 30 days
        memoryStrategies: [
          {
            summaryMemoryStrategy: {
              name: "conversation_summary",
              namespaces: ["/summaries/{actorId}/{sessionId}"],
            },
          },
        ], // This is short-term memory
      })
    );

    const memoryId = result?.memory?.id;

    session.memoryId = memoryId;
    session.save();
  }
  if (!session?.title) {
    // generate a short title using the users first message for the session
    if (!session?.title) {
      const titlePrompt = `
Generate a short, clear title 2-3 words (max 7 words) that summarizes this user request.
Rules:
- No quotes
- No punctuation
- Title Case
- Be concise

User message:
"${userQuery}"
`;

      const titleResponse = await model.invoke(titlePrompt);

      const title =
        typeof titleResponse.content === "string"
          ? titleResponse.content.trim()
          : "New Chat";

      session.title = title;
      await session.save();
    }
  }

  return session;
}
