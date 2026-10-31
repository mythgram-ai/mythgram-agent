import { OpenAICompatibleProvider } from "./base.js";

export const vercelAiGatewayProvider = new OpenAICompatibleProvider({
  id: "vercel_ai_gateway",
  label: "Vercel AI Gateway",
  defaultBaseUrl: "https://ai-gateway.vercel.sh/v1",
});
