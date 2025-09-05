import mongoose from "mongoose";

const AssignedToSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['group', 'user'], // restrict to allowed types
    required: true
  },
  id: {
    type: String, 
    required: true
  },
  name: {
    type: String,
    required: true
  }
}, { _id: false });

// Main WorkOrder schema
const WorkOrderSchema = new mongoose.Schema(
  {
    name: String,
    description: String,
    imageUrl: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    clientSupervisorId: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    companySupervisorId: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    procedureId: { type: mongoose.Schema.Types.ObjectId, ref: "Procedure" },
    formData: {
      type: Map,
      of: new mongoose.Schema(
        {
          imageUrls: [String],
          outcome: String,
          reason: String,
          text: String,
        },
        { _id: false }
      ),
      default: {},
    },
    assignedTo: [AssignedToSchema],
    timeInHours: String,
    dueDate: Date,
    startDate: Date,
    status: { type: String, enum: ["Open", "On Hold", "In Progress", "Done"] },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: "Report" },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true, // Adds `createdAt` and `updatedAt`
  }
);

const WorkOrder = mongoose.models.WorkOrder || mongoose.model("WorkOrder", WorkOrderSchema);
export default WorkOrder;
