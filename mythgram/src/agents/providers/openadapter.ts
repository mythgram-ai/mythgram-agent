import { OpenAICompatibleProvider } from "./base.js";

export const openadapterProvider = new OpenAICompatibleProvider({
  id: "openadapter",
  label: "OpenAdapter",
  defaultBaseUrl: "https://api.openadapter.in/v1",
});
