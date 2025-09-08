// agentTemplate.ts

import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { fetchWorkOrderTool } from "./tools/fetchWorkOrderTool";
import { BedrockAgentCoreClient, CreateEventCommand, PayloadType } from "@aws-sdk/client-bedrock-agentcore";

// ---------------------------
// Define Agent State
// ---------------------------
const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

// ---------------------------
// Tools
// ---------------------------
const tools = [fetchWorkOrderTool];
const toolNode = new ToolNode<typeof GraphState.State>(tools);

// ---------------------------
// Chat Model
// ---------------------------
const chatModel = new ChatOpenAI({
  model: "gpt-4o-mini-2024-07-18",
  temperature: 0,
}).bindTools(tools);

// ---------------------------
// Model Function
// ---------------------------
async function callModel(state: typeof GraphState.State) {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful agent with tools: {tool_names}. Use tools if needed.`,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  const formattedPrompt = await prompt.formatMessages({
    time: new Date().toISOString(),
    tool_names: tools.map((t) => t.name).join(", "),
    messages: state.messages,
  });

  const result = await chatModel.invoke(formattedPrompt);
  return { messages: [result] };
}

// ---------------------------
// Routing Logic
// ---------------------------
async function shouldContinue(state: typeof GraphState.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  return lastMessage.tool_calls?.length ? "tools" : "__end__";
}

// ---------------------------
// Final Agent Entry Point (used by AWS AgentCore)
// ---------------------------
export async function callAgent(
  userQuery: string,
  thread_id: string,
  {
    memoryClient,
    memory_id,
    actor_id,
    session_id,
  }: {
    memoryClient: BedrockAgentCoreClient;
    memory_id: string;
    actor_id: string;
    session_id: string;
  }
) {
  const initialMessage = new HumanMessage(userQuery);

  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  const app = workflow.compile();

  const finalState = await app.invoke(
    { messages: [initialMessage] },
    {
      recursionLimit: 15,
      configurable: { thread_id },
    }
  );

  const allMessages = finalState.messages;

  // 1. Transform all messages into conversational payload format
  const payload: PayloadType[] = allMessages.map((msg) => {
    let role: "USER" | "ASSISTANT" | "TOOL" | "OTHER" = "OTHER";

    if (msg.getType() === "human") role = "USER";
    else if (msg.getType() === "ai") role = "ASSISTANT";
    else if (msg.getType() === "tool") role = "TOOL";

    return {
      conversational: {
        content: { text: msg.content },
        role,
      },
    } as PayloadType;
  });

  // 2. Send single memory event
  const command: any = new CreateEventCommand({
    memoryId: memory_id,
    actorId: actor_id,
    sessionId: session_id,
    eventTimestamp: new Date(),
    payload,
    clientToken: crypto.randomUUID(),
  })
    
  await memoryClient.send(command);

  // 3. Return final assistant message
  return allMessages[allMessages.length - 1].content;
}

