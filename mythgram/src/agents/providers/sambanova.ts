import { OpenAICompatibleProvider } from "./base.js";

export const sambanovaProvider = new OpenAICompatibleProvider({
  id: "sambanova",
  label: "SambaNova",
  defaultBaseUrl: "https://api.sambanova.ai/v1",
});
