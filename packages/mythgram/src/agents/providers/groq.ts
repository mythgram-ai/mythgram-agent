import { OpenAICompatibleProvider } from "./base.js";

export const groqProvider = new OpenAICompatibleProvider({
  id: "groq",
  label: "Groq",
  defaultBaseUrl: "https://api.groq.com/openai/v1",
});
