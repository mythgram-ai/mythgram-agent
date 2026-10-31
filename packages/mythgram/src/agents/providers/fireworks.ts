import { OpenAICompatibleProvider } from "./base.js";

export const fireworksProvider = new OpenAICompatibleProvider({
  id: "fireworks",
  label: "Fireworks AI",
  defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
});
