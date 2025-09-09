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
            Object.assign(draftFields, content.draft);
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
      ...parseHumanMessages(config?.configurable?.state?.messages),
      ...input,
    };
    console.log(draftFields, "draftFields");
    // 3️⃣ Validate procedure
    if (draftFields.procedure && !draftFields.procedureId) {
      const proc = await Procedure.findOne({
        name: draftFields.procedure,
        organizationId,
      });
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
      const loc: any = await Location.findOne({
        name: draftFields.location,
        organizationId,
      });
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
    if (draftFields.assignToUser && !draftFields.assignedTo) {
      const names = Array.isArray(draftFields.assignToUser)
        ? draftFields.assignToUser
        : draftFields.assignToUser.split(",").map((n: string) => n.trim());

      const queries = names.map((fullName: any) => {
        const [firstName, ...lastNameParts] = fullName.split(" ");
        const lastName = lastNameParts.join(" ");
        return { firstName, lastName };
      });

      const assignUsers: any[] = await User.find({
        $or: queries.map((q: any) => ({
          firstName: q.firstName,
          lastName: q.lastName,
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
        name: u.name,
        type: "user",
      }));
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

    return new ToolMessage({
      content: JSON.stringify({
        success: true,
        message: `Work order "${newWorkOrder.name}" created successfully!`,
        draft: draftFields,
        id: newWorkOrder._id,
      }),
      name: "createWorkOrder",
      tool_call_id: toolCallId,
    });
  },
  {
    name: "createWorkOrder",
    description: "Create a new work order step by step.",
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
