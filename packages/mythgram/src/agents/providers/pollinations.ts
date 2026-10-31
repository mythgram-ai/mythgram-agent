import { OpenAICompatibleProvider } from "./base.js";

export const pollinationsProvider = new OpenAICompatibleProvider({
  id: "pollinations",
  label: "Pollinations AI",
  defaultBaseUrl: "https://gen.pollinations.ai/v1",
});
