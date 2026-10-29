export * from "./types.js";
export {
  SlidesManager,
  SlidesEngineError,
  normalizeSlides,
  toProjectSummary,
  toTemplateSummary,
  MAX_SLIDES_PER_PROJECT,
  MAX_SLIDE_HTML_BYTES,
  MAX_SLIDE_PROJECT_NAME,
  MAX_SLIDE_PROJECT_DESCRIPTION,
  type SlidesStore,
} from "./engine.js";
export {
  SlidesTemplateChoiceStore,
  type SlidesTemplateChoiceDecision,
  type SlidesTemplateChoiceResult,
  type SlidesTemplateChoiceOptions,
} from "./choiceStore.js";
export {
  createSlidesRuntime,
  slidesFailure,
  SLIDES_TEMPLATE_CHOICE_TIMEOUT_MS,
  SLIDES_TEMPLATE_CHOICE_TIMEOUT_MESSAGE,
  SLIDES_TEMPLATE_CHOICE_CHANNEL_UNAVAILABLE,
  type SlidesRuntime,
} from "./runtime.js";
export { DEFAULT_SLIDE_TEMPLATES } from "./defaultTemplates.js";