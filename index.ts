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
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { ListEventsCommand } from "@aws-sdk/client-bedrock-agentcore";
import { createWorkOrderTool } from "./tools/createWorkOrderTool";
import { cleanPastMessagesAfterReset, extractSourcesFromMessages } from "./utils";
import { queryKnowledgeBaseTool } from "./tools/queryKnowledgeBaseTool";

function convertEventToMessages(event: any): BaseMessage[] {
  if (!Array.isArray(event?.payload) || event.payload.length === 0) {
    console.warn("⚠️ Skipping event without payload", event);
    return [];
  }

  return event.payload
    .map((payloadItem: any) => {      
      const conversational =
        payloadItem?.Conversational || payloadItem?.conversational;

      const role =
        conversational?.Role || conversational?.role;

      const text =
        conversational?.Content?.Text ||
        conversational?.content?.text ||
        "";

      if (!text) {
        console.warn("⚠️ Skipping empty payload item", payloadItem);
        return null;
      }

      if (role === "USER") return new HumanMessage(text);
      if (role === "ASSISTANT") return new AIMessage(text);

      return new HumanMessage(text); // fallback
    })
    .filter((msg: any): msg is BaseMessage => msg !== null);
}


async function fetchConversationHistory(
  memoryClient: BedrockAgentCoreClient,
  memoryId: string,
  session_id: string,
  actor_id: string
): Promise<BaseMessage[]> {
  const command = new ListEventsCommand({
    memoryId: memoryId,
    sessionId: session_id,
    actorId: actor_id,
  });

  const response = await memoryClient.send(command);
  const events = response?.events || [];
  return events.flatMap((event: any) =>
    convertEventToMessages(event)
  );
}

async function fetchConversationSummary(
  userQuery: string,
  memoryClient: BedrockAgentCoreClient,
  memoryId: string,
  session_id: string,
  actor_id: string
): Promise<BaseMessage[]> {
  const command = new RetrieveMemoryRecordsCommand({
    memoryId: memoryId,
    namespace: `/summaries/${actor_id}/${session_id}`,
    searchCriteria: {
        "searchQuery": userQuery,
        "topK": 5
    },
  });

  const response = await memoryClient.send(command);
  const memoryRecordSummaries = response?.memoryRecordSummaries || [];
  
  return memoryRecordSummaries.map((record: any) =>
    record?.content?.text
  );
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
const tools = [fetchWorkOrderTool, createWorkOrderTool, queryKnowledgeBaseTool];
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
      - Use 'query_documents_kb' whenever:
        - the user asks a question about documents
        - the answer is stored in documents in S3
        - the question is informational and requires referencing the Knowledge Base" 

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
    memoryId,     // Bedrock memory for session
    actor_id,
    session_id,    // session ID
    organizationId,
  }: {
    memoryClient: BedrockAgentCoreClient;
    memoryId: string;
    actor_id: string;
    session_id: string;
    organizationId: string;
  }
) {
  // 1️⃣ Fetch past messages from this session
  const pastMessages = await fetchConversationHistory(
    memoryClient,
    memoryId,
    session_id,
    actor_id
  );

  const pastSummaries = await fetchConversationSummary(
    userQuery,
    memoryClient,
    memoryId,
    session_id,
    actor_id
  );

  const initialMessage = new HumanMessage(userQuery);

  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  const app = workflow.compile();

  // Clean messages if previous session reset happened
  const cleanedMessages = cleanPastMessagesAfterReset(pastMessages);
  const initialState = { messages: [...cleanedMessages, initialMessage], summaries: pastSummaries };

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

  // 2️⃣ Insert events into Bedrock memory for this session
  const payload: PayloadType[] = latestTwo.map((msg: any) => {
    let role: "USER" | "ASSISTANT" | "TOOL" | "OTHER" = "OTHER";
    
    if (msg.getType() === "human") role = "USER";
    else if (msg.getType() === "ai") role = "ASSISTANT";
    else if (msg.getType() === "tool") role = "TOOL";

    let textContent = "";
    if (typeof msg.content === "string") textContent = msg.content.trim();
    else if (Array.isArray(msg.content)) {
      textContent = msg.content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join(" ").trim();
    } else if (msg.content?.text) textContent = msg.content.text;

    return { conversational: { content: { text: textContent }, role } } as unknown as PayloadType;
  });

  const command: any = new CreateEventCommand({
    memoryId: memoryId,
    actorId: actor_id,
    sessionId: session_id,
    eventTimestamp: new Date(),
    payload,
    clientToken: crypto.randomUUID(),
  });

  const res = await memoryClient.send(command);

  const finalMessageContent = allMessages[allMessages.length - 1].content;
  const sources = extractSourcesFromMessages(allMessages);

  return sources ? { message: finalMessageContent, sources } : { message: finalMessageContent };
}

