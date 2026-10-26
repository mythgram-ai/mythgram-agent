/**
 * WhatsApp channel — PLACEHOLDER ONLY (coming soon).
 *
 * There is no WhatsApp transport yet: the dashboard renders this channel as a
 * "coming soon" card and suggests Telegram as the alternative. This module owns
 * the placeholder descriptor so the card copy lives in one place, and creating
 * a WhatsApp connection through the API is refused with a clear error.
 */

export const WHATSAPP_PLACEHOLDER = {
  kind: "whatsapp",
  label: "WhatsApp",
  comingSoon: true,
  headline: "Coming soon",
  description:
    "Chat with your agent straight from WhatsApp. This channel is not available yet — " +
    "it is on the roadmap.",
  alternative: "telegram",
  alternativeLabel: "Use Telegram instead",
} as const;
