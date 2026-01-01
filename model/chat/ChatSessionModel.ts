import mongoose, { ObjectId, Schema } from "mongoose";

export interface IChatSession extends Document {
  chatId: ObjectId;
  summary: string;            // compressed context
  title: string;          // logical session id
  messageCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSessionSchema = new Schema<IChatSession>(
    {
        chatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Chat",
            required: true,
            index: true,
        },
        title: {
            type: String,
        },
        summary: {
            type: String,
            required: false,
            default: "",
        },
        messageCount: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: true },
    }
);
const ChatSession = mongoose.models.ChatSession || mongoose.model<IChatSession>("ChatSession", ChatSessionSchema);
export default ChatSession;
