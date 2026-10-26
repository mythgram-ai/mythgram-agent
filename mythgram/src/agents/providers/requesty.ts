import { OpenAICompatibleProvider } from "./base.js";

export const requestyProvider = new OpenAICompatibleProvider({
  id: "requesty",
  label: "Requesty",
  defaultBaseUrl: "https://router.requesty.ai/v1",
});
