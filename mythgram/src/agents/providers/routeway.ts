import { OpenAICompatibleProvider } from "./base.js";

export const routewayProvider = new OpenAICompatibleProvider({
  id: "routeway",
  label: "Routeway",
  defaultBaseUrl: "https://api.routeway.ai/v1",
});
