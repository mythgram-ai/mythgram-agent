import { OpenAICompatibleProvider } from "./base.js";

export const blueclawProvider = new OpenAICompatibleProvider({
  id: "blueclaw",
  label: "Blue Claw",
  defaultBaseUrl: "https://openai.blueclaw.network/v1",
});
