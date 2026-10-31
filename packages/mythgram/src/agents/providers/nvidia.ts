import { OpenAICompatibleProvider } from "./base.js";

export const nvidiaProvider = new OpenAICompatibleProvider({
  id: "nvidia",
  label: "NVIDIA NIM",
  defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
});
