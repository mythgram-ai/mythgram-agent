import { OpenAICompatibleProvider } from "./base.js";

export const deepseekProvider = new OpenAICompatibleProvider({
  id: "deepseek",
  label: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com/v1",
});
