import { OpenAICompatibleProvider } from "./base.js";

export const chutesProvider = new OpenAICompatibleProvider({
  id: "chutes",
  label: "Chutes",
  defaultBaseUrl: "https://llm.chutes.ai/v1",
});
