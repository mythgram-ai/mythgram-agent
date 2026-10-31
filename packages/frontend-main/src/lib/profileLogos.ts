import { PROFILE_LOGOS_A } from "./profileLogosA";
import { PROFILE_LOGOS_B } from "./profileLogosB";
import { PROFILE_LOGOS_C } from "./profileLogosC";
import { PROFILE_LOGOS_D } from "./profileLogosD";

/**
 * Curated profile logo gallery.
 *
 * Cute, professional, high-quality SVG logos — animals plus faces & bots only.
 * Every logo is a self-contained ASCII-only 64x64 SVG so it can be stored as a
 * base64 data URL directly in the profile's `avatar` field — no new storage, no
 * new endpoints, and the existing avatar validation already accepts the format.
 * Rendered through <img>, so gradient ids never collide.
 */

/** One curated logo: a stable id, a display name, a gallery category, and its SVG. */
export interface ProfileLogo {
  /** Stable identifier, e.g. "fox". */
  id: string;
  /** Display name shown under the preview, e.g. "Foxy". */
  name: string;
  /** Gallery grouping, e.g. "Animals". */
  category: string;
  /** Self-contained SVG markup (64x64, ASCII-only). */
  svg: string;
}

/** The full curated gallery (animals + faces & bots). A logo is required per profile. */
export const PROFILE_LOGOS: ProfileLogo[] = [
  ...PROFILE_LOGOS_A,
  ...PROFILE_LOGOS_B,
  ...PROFILE_LOGOS_C,
  ...PROFILE_LOGOS_D,
];

/** Gallery categories in display order. */
export const PROFILE_LOGO_CATEGORIES: string[] = Array.from(
  new Set(PROFILE_LOGOS.map((logo) => logo.category)),
);

/** The logo automatically assigned to the built-in default profile. */
export const DEFAULT_PROFILE_LOGO_ID = "fox";

/** Look up a curated logo by id. */
export function profileLogoById(id: string): ProfileLogo | undefined {
  return PROFILE_LOGOS.find((logo) => logo.id === id);
}

/**
 * Encode an SVG as a base64 data URL for the profile `avatar` field. Works in the
 * browser and in Node (tests). Gallery SVGs are ASCII-only, so plain base64 applies.
 */
export function profileLogoDataUrl(svg: string): string {
  const raw = svg.trim();
  if (typeof btoa === "function") return `data:image/svg+xml;base64,${btoa(raw)}`;
  // Node fallback (no DOM): Buffer is always available there.
  const buffer = (globalThis as unknown as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer;
  if (buffer) return `data:image/svg+xml;base64,${buffer.from(raw, "utf8").toString("base64")}`;
  return `data:image/svg+xml,${encodeURIComponent(raw)}`;
}

/** The avatar data URL automatically routed to the built-in default profile. */
export function defaultProfileAvatar(): string {
  const logo = profileLogoById(DEFAULT_PROFILE_LOGO_ID) ?? PROFILE_LOGOS[0];
  return logo ? profileLogoDataUrl(logo.svg) : "";
}
