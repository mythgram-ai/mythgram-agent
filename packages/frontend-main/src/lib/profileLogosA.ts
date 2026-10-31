import type { ProfileLogo } from "./profileLogos";

/**
 * Curated profile logos, part 1: cute animals (18).
 *
 * Every logo is a self-contained 64x64 SVG (rounded-square pastel gradient
 * background + flat cute motif), ASCII-only so it can be stored as a base64
 * data URL in the profile's avatar field. Rendered through <img>, so gradient
 * ids never collide.
 */
export const PROFILE_LOGOS_A: ProfileLogo[] = [
  {
    id: "fox",
    name: "Foxy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdba74"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa1)"/><path d="M15 26 L19 11 L30 21 Z" fill="#9a3412"/><path d="M49 26 L45 11 L34 21 Z" fill="#9a3412"/><path d="M18 23 L20 15 L26 20 Z" fill="#fed7aa"/><path d="M46 23 L44 15 L38 20 Z" fill="#fed7aa"/><ellipse cx="32" cy="38" rx="16" ry="13" fill="#fff7ed"/><ellipse cx="32" cy="43" rx="8" ry="6" fill="#ffedd5"/><circle cx="25" cy="36" r="2.6" fill="#431407"/><circle cx="39" cy="36" r="2.6" fill="#431407"/><ellipse cx="20.5" cy="40" rx="2.6" ry="1.8" fill="#fda4af" opacity=".8"/><ellipse cx="43.5" cy="40" rx="2.6" ry="1.8" fill="#fda4af" opacity=".8"/><ellipse cx="32" cy="41" rx="2.4" ry="1.8" fill="#431407"/><path d="M28 46 Q32 48.5 36 46" stroke="#431407" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "cat",
    name: "Kitty",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa2)"/><path d="M17 27 L19 12 L30 21 Z" fill="#6d28d9"/><path d="M47 27 L45 12 L34 21 Z" fill="#6d28d9"/><path d="M20 24 L21 16 L27 21 Z" fill="#ddd6fe"/><path d="M44 24 L43 16 L37 21 Z" fill="#ddd6fe"/><ellipse cx="32" cy="39" rx="15" ry="12" fill="#f5f3ff"/><circle cx="26" cy="37" r="2.6" fill="#312e81"/><circle cx="38" cy="37" r="2.6" fill="#312e81"/><ellipse cx="21.5" cy="41" rx="2.4" ry="1.7" fill="#f0abfc" opacity=".9"/><ellipse cx="42.5" cy="41" rx="2.4" ry="1.7" fill="#f0abfc" opacity=".9"/><path d="M30 41 L34 41 L32 43.5 Z" fill="#ec4899"/><path d="M12 37 L19 38 M12 42 L19 41 M45 38 L52 37 M45 41 L52 42" stroke="#6d28d9" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  },
  {
    id: "bunny",
    name: "Bunbun",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbcfe8"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa3)"/><ellipse cx="24" cy="15" rx="5" ry="10" fill="#fff" transform="rotate(-10 24 15)"/><ellipse cx="40" cy="15" rx="5" ry="10" fill="#fff" transform="rotate(10 40 15)"/><ellipse cx="24" cy="15" rx="2.2" ry="6.5" fill="#f9a8d4" transform="rotate(-10 24 15)"/><ellipse cx="40" cy="15" rx="2.2" ry="6.5" fill="#f9a8d4" transform="rotate(10 40 15)"/><ellipse cx="32" cy="40" rx="15" ry="12" fill="#fff"/><circle cx="26" cy="38" r="2.6" fill="#831843"/><circle cx="38" cy="38" r="2.6" fill="#831843"/><ellipse cx="21.5" cy="42" rx="2.4" ry="1.7" fill="#f9a8d4"/><ellipse cx="42.5" cy="42" rx="2.4" ry="1.7" fill="#f9a8d4"/><ellipse cx="32" cy="41.5" rx="2" ry="1.5" fill="#ec4899"/><path d="M32 43 L32 45 M32 45 Q29.5 47 27.5 45.5 M32 45 Q34.5 47 36.5 45.5" stroke="#831843" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "panda",
    name: "Pandy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a7f3d0"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa4)"/><circle cx="18" cy="22" r="6.5" fill="#1f2937"/><circle cx="46" cy="22" r="6.5" fill="#1f2937"/><circle cx="18" cy="22" r="2.6" fill="#6b7280"/><circle cx="46" cy="22" r="2.6" fill="#6b7280"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#fff"/><ellipse cx="25" cy="37" rx="4.4" ry="5.4" fill="#1f2937" transform="rotate(-15 25 37)"/><ellipse cx="39" cy="37" rx="4.4" ry="5.4" fill="#1f2937" transform="rotate(15 39 37)"/><circle cx="25.5" cy="36.5" r="1.8" fill="#fff"/><circle cx="38.5" cy="36.5" r="1.8" fill="#fff"/><ellipse cx="32" cy="43" rx="2.4" ry="1.8" fill="#1f2937"/><path d="M28 47 Q32 49.5 36 47" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "bear",
    name: "Teddy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa5" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fcd34d"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa5)"/><circle cx="19" cy="21" r="6" fill="#b45309"/><circle cx="45" cy="21" r="6" fill="#b45309"/><circle cx="19" cy="21" r="2.8" fill="#fde68a"/><circle cx="45" cy="21" r="2.8" fill="#fde68a"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#fffbeb"/><ellipse cx="32" cy="43" rx="7.5" ry="5.5" fill="#fde68a"/><circle cx="26" cy="36" r="2.6" fill="#451a03"/><circle cx="38" cy="36" r="2.6" fill="#451a03"/><ellipse cx="32" cy="41.5" rx="2.6" ry="2" fill="#451a03"/><path d="M32 43.5 L32 45.5 M32 45.5 Q29 47.5 27 46 M32 45.5 Q35 47.5 37 46" stroke="#451a03" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "penguin",
    name: "Penny",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa6" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa6)"/><ellipse cx="32" cy="37" rx="13" ry="15" fill="#1e293b"/><ellipse cx="32" cy="42" rx="8" ry="10" fill="#fff"/><circle cx="27" cy="30" r="3.4" fill="#fff"/><circle cx="37" cy="30" r="3.4" fill="#fff"/><circle cx="27" cy="30.5" r="1.6" fill="#0f172a"/><circle cx="37" cy="30.5" r="1.6" fill="#0f172a"/><path d="M29 35 L35 35 L32 38 Z" fill="#f59e0b"/><ellipse cx="24" cy="36" rx="1.8" ry="1.2" fill="#fda4af" opacity=".9"/><ellipse cx="40" cy="36" rx="1.8" ry="1.2" fill="#fda4af" opacity=".9"/><ellipse cx="18.5" cy="40" rx="2.4" ry="5" fill="#0ea5e9"/><ellipse cx="45.5" cy="40" rx="2.4" ry="5" fill="#0ea5e9"/></svg>`,
  },
  {
    id: "owl",
    name: "Hoot",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa7" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7d2fe"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa7)"/><path d="M19 20 L16 10 L26 16 Z" fill="#312e81"/><path d="M45 20 L48 10 L38 16 Z" fill="#312e81"/><ellipse cx="32" cy="38" rx="14" ry="14" fill="#4338ca"/><ellipse cx="32" cy="43" rx="8" ry="8" fill="#818cf8"/><circle cx="26" cy="33" r="6" fill="#fff"/><circle cx="38" cy="33" r="6" fill="#fff"/><circle cx="26" cy="33.5" r="2.6" fill="#1e1b4b"/><circle cx="38" cy="33.5" r="2.6" fill="#1e1b4b"/><circle cx="27" cy="32.5" r=".9" fill="#fff"/><circle cx="39" cy="32.5" r=".9" fill="#fff"/><path d="M29 40 L35 40 L32 43 Z" fill="#fbbf24"/></svg>`,
  },
  {
    id: "frog",
    name: "Hoppy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa8" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bbf7d0"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa8)"/><circle cx="22" cy="20" r="7" fill="#16a34a"/><circle cx="42" cy="20" r="7" fill="#16a34a"/><circle cx="22" cy="20" r="4.4" fill="#fff"/><circle cx="42" cy="20" r="4.4" fill="#fff"/><circle cx="22" cy="20.5" r="2.2" fill="#052e16"/><circle cx="42" cy="20.5" r="2.2" fill="#052e16"/><ellipse cx="32" cy="40" rx="16" ry="12" fill="#4ade80"/><ellipse cx="32" cy="42" rx="10" ry="7" fill="#bbf7d0"/><path d="M22 40 Q32 49 42 40" stroke="#052e16" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="37" rx="2.4" ry="1.6" fill="#f9a8d4" opacity=".9"/><ellipse cx="44" cy="37" rx="2.4" ry="1.6" fill="#f9a8d4" opacity=".9"/></svg>`,
  },
  {
    id: "koala",
    name: "Koko",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa9" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#64748b"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa9)"/><circle cx="16" cy="25" r="8" fill="#94a3b8"/><circle cx="48" cy="25" r="8" fill="#94a3b8"/><circle cx="16" cy="25" r="4" fill="#e2e8f0"/><circle cx="48" cy="25" r="4" fill="#e2e8f0"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#cbd5e1"/><circle cx="25" cy="36" r="2.6" fill="#1e293b"/><circle cx="39" cy="36" r="2.6" fill="#1e293b"/><rect x="28" y="38" width="8" height="10" rx="4" fill="#334155"/><path d="M25 48 Q32 51 39 48" stroke="#1e293b" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "tiger",
    name: "Tiggy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa10" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fed7aa"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa10)"/><circle cx="19" cy="21" r="5.5" fill="#9a3412"/><circle cx="45" cy="21" r="5.5" fill="#9a3412"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#ffedd5"/><path d="M32 24 L32 30 M26 25 L24 30 M38 25 L40 30" stroke="#9a3412" stroke-width="2.4" stroke-linecap="round"/><path d="M18 36 L23 37 M18 41 L23 40 M46 37 L41 38 M46 42 L41 41" stroke="#9a3412" stroke-width="1.8" stroke-linecap="round"/><circle cx="26" cy="36" r="2.6" fill="#431407"/><circle cx="38" cy="36" r="2.6" fill="#431407"/><ellipse cx="32" cy="42" rx="2.6" ry="2" fill="#9a3412"/><path d="M28 46.5 Q32 48.5 36 46.5" stroke="#431407" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "lion",
    name: "Leo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa11" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa11)"/><circle cx="32" cy="34" r="20" fill="#b45309"/><circle cx="32" cy="34" r="16.5" fill="#d97706"/><ellipse cx="32" cy="38" rx="11.5" ry="10" fill="#fef3c7"/><circle cx="27.5" cy="36" r="2.4" fill="#451a03"/><circle cx="36.5" cy="36" r="2.4" fill="#451a03"/><ellipse cx="23.5" cy="40" rx="2" ry="1.4" fill="#fda4af"/><ellipse cx="40.5" cy="40" rx="2" ry="1.4" fill="#fda4af"/><ellipse cx="32" cy="40.5" rx="2.4" ry="1.8" fill="#451a03"/><path d="M28.5 44.5 Q32 46.5 35.5 44.5" stroke="#451a03" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "monkey",
    name: "Momo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa12" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#fb923c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa12)"/><circle cx="17" cy="36" r="5.5" fill="#92400e"/><circle cx="47" cy="36" r="5.5" fill="#92400e"/><circle cx="17" cy="36" r="2.4" fill="#fde68a"/><circle cx="47" cy="36" r="2.4" fill="#fde68a"/><ellipse cx="32" cy="37" rx="14" ry="13" fill="#92400e"/><ellipse cx="32" cy="38" rx="9.5" ry="9" fill="#fed7aa"/><ellipse cx="32" cy="43" rx="5.5" ry="4" fill="#ffedd5"/><circle cx="27.5" cy="34.5" r="2.4" fill="#451a03"/><circle cx="36.5" cy="34.5" r="2.4" fill="#451a03"/><ellipse cx="32" cy="41.5" rx="2" ry="1.5" fill="#451a03"/><path d="M27 46 Q32 49 37 46" stroke="#451a03" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "pig",
    name: "Piggy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa13" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fecdd3"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa13)"/><path d="M20 24 L21 13 L29 20 Z" fill="#db2777"/><path d="M44 24 L43 13 L35 20 Z" fill="#db2777"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#ffe4e6"/><circle cx="25" cy="35" r="2.6" fill="#831843"/><circle cx="39" cy="35" r="2.6" fill="#831843"/><ellipse cx="32" cy="42" rx="6.5" ry="5" fill="#f9a8d4"/><ellipse cx="29.5" cy="42" rx="1.4" ry="1.8" fill="#831843"/><ellipse cx="34.5" cy="42" rx="1.4" ry="1.8" fill="#831843"/></svg>`,
  },
  {
    id: "chick",
    name: "Chirpy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa14" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#facc15"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa14)"/><path d="M28 12 Q30 7 33 10 Q35 6 37 11" stroke="#eab308" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="38" rx="14" ry="13" fill="#fefce8"/><ellipse cx="18.5" cy="40" rx="3.4" ry="6" fill="#fde047"/><ellipse cx="45.5" cy="40" rx="3.4" ry="6" fill="#fde047"/><path d="M23 35 Q25 33 27 35 M37 35 Q39 33 41 35" stroke="#713f12" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="21" cy="39.5" rx="2" ry="1.4" fill="#fda4af"/><ellipse cx="43" cy="39.5" rx="2" ry="1.4" fill="#fda4af"/><path d="M29 39 L35 39 L32 42.5 Z" fill="#f97316"/></svg>`,
  },
  {
    id: "whale",
    name: "Wally",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa15" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa15)"/><path d="M32 12 L32 20 M27 13 L29 19 M37 13 L35 19" stroke="#075985" stroke-width="2.2" stroke-linecap="round"/><circle cx="32" cy="10" r="1.8" fill="#075985"/><ellipse cx="32" cy="40" rx="17" ry="11" fill="#0369a1"/><path d="M16 38 Q22 30 32 30 Q42 30 48 38 Q42 34 32 34 Q22 34 16 38 Z" fill="#075985"/><ellipse cx="32" cy="45" rx="10" ry="5" fill="#e0f2fe"/><circle cx="24" cy="39" r="2.4" fill="#082f49"/><path d="M19 43 Q22 45 25 43.5" stroke="#082f49" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M46 34 L52 28 L50 36 Z" fill="#0369a1"/></svg>`,
  },
  {
    id: "octopus",
    name: "Octo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa16" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fecaca"/><stop offset="1" stop-color="#fb7185"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa16)"/><circle cx="20" cy="50" r="3.4" fill="#e11d48"/><circle cx="27" cy="51.5" r="3.4" fill="#e11d48"/><circle cx="34" cy="51.5" r="3.4" fill="#e11d48"/><circle cx="41" cy="51.5" r="3.4" fill="#e11d48"/><circle cx="32" cy="33" r="14" fill="#fb7185"/><rect x="18" y="38" width="28" height="12" rx="6" fill="#fb7185"/><circle cx="26" cy="32" r="2.6" fill="#4c0519"/><circle cx="38" cy="32" r="2.6" fill="#4c0519"/><ellipse cx="22" cy="37" rx="2.2" ry="1.5" fill="#fecdd3"/><ellipse cx="42" cy="37" rx="2.2" ry="1.5" fill="#fecdd3"/><path d="M28 38 Q32 41 36 38" stroke="#4c0519" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="24" cy="24" r="1.6" fill="#fecdd3" opacity=".8"/><circle cx="40" cy="22" r="1.2" fill="#fecdd3" opacity=".8"/></svg>`,
  },
  {
    id: "bee",
    name: "Buzzy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa17" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#fbbf24"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa17)"/><ellipse cx="23" cy="20" rx="6" ry="8" fill="#fff" opacity=".85" transform="rotate(-20 23 20)"/><ellipse cx="41" cy="20" rx="6" ry="8" fill="#fff" opacity=".85" transform="rotate(20 41 20)"/><path d="M26 16 Q24 12 21 11 M38 16 Q40 12 43 11" stroke="#713f12" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="39" rx="13" ry="12" fill="#facc15"/><path d="M20.5 35 Q32 38 43.5 35 L43.5 39 Q32 42 20.5 39 Z" fill="#713f12"/><path d="M21.5 43 Q32 46 42.5 43 L42 47 Q32 50 22 47 Z" fill="#713f12"/><circle cx="27" cy="31" r="2.4" fill="#451a03"/><circle cx="37" cy="31" r="2.4" fill="#451a03"/><path d="M28.5 36.5 Q32 39 35.5 36.5" stroke="#451a03" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "butterfly",
    name: "Flutter",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pa18" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ddd6fe"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pa18)"/><ellipse cx="21" cy="27" rx="8" ry="10" fill="#f9a8d4" transform="rotate(-20 21 27)"/><ellipse cx="43" cy="27" rx="8" ry="10" fill="#f9a8d4" transform="rotate(20 43 27)"/><ellipse cx="23" cy="44" rx="6" ry="7" fill="#f472b6" transform="rotate(-15 23 44)"/><ellipse cx="41" cy="44" rx="6" ry="7" fill="#f472b6" transform="rotate(15 41 44)"/><circle cx="21" cy="26" r="2.4" fill="#fff" opacity=".9"/><circle cx="43" cy="26" r="2.4" fill="#fff" opacity=".9"/><rect x="29" y="20" width="6" height="26" rx="3" fill="#4c1d95"/><path d="M30 20 Q28 15 25 14 M34 20 Q36 15 39 14" stroke="#4c1d95" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="30" cy="30" r="1.6" fill="#fff"/><circle cx="34" cy="30" r="1.6" fill="#fff"/></svg>`,
  },
];
