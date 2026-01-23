import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  BaseMessage,
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  ListEventsCommand,
  RetrieveMemoryRecordsCommand,
  CreateEventCommand,
  BedrockAgentCoreClient,
  Role,
} from "@aws-sdk/client-bedrock-agentcore";
import { fetchWorkOrderTool } from "./tools/fetchWorkOrderTool";
import { queryKnowledgeBaseTool } from "./tools/queryKnowledgeBaseTool";
import * as crypto from "crypto";
import { SYSTEM_INSTRUCTION } from "./constants/prompts";
import { webSearchGroundingTool } from "./tools/webSearchTool";

// --- Graph Setup ---
const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  summaries: Annotation<string[]>(),
});

// --- 1. MOVE TO TOP LEVEL (SINGLETONS) ---
const tools = [fetchWorkOrderTool, queryKnowledgeBaseTool, webSearchGroundingTool];
const toolNode = new ToolNode(tools);
const model = new ChatGoogleGenerativeAI({
  model: "gemini-flash-latest", // Recommending 1.5-flash for speed
  apiKey: process.env.GEMINI_API_KEY,
  streaming: true,
  temperature: 0,
}).bindTools(tools);

const callModel = async (state: typeof StateAnnotation.State) => {
  const response = await model.invoke([
    new SystemMessage(SYSTEM_INSTRUCTION),
    ...state.messages,
  ]);
  return { messages: [response] };
};

// Pre-compile the graph once when the module loads
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", (state) => {
    const lastMsg = state.messages[state.messages.length - 1] as AIMessage;
    return lastMsg.tool_calls?.length ? "tools" : END;
  })
  .addEdge("tools", "agent");

const app = workflow.compile();

export async function runWorkOrderAgent(
  userQuery: string,
  thread_id: string,
  {
    memoryClient,
    memoryId,
    actor_id,
    session_id,
    organizationId,
    onToken,
  }: {
    memoryClient: BedrockAgentCoreClient;
    memoryId: string;
    actor_id: string;
    session_id: string;
    organizationId: string;
    onToken?: (token: string) => void;
  }
) {
  // 1. Context Fetching (History & Summaries)
  const [historyResponse, summariesResponse] = await Promise.all([
    memoryClient.send(
      new ListEventsCommand({
        memoryId,
        actorId: actor_id,
        sessionId: session_id,
        maxResults: 10,
      })
    ),
    memoryClient.send(
      new RetrieveMemoryRecordsCommand({
        memoryId,
        namespace: `/summaries/${actor_id}/${session_id}`,
        searchCriteria: { searchQuery: userQuery, topK: 5 },
      })
    ),
  ]);

  const historyMessages: BaseMessage[] = (historyResponse.events || []).flatMap(
    (event: any) => {
      return (event.payload || []).map((p: any) => {
        const content = p.conversational?.content?.text || "";
        return p.conversational?.role === "USER"
          ? new HumanMessage(content)
          : new AIMessage(content);
      });
    }
  );

  const summaryContext: string[] = (
    summariesResponse.memoryRecordSummaries || []
  ).map((record: any) => record.content?.text || "");

  // 3. Streaming Execution
  const initialState = {
    messages: [...historyMessages, new HumanMessage(userQuery)],
    summaries: summaryContext,
  };
  console.log("initialState", initialState);

  const stream = await app.stream(initialState, {
    configurable: { thread_id, onToken: onToken },
    // Passing via metadata is often more reliable for tool access
  metadata: { onToken },
    streamMode: "messages",
  });

  let finalContent = "";
  let lastToolCall: any = null;

  for await (const [message, metadata] of stream) {
    // 💡 FIX: Metadata node check for streaming tokens
    if (metadata.langgraph_node === "agent") {
      const content = message.content as string;

      // Stream tokens to frontend
      if (content && onToken) {
        onToken(content);
      }

      finalContent += content;

      if ((message as AIMessage).tool_calls?.length) {
        lastToolCall = (message as AIMessage).tool_calls;
      }
    }
  }

  // 4. Persistence to Bedrock (finalContent remains clean)
  memoryClient.send(
    new CreateEventCommand({
      memoryId,
      actorId: actor_id,
      sessionId: session_id,
      eventTimestamp: new Date(),
      clientToken: crypto.randomUUID(),
      payload: [
        { conversational: { role: Role.USER, content: { text: userQuery } } },
        ...(lastToolCall
          ? [
              {
                conversational: {
                  role: Role.TOOL,
                  content: {
                    text: `Used Tools: ${lastToolCall
                      .map((t: any) => t.name)
                      .join(", ")}`,
                  },
                },
              },
            ]
          : []),
        {
          conversational: {
            role: Role.ASSISTANT,
            content: { text: finalContent },
          },
        },
      ],
    })
  );
  console.log("finalContent", finalContent);
  console.log("lastToolCall", lastToolCall);
  return finalContent;
}
