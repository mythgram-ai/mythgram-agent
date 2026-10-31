import { OpenAICompatibleProvider } from "./base.js";

export const zenmuxProvider = new OpenAICompatibleProvider({
  id: "zenmux",
  label: "ZenMux",
  defaultBaseUrl: "https://zenmux.ai/api/v1",
});
