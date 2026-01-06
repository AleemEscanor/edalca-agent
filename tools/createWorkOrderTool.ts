import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import Procedure from "../model/procedure/procedureModel";
import Location from "../model/location/locationModel";
import User from "../model/user/usermodel";
import WorkOrder from "../model/workOrder/WorkOrderModel";
import crypto from "crypto";

// Fields required for creating a work order
const requiredFields = [
  "name",
  "description",
  "procedure",
  "location",
  "timeInHours",
  "startDate",
  "dueDate",
  "assignToUser",
];

// Helper: find the next missing field
function getNextMissingField(fields: Record<string, any>) {
  return requiredFields.find((f) => !fields[f]);
}

function parseHumanMessages(messages: any[]) {
  const result: Record<string, any> = {};
  messages.forEach((m) => {
    if (m.getType && m.getType() === "human") {
      const text = m.content.toLowerCase();
      if (text.includes("timeinhours")) {
        const match = text.match(/timeinhours\s*[:=]?\s*(\d+)/);
        if (match) result.timeInHours = parseInt(match[1], 10);
      }
      if (text.includes("location")) {
        const match = text.match(/location\s*[:=]?\s*([a-zA-Z\s]+)/);
        if (match) result.location = match[1].trim();
      }
      if (text.includes("description")) {
        const match = text.match(/description\s*[:=]?\s*(.+)/);
        if (match) result.description = match[1].trim();
      }
      // Repeat for other fields...
    }
  });
  return result;
}

export const createWorkOrderTool = tool(
  async (input: any, config: any) => {
      const toolStartTime = Date.now();
      console.log("\n🔧 [CreateWorkOrder Tool] Started");
      console.log(`⏱️ [CreateWorkOrder Tool] Called with input:`, input);

    const { userId, organizationId } = config?.configurable.user || {};
    let draftFields: Record<string, any> = {};
    const previousDrafts: Record<string, any> = {};
    const toolCallId = config.toolCall.id || crypto.randomUUID();

    // 1️⃣ Collect past draft from previous tool messages
    const toolMessages = (config?.configurable?.state?.messages || []).forEach(
      (m: any) => {
        try {
          const content =
            typeof m.content === "string" ? JSON.parse(m.content) : m.content;
          if (content?.draft) {
            // Object.assign(draftFields, content.draft);
          }
        } catch {}
      }
    );

    // for (const m of toolMessages) {
    //   try {
    //     const data =
    //       typeof m.content === "string" ? JSON.parse(m.content) : m.content;
    //     if (data?.draft) {
    //       draftFields = { ...draftFields, ...data.draft };
    //     }
    //   } catch (e) {
    //     console.warn("⚠️ Could not parse previous draft", e);
    //   }
    // }

    console.log(draftFields, input, "input");
    draftFields = {
      ...draftFields,
      // ...parseHumanMessages(config?.configurable?.state?.messages),
      ...input,
    };
    console.log(draftFields, "draftFields");
    // 3️⃣ Validate procedure
    if (draftFields.procedure && !draftFields.procedureId) {
      // Procedure validation (case-insensitive)
      console.log(`⏱️ [CreateWorkOrder Tool] Validating procedure...`);
      const procStartTime = Date.now();
      const proc = await Procedure.findOne({
        name: { $regex: `^${draftFields.procedure}$`, $options: "i" },
        organizationId,
      });
      console.log(`⏱️ [CreateWorkOrder Tool] Procedure validation completed in ${Date.now() - procStartTime}ms`);
      if (!proc) {
        return new ToolMessage({
          content: JSON.stringify({
            success: false,
            message:
              "Procedure not found. Please provide a valid procedure name.",
            draft: draftFields,
          }),
          name: "createWorkOrder",
          tool_call_id: toolCallId,
        });
      }
      draftFields.procedureId = proc._id;
    }

    // 4️⃣ Validate location
    if (draftFields.location && !draftFields.locationId) {
      // Location validation (case-insensitive)
      console.log(`⏱️ [CreateWorkOrder Tool] Validating location...`);
      const locStartTime = Date.now();
      const loc: any = await Location.findOne({
        name: { $regex: `^${draftFields.location}$`, $options: "i" },
        organizationId,
      });
      console.log(`⏱️ [CreateWorkOrder Tool] Location validation completed in ${Date.now() - locStartTime}ms`);
      if (!loc) {
        return new ToolMessage({
          content: JSON.stringify({
            success: false,
            message: "Please provide a valid location.",
            draft: draftFields,
          }),
          name: "createWorkOrder",
          tool_call_id: toolCallId,
        });
      }
      draftFields.locationId = loc._id;
      draftFields.clientSupervisorId = loc.clientSupervisorId;
      draftFields.companySupervisorId = loc.companySupervisorId;
    }

    // 5️⃣ Validate assigned users
    // Assigned users validation (case-insensitive, supports first-name-only)
    if (draftFields.assignToUser && !draftFields.assignedTo) {
      console.log(`⏱️ [CreateWorkOrder Tool] Validating assigned users...`);
      const userStartTime = Date.now();
      const names = Array.isArray(draftFields.assignToUser)
        ? draftFields.assignToUser
        : draftFields.assignToUser.split(",").map((n: string) => n.trim());

      const queries = names.map((fullName: any) => {
        const [firstName, ...lastNameParts] = fullName.split(" ");
        const lastName = lastNameParts.join(" ");

        if (lastName) {
          // First + Last name provided → match both
          return {
            firstName: { $regex: `^${firstName}$`, $options: "i" },
            lastName: { $regex: `^${lastName}$`, $options: "i" },
          };
        } else {
          // Only first name provided → match only first name
          return {
            firstName: { $regex: `^${firstName}$`, $options: "i" },
          };
        }
      });

      const assignUsers: any[] = await User.find({
        $or: queries.map((q: any) => ({
          ...q,
          organizationId,
        })),
      });

      if (!assignUsers || assignUsers.length !== queries.length) {
        return new ToolMessage({
          content: JSON.stringify({
            success: false,
            message: "Some user names are invalid. Please provide valid names.",
            draft: draftFields,
          }),
          name: "createWorkOrder",
          tool_call_id: toolCallId,
        });
      }

      draftFields.assignedTo = assignUsers.map((u) => ({
        id: u._id,
        name: `${u.firstName} ${u.lastName}.trim()`,
        type: "user",
      }));
      console.log(`⏱️ [CreateWorkOrder Tool] User validation completed in ${Date.now() - userStartTime}ms`);
    }

    // 6️⃣ Check for missing fields
    const missingField = getNextMissingField(draftFields);
    if (missingField) {
      return new ToolMessage({
        content: JSON.stringify({
          success: false,
          message: `Please provide ${missingField}.`,
          draft: draftFields,
        }),
        name: "createWorkOrder",
        tool_call_id: toolCallId,
      });
    }

    // 7️⃣ All fields present → create work order
    console.log(`⏱️ [CreateWorkOrder Tool] All fields validated, creating work order...`);
    const createStartTime = Date.now();
    const f = draftFields;

    const newWorkOrder = await WorkOrder.create({
      name: f.name,
      description: f.description,
      timeInHours: f.timeInHours,
      assignedTo: f.assignedTo,
      startDate: f.startDate,
      dueDate: f.dueDate,
      imageUrl: f.uploadImage || "",
      createdBy: userId,
      organizationId,
      locationId: f.locationId,
      procedureId: f.procedureId,
      clientSupervisorId: f.clientSupervisorId,
      companySupervisorId: f.companySupervisorId,
    });
    console.log(`⏱️ [CreateWorkOrder Tool] Work order created in ${Date.now() - createStartTime}ms`);
    console.log(`⏱️ [CreateWorkOrder Tool] Total time: ${Date.now() - toolStartTime}ms\n`);

    return new ToolMessage({
      content: JSON.stringify({
        success: true,
        message: `Work order "${newWorkOrder.name}" created successfully! And draft cleared.`,
        draft: {},
        reset: true,
        id: newWorkOrder._id,
      }),
      name: "createWorkOrder",
      tool_call_id: toolCallId,
    });
  },
  {
    name: "createWorkOrder",
    description: "Use this tool to  a new work order step by step. Make sure you never use previous drafts which were used to create work order !",
    schema: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      procedure: z.string().optional(),
      location: z.string().optional(),
      timeInHours: z.number().optional(),
      startDate: z.string().optional(),
      dueDate: z.string().optional(),
      assignToUser: z.string().optional(),
      uploadImage: z.string().optional(),
    }),
  }
);
