import express from "express";
import dotenv from "dotenv";
import path from "path";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

dotenv.config();
const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

// ------------------- 1. Setup the model -------------------
const model = new ChatGoogleGenerativeAI({
    model: "models/gemini-2.5-flash",
    maxOutputTokens: 2048,
    temperature: 0.7,
    apiKey: process.env.GOOGLE_API_KEY,
});

// ------------------- 2. Create tools -------------------

// Menu tool
const getMenuTool = new DynamicStructuredTool({
    name: "getMenu",
    description:
        "Returns today's menu for the given category (breakfast, lunch or dinner). Use this tool to directly answer user menu questions.",
    schema: z.object({
        category: z.string().describe("Type of food. Example: breakfast, lunch, dinner"),
    }),
    func: async ({ category }) => {
        const menus = {
            breakfast: "Aloo Paratha, Poha, Masala Chai",
            lunch: "Dal Tadka, Rice, Roti, Salad",
            dinner: "Paneer Butter Masala, Naan, Jeera Rice",
        };
        return menus[category.toLowerCase()] || "No menu available for this category";
    },
});

// General query tool (fallback to LLM)
const generalQueryTool = new DynamicStructuredTool({
    name: "generalQuery",
    description: "Use this tool for any question not related to menus.",
    schema: z.object({
        question: z.string().describe("User's general question"),
    }),
    func: async ({ question }) => {
        const response = await model.call([{ role: "user", content: question }]);
        return response.text;
    },
});

// ------------------- 3. Setup agent -------------------
const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant."],
    ["human", "{input}"],
    ["ai", "{agent_scratchpad}"],
]);



const agent = await createToolCallingAgent({
    llm: model,
    tools: [getMenuTool],
    prompt,
});

const executor = new AgentExecutor({
    agent,
    tools: [getMenuTool],
    verbose: true,
    maxIterations: 2,
    returnIntermediateSteps: true
});

// ------------------- 4. API route -------------------
app.post("/api/chat", async (req, res) => {
    // 1. Get user input from request body, default to "Hello!" if empty
    const userInput = req.body.input || "Hello!";

    try {
        // 2. Call the agent executor with user input
        // executor.invoke() runs the agent, which may call tools and/or LLM
        const response = await executor.invoke({ input: userInput });
        console.log("Agent Full Response: ", response);

        // 3. Check if the agent actually used any tool
        const toolUsed = response?.intermediateSteps?.length > 0;

        // 4. Case 1: Agent used tool and produced final output successfully
        if (toolUsed && response.output && response.output !== "Agent stopped due to max iterations.") {
            // Send the agent's final output as JSON response
            return res.json({ output: response.output });
        }

        // 5. Case 2: Agent reached maxIterations but did use a tool
        else if (toolUsed && response.output && response.output === "Agent stopped due to max iterations.") {
            // Extract the tool's observation from first intermediate step
            const data = response.intermediateSteps[0].observation;
            // Return the tool observation as response
            return res.json({ output: data });
        }

        // 6. Case 3: Agent did not produce any useful output
        // Fallback to calling the LLM directly
        const fallbackResponse = await model.call([{ role: "user", content: userInput }]);
        console.log("MODELLLLLLLLLLLLLLL_________")
         console.log(fallbackResponse);
        return res.json({ output: fallbackResponse.text });

    } catch (err) {
        // 7. Error handling: log error and send 500 server response
        console.error(err);
        return res.status(500).json({ output: "Server error occurred." });
    }
});



// ------------------- 5. Default route -------------------
const __dirname = path.resolve();
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------- 6. Start server -------------------
app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
});
