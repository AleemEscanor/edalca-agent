// agentTemplate.ts

import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { fetchWorkOrderTool } from "./tools/fetchWorkOrderTool";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  PayloadType,
} from "@aws-sdk/client-bedrock-agentcore";
import { ListEventsCommand } from "@aws-sdk/client-bedrock-agentcore";
import { createWorkOrderTool } from "./tools/createWorkOrderTool";
import { cleanPastMessagesAfterReset } from "./utils";

function convertEventToMessage(event: any): BaseMessage | null {
  if (!event?.payload || event?.payload?.length === 0) {
    console.warn("⚠️ Skipping event without payload", event);
    return null;
  }

  const payloadItem = event.payload[0];
  const conversational =
    payloadItem?.Conversational || payloadItem?.conversational;
  const role = conversational?.Role || conversational?.role;
  const text =
    conversational?.Content?.Text || conversational?.content.text || "";

  if (!text) {
    console.warn("⚠️ Skipping empty payload text", event);
    return null;
  }

  if (role === "USER") return new HumanMessage(text);
  if (role === "ASSISTANT") return new AIMessage(text);
  return new HumanMessage(text); // fallback
}

async function fetchConversationHistory(
  memoryClient: BedrockAgentCoreClient,
  memory_id: string,
  session_id: string,
  actor_id: string
): Promise<BaseMessage[]> {
  const command = new ListEventsCommand({
    memoryId: memory_id,
    sessionId: session_id,
    actorId: actor_id,
  });

  const response = await memoryClient.send(command);
  const events = response?.events || [];

  return events
    .map((event: any) => convertEventToMessage(event))
    .filter((msg: BaseMessage | null): msg is BaseMessage => msg !== null);
}

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
const tools = [fetchWorkOrderTool, createWorkOrderTool];
const toolNode = new ToolNode<typeof GraphState.State>(tools);

// ---------------------------
// Chat Model
// ---------------------------y
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
      `You are a helpful agent named Edalca Ai and you have capabilities with tools: {tool_names}.

      - Use "fetch_workOrder_tool" when the user wants to search or filter work orders.  
      - Use "create_workOrder_tool" when the user wants to create a new work order.  

      For create_workOrder_tool: Extract values into its schema fields:  
      name, description, procedure, location, timeInHours, startDate, dueDate, assignToUser, uploadImage.  
      If user input is incomplete, call the tool with what you have so it can guide the user for missing fields.`,
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
    organizationId,
  }: {
    memoryClient: BedrockAgentCoreClient;
    memory_id: string;
    actor_id: string;
    session_id: string;
    organizationId: string;
  }
) {
  const pastMessages = await fetchConversationHistory(
    memoryClient,
    memory_id,
    session_id,
    actor_id
  );

  // console.log(pastMessages, "pastMessages");

  const initialMessage = new HumanMessage(userQuery);

  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  const app = workflow.compile();

  const cleanedMessages = cleanPastMessagesAfterReset(pastMessages);
  const initialState = { messages: [...cleanedMessages, initialMessage] };

  const finalState = await app.invoke(initialState, {
    recursionLimit: 15,
    configurable: {
      thread_id,
      user: { userId: actor_id, organizationId },
      state: initialState,
    },
  });

  const allMessages = finalState.messages;

  const latestTwo = allMessages.slice(-2);

  const payload: PayloadType[] = latestTwo.map((msg: any) => {
    let role: "USER" | "ASSISTANT" | "TOOL" | "OTHER" = "OTHER";

    if (msg.getType() === "human") role = "USER";
    else if (msg.getType() === "ai") role = "ASSISTANT";
    else if (msg.getType() === "tool") role = "TOOL";

    let textContent = "";
    if (typeof msg.content === "string") {
      textContent = msg.content.trim();
    } else if (Array.isArray(msg.content)) {
      textContent = msg.content
        .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
        .join(" ")
        .trim();
    } else if (msg.content?.text) {
      textContent = msg.content.text;
    }
console.log('-------textContent--------', textContent);

    return {
      conversational: { content: { text: textContent }, role: "USER" },
    } as unknown as PayloadType;
  });

  // 2. Send single memory event
  const command: any = new CreateEventCommand({
    memoryId: memory_id,
    actorId: actor_id,
    sessionId: session_id,
    eventTimestamp: new Date(),
    payload,
    clientToken: crypto.randomUUID(),
  });

  const res = await memoryClient.send(command);
  console.log('-Insert in memory Response: ', res);

  // 3. Return final assistant message
  return allMessages[allMessages.length - 1].content;
}
