import { OpenAICompatibleProvider } from "./base.js";

export const huggingfaceProvider = new OpenAICompatibleProvider({
  id: "huggingface",
  label: "Hugging Face",
  defaultBaseUrl: "https://router.huggingface.co/v1",
});
