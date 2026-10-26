import { OpenAICompatibleProvider } from "./base.js";

export const mistralProvider = new OpenAICompatibleProvider({
  id: "mistral",
  label: "Mistral AI",
  defaultBaseUrl: "https://api.mistral.ai/v1",
});
