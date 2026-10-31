import { OpenAICompatibleProvider } from "./base.js";

export const airforceProvider = new OpenAICompatibleProvider({
  id: "airforce",
  label: "Airforce AI",
  defaultBaseUrl: "https://api.airforce/v1",
});
