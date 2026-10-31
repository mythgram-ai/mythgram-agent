import { OpenAICompatibleProvider } from "./base.js";

export const unorouterProvider = new OpenAICompatibleProvider({
  id: "unorouter",
  label: "UnoRouter",
  defaultBaseUrl: "https://api.unorouter.com/v1",
});
