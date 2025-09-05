// import { callAgent } from "./index";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// // This file simulates how the AWS AgentCore runtime would invoke your agent.
// // You can run it with npm start after setting up your environment variables.

const initializeMongoConnection = async () => {
  try {
    await mongoose.connect(`${process.env.MONGO_URI}`);
    console.log(" MongoDB connected successfully.");
  } catch (error: any) {
    console.log("connection error", error);
  }
};

export default initializeMongoConnection;

// async function main() {
//    await initializeMongoConnection();

// const userQuery = "Fetch some work Order and tell me their names?";
// const threadId = "test-thread-123";

// console.log(`\nInvoking agent with query: "${userQuery}"`);
// console.log(`Using thread ID: "${threadId}"\n`);

// try {
//     const agentResponse = await callAgent(userQuery, threadId);
//     console.log("-----------------------------------------");
//     console.log(`Agent Final Response: ${agentResponse}`);
//     console.log("-----------------------------------------");
// } catch (error) {
//     console.error("An error occurred:", error);
// }

// }

// main();