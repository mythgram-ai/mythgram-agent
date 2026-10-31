import { OpenAICompatibleProvider } from "./base.js";

export const zaiProvider = new OpenAICompatibleProvider({
  id: "z_ai",
  label: "Z.ai (Zhipu AI)",
  defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4/",
});
