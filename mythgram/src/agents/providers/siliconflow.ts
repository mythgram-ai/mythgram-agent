import { OpenAICompatibleProvider } from "./base.js";

export const siliconflowProvider = new OpenAICompatibleProvider({
  id: "siliconflow",
  label: "SiliconFlow",
  defaultBaseUrl: "https://api.siliconflow.com/v1",
});
