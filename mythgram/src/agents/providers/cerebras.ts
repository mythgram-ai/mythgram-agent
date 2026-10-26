import { OpenAICompatibleProvider } from "./base.js";

export const cerebrasProvider = new OpenAICompatibleProvider({
  id: "cerebras",
  label: "Cerebras",
  defaultBaseUrl: "https://api.cerebras.ai/v1",
});
