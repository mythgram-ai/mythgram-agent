import { OpenAICompatibleProvider } from "./base.js";

export const aihubmixProvider = new OpenAICompatibleProvider({
  id: "aihubmix",
  label: "AIHubMix",
  defaultBaseUrl: "https://api.aihubmix.com/v1",
});
