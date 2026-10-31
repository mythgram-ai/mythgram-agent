import { OpenAICompatibleProvider } from "./base.js";

export const sealionProvider = new OpenAICompatibleProvider({
  id: "sealion",
  label: "SEA-LION",
  defaultBaseUrl: "https://api.sea-lion.ai/v1",
});
