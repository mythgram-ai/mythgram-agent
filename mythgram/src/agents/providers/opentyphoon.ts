import { OpenAICompatibleProvider } from "./base.js";

export const opentyphoonProvider = new OpenAICompatibleProvider({
  id: "opentyphoon",
  label: "OpenTyphoon",
  defaultBaseUrl: "https://api.opentyphoon.ai/v1",
});
