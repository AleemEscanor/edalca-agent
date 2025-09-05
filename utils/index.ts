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