import { OpenAICompatibleProvider } from "./base.js";

export const kiloCodeProvider = new OpenAICompatibleProvider({
  id: "kilo_code",
  label: "Kilo Code",
  defaultBaseUrl: "https://api.kilo.ai/api/gateway",
});
