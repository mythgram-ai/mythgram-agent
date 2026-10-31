import { OpenAICompatibleProvider } from "./base.js";

export const inceptionlabsProvider = new OpenAICompatibleProvider({
  id: "inceptionlabs",
  label: "Inception Labs",
  defaultBaseUrl: "https://api.inceptionlabs.ai/v1",
});
