import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import WorkOrder from "../model/workOrder/WorkOrderModel";

// You can cache or reuse the model instance
const model = new ChatOpenAI({
  model: "gpt-4o-mini-2024-07-18",
  temperature: 0,
});


export const fetchWorkOrderTool = tool(
  async (input: any) => {

    // Step 1: Ask the model to convert NL to MongoDB filter
    const systemPrompt = `You are a MongoDB query assistant. Your job is to convert natural language filters into MongoDB filter objects for the WorkOrder schema.

Use:
- Case-insensitive regex for all fields.
- Use "$regex": "term", "$options": "i" for fuzzy matching
- Always return a JSON object only. No Markdown or explanation.

Schema fields you can use: 
- name
- description
- assignedTo.name
- status
- startDate
- dueDate
- organizationId
- isDeleted
`;

    const userPrompt = `Convert this into a MongoDB filter:
"${input.query}"`;

    const filterMessage = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    
   let parsedFilter;
try {
    const content = filterMessage.content as string
  const rawContent = content?.trim() || "";

  // Remove Markdown code block wrapper if it exists
  const jsonString = rawContent
    .replace(/^```json/, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  parsedFilter = JSON.parse(jsonString);
} catch (err) {
  return `❌ Failed to parse generated MongoDB filter: ${filterMessage.content}`;
}

    // Step 2: Run query
    const workOrders = await WorkOrder.find(parsedFilter).limit(30).lean();    

    if (!workOrders.length) return "No work order found for the given criteria.";

    return `Found ${workOrders.length} work order(s): ${JSON.stringify(workOrders, null, 2)}`;
  },
  {
    name: "fetch_workOrder_tool",
    description: "Fetches work order details by parsing natural language filter for different work order fields.",
    schema: z.object({
      query: z.string().describe("Natural language work order query"),
    }),
  }
);
