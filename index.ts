// agentTemplate.ts

import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StateGraph } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { fetchWorkOrderTool } from "./tools/fetchWorkOrderTool";

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
export async function callAgent(userQuery: string, thread_id: string) {
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  const app = workflow.compile(); // ✅ No MongoDBSaver

  const finalState = await app.invoke(
    { messages: [new HumanMessage(userQuery)] },
    {
      recursionLimit: 15,
      configurable: { thread_id }, // ✅ Passed from AWS AgentCore
    }
  );

  return finalState.messages[finalState.messages.length - 1].content;
}
