import { CreateMemoryCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import AgentMemory from "../model/workOrder/agent/agentModel";

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
  console.log("-Memory: ", memory);

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
        typeof msg.content === "string"
          ? JSON.parse(msg.content)
          : msg.content;

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
