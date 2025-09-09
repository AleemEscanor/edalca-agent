// models/user/UserModel.ts
import mongoose, { Document, Model, Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    firstName: { type: String },
    lastName: { type: String },
    role: { type: String },
    password: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    status: { type: String, default: "active" },
    profileImage: { type: String, default: null },
    phoneNumber: { type: String },
    assignedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
