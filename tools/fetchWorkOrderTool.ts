import { tool } from "@langchain/core/tools";
import { z } from "zod";
import WorkOrder from "../model/workOrder/WorkOrderModel";
import { initializeMongoConnection } from "../local_runner";
import { RunnableConfig } from "@langchain/core/runnables";
// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// // You can cache or reuse the model instance
// const model = new ChatGoogleGenerativeAI({
//   model: "gemini-3-flash-preview",
//   apiKey: process.env.GEMINI_API_KEY,
//   temperature: 0,
// });

// export const fetchWorkOrderTool = tool(
//   async (input: any) => {
//     try {
//       console.log("Initializing MongoDB COnnection...");
//       await initializeMongoConnection();
//       console.log("Connection Initialized !!");

//       const toolStartTime = Date.now();
//       console.log("\n🔧 [FetchWorkOrder Tool] Started");
//       console.log(`⏱️ [FetchWorkOrder Tool] Called with input:`, input);

//       // Step 1: Ask the model to convert NL to MongoDB filter
//       console.log(`⏱️ [FetchWorkOrder Tool] Converting natural language to MongoDB query...`);
//       const conversionStartTime = Date.now();
//       const systemPrompt = `You are a MongoDB query assistant. Your job is to convert natural language instructions into MongoDB query objects for the WorkOrder schema.

// Instructions:
// 1. If the input is asking to **list specific fields** (e.g., "show all names", "get descriptions"), return a projection object to include only those fields.
// 2. If the input asks for **filtered results**, return a MongoDB filter object using the rules below.
// 3. If the input requests only specific fields from all documents (e.g., "get all names", "list all descriptions", "show only due dates"), treat it as a projection request. Include a projection object for the requested fields. Also, include { "isDeleted": false } as a default filter unless the user explicitly requests deleted records. Do not include any additional filter logic.
// 4. If both filtering and specific fields are mentioned (e.g., "show names of work orders assigned to John"), return both a filter and a projection.
// 5. Never return unnecessary fields. Include only what’s asked or relevant.

//       Use:
//       - Case-insensitive regex for all fields.
//       - Use "$regex": "term", "$options": "i" for fuzzy matching
//       - Always return a JSON object only. No Markdown or explanation.
//       - Support nested fields (e.g., assignedTo.name) with dot notation.
//       - Support date filters (e.g., startDate, dueDate) when applicable.
//       - Always exclude soft-deleted records by including "isDeleted": false unless the user explicitly requests deleted ones.
//       - For date values, use ISO string format only (e.g., "2023-08-01T00:00:00Z"). Do not use ISODate(...) or any MongoDB shell functions. The response must be valid JSON that can be parsed directly with JSON.parse().

//       Schema fields you can use:
//       - name
//       - description
//       - assignedTo.name
//       - status
//       - startDate
//       - dueDate
//       - organizationId
//       - isDeleted

//       Output Formats:

// Depending on user intent, respond with one of the following valid JSON objects only:

// Only Filter (no specific fields requested):
// {
// "filter": {
// "assignedTo.name": { "$regex": "John", "$options": "i" },
// "isDeleted": false
// }
// }

// Only Projection (no filter needed, just list fields):
// {
// "projection": {
// "name": 1,
// "description": 1
// }
// }

// Filter + Projection (both conditions and specific fields requested):
// {
// "filter": {
// "status": { "$regex": "open", "$options": "i" },
// "assignedTo.name": { "$regex": "Jane", "$options": "i" },
// "isDeleted": false
// },
// "projection": {
// "name": 1,
// "dueDate": 1
// }
// }

// Empty Filter (get all work orders without condition):
// {
// "filter": {
// "isDeleted": false
// }
// }

// EXAMPLE-
// Input: "Get a list of all work order names only."

// Output:
// {
//   "filter": {
//     "isDeleted": false
//   },
//   "projection": {
//     "name": 1
//   }
// }
//       `;
//       console.log("---------inputQuery-------", input);

//       const userPrompt = `Convert this into a MongoDB filter:
//       "${input.query}"`;

//       const filterMessage = await model.invoke([
//         { role: "system", content: systemPrompt },
//         { role: "user", content: userPrompt },
//       ]);
//       console.log(`⏱️ [FetchWorkOrder Tool] NL conversion completed in ${Date.now() - conversionStartTime}ms`);

//       console.log("-------filetermessage------", filterMessage);

//       let parsedFilter;
//       try {
//         const parseStartTime = Date.now();
//         const content = filterMessage.content as string;
//         const rawContent = content?.trim() || "";

//         // Remove Markdown code block wrapper if it exists
//         const jsonString = rawContent
//           .replace(/^```json/, "")
//           .replace(/^```/, "")
//           .replace(/```$/, "")
//           .replace(/ISODate\("/g, '"') // convert ISODate("...") → "..."
//           .trim();

//         parsedFilter = JSON.parse(jsonString);
//         console.log(`⏱️ [FetchWorkOrder Tool] Filter parsing completed in ${Date.now() - parseStartTime}ms`);
//       } catch (err) {
//         return `❌ Failed to parse generated MongoDB filter: ${filterMessage.content}`;
//       }
//       console.log("-------parsedFilter--------", parsedFilter);

//       const { filter = {}, projection = {} } = parsedFilter;

//       // Step 2: Run query
//       console.log(`⏱️ [FetchWorkOrder Tool] Executing MongoDB query...`);
//       const queryStartTime = Date.now();
//       const workOrders = await WorkOrder.find(filter, projection)
//         .limit(30)
//         .lean();
//       console.log(`⏱️ [FetchWorkOrder Tool] Query executed in ${Date.now() - queryStartTime}ms, found ${workOrders.length} records`);

//       if (!workOrders.length)
//         return "No work order found for the given criteria.";

//       console.log(`⏱️ [FetchWorkOrder Tool] Total time: ${Date.now() - toolStartTime}ms\n`);
//       return `Found ${workOrders.length} work order(s): ${JSON.stringify(workOrders,null,2)}`;

//     } catch (error) {
//       return `Failed to fetch work order: ${error}`;
//     }
//   },
//   {
//     name: "fetch_workOrder_tool",
//     description:
//       "Parses natural language queries related to work orders and converts them into MongoDB filters and projections to fetch relevant records.",
//     schema: z.object({
//       query: z.string().describe("Natural language work order query"),
//     }),
//   }
// );

export const fetchWorkOrderTool = tool(
  async ({ filter, projection }, config?: RunnableConfig) => {
    try {
      await initializeMongoConnection();
      // 💡 Extract the onToken from the metadata we will pass in
      const onToken = config?.metadata?.onToken;

      if (typeof onToken === "function") {
        onToken(`🔍 *Searching Work Order in database...*\n\n`);
      }

      // Safety: Parse if the model sent them as strings, otherwise use as-is
      const queryFilter =
        typeof filter === "string" ? JSON.parse(filter) : filter;
      const queryProjection =
        typeof projection === "string" ? JSON.parse(projection) : projection;

      // Always enforce soft-delete filter unless specifically overridden
      const finalFilter = { isDeleted: false, ...queryFilter };

      console.log("🛠️ Executing Mongo Query:", JSON.stringify(finalFilter));

      const workOrders = await WorkOrder.find(
        finalFilter,
        queryProjection || {}
      )
        .limit(15) // Fast limit
        .lean();

      if (!workOrders.length) return "Result: No records found.";

      return JSON.stringify(workOrders);
    } catch (error) {
      console.error("Mongo Tool Error:", error);
      return `Error: Failed to query database. Ensure filter is valid JSON.`;
    }
  },
  {
    name: "fetch_work_orders",
    description:
      "Queries the WorkOrder MongoDB collection. Use this for status, assignments, and job details.",
    schema: z.object({
      filter: z
        .string()
        .describe(
          'A stringified JSON MongoDB filter object. Example: \'{"status": "open"}\''
        ),
      projection: z
        .string()
        .optional()
        .describe(
          'A stringified JSON projection object. Example: \'{"name": 1, "status": 1}\''
        ),
    }),
  }
);
