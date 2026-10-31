import { OpenAICompatibleProvider } from "./base.js";

export const sarvamProvider = new OpenAICompatibleProvider({
  id: "sarvam",
  label: "Sarvam AI",
  defaultBaseUrl: "https://api.sarvam.ai/v1",
});
