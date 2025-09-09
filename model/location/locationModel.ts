import mongoose, { Model } from "mongoose";

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    description: { type: String, required: true },
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
    lastChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // To get the last changed at time, use updatedAt key
    status: { type: String, enum: ["active", "inactive"], default: "active" }, // if we delete it in future, then we can simply mark it as inactive
    imageUrl: { type: String },
    groupResponsible: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }], // Array of group IDs
    clientSupervisorId: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // Array of client supervisor IDs
    companySupervisorId: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    ],
  },
  {
    timestamps: true, // Adds `createdAt` and `updatedAt`
  }
);

const Location =
  mongoose.models.Location || mongoose.model("Location", LocationSchema);

export default Location;
