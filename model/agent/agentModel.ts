import mongoose from "mongoose";
const AgentMemorySchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  memoryId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const AgentMemory = mongoose.model("AgentMemory", AgentMemorySchema);
export default AgentMemory;