import type { ProfileLogo } from "./profileLogos";

/**
 * Curated profile logos, part 3: more cute animals (30).
 * Same format as profileLogosA — self-contained ASCII-only 64x64 SVGs.
 */
export const PROFILE_LOGOS_C: ProfileLogo[] = [
  {
    id: "puppy",
    name: "Biscuit",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc1)"/><ellipse cx="16" cy="30" rx="5" ry="9" fill="#92400e" transform="rotate(15 16 30)"/><ellipse cx="48" cy="30" rx="5" ry="9" fill="#92400e" transform="rotate(-15 48 30)"/><ellipse cx="32" cy="38" rx="15" ry="13" fill="#fcd9a8"/><ellipse cx="26" cy="30" rx="4.5" ry="5" fill="#fff" opacity=".55"/><circle cx="26" cy="35" r="2.6" fill="#451a03"/><circle cx="38" cy="35" r="2.6" fill="#451a03"/><ellipse cx="32" cy="41" rx="3" ry="2.2" fill="#451a03"/><path d="M32 43 L32 45 M28 47 Q32 49.5 36 47" stroke="#451a03" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M32 45 L28.5 52 L35.5 52 Z" fill="#fda4af"/><ellipse cx="21" cy="39" rx="2.4" ry="1.6" fill="#fda4af" opacity=".8"/><ellipse cx="43" cy="39" rx="2.4" ry="1.6" fill="#fda4af" opacity=".8"/></svg>`,
  },
  {
    id: "raccoon",
    name: "Bandit",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#475569"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc2)"/><path d="M18 24 L20 12 L29 20 Z" fill="#334155"/><path d="M46 24 L44 12 L35 20 Z" fill="#334155"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#cbd5e1"/><rect x="18" y="31" width="28" height="11" rx="5.5" fill="#334155"/><ellipse cx="25.5" cy="36.5" rx="3" ry="3.4" fill="#fff"/><ellipse cx="38.5" cy="36.5" rx="3" ry="3.4" fill="#fff"/><circle cx="25.5" cy="37" r="1.7" fill="#0f172a"/><circle cx="38.5" cy="37" r="1.7" fill="#0f172a"/><ellipse cx="32" cy="44" rx="2.6" ry="2" fill="#0f172a"/><path d="M28.5 48 Q32 50 35.5 48" stroke="#0f172a" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "red-panda",
    name: "Rusty",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fecaca"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc3)"/><circle cx="19" cy="20" r="6" fill="#fff7ed"/><circle cx="45" cy="20" r="6" fill="#fff7ed"/><circle cx="19" cy="20" r="2.8" fill="#fed7aa"/><circle cx="45" cy="20" r="2.8" fill="#fed7aa"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#c2410c"/><ellipse cx="32" cy="42" rx="9" ry="7.5" fill="#fff7ed"/><ellipse cx="24" cy="34" rx="3.6" ry="2.6" fill="#fff7ed"/><ellipse cx="40" cy="34" rx="3.6" ry="2.6" fill="#fff7ed"/><circle cx="25.5" cy="35" r="2.2" fill="#431407"/><circle cx="38.5" cy="35" r="2.2" fill="#431407"/><ellipse cx="32" cy="41" rx="2.2" ry="1.7" fill="#431407"/><path d="M28.5 45.5 Q32 47.5 35.5 45.5" stroke="#431407" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "husky",
    name: "Blizzard",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc4)"/><path d="M18 25 L20 11 L30 20 Z" fill="#334155"/><path d="M46 25 L44 11 L34 20 Z" fill="#334155"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#f1f5f9"/><path d="M20 32 Q24 28 28 31 Q26 36 22 36 Q19 35 20 32 Z" fill="#64748b"/><path d="M44 32 Q40 28 36 31 Q38 36 42 36 Q45 35 44 32 Z" fill="#64748b"/><circle cx="26" cy="35.5" r="2.6" fill="#0ea5e9"/><circle cx="38" cy="35.5" r="2.6" fill="#0ea5e9"/><circle cx="26" cy="35.5" r="1" fill="#082f49"/><circle cx="38" cy="35.5" r="1" fill="#082f49"/><ellipse cx="32" cy="42" rx="2.6" ry="2" fill="#0f172a"/><path d="M28.5 46 Q32 48 35.5 46" stroke="#0f172a" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "sheep",
    name: "Woolly",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc5" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e7e5e4"/><stop offset="1" stop-color="#a8a29e"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc5)"/><circle cx="22" cy="22" r="7" fill="#fff"/><circle cx="32" cy="17" r="8" fill="#fff"/><circle cx="42" cy="22" r="7" fill="#fff"/><circle cx="17" cy="32" r="6" fill="#fff"/><circle cx="47" cy="32" r="6" fill="#fff"/><ellipse cx="32" cy="39" rx="11" ry="10" fill="#44403c"/><circle cx="28" cy="37" r="2.2" fill="#fff"/><circle cx="36" cy="37" r="2.2" fill="#fff"/><circle cx="28" cy="37.2" r="1" fill="#1c1917"/><circle cx="36" cy="37.2" r="1" fill="#1c1917"/><ellipse cx="32" cy="42" rx="1.8" ry="1.4" fill="#fda4af"/><path d="M29 45 Q32 46.5 35 45" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "cow",
    name: "MooMoo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc6" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f5f4"/><stop offset="1" stop-color="#d6d3d1"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc6)"/><path d="M20 16 L17 9 L24 12 Z" fill="#d6d3d1"/><path d="M44 16 L47 9 L40 12 Z" fill="#d6d3d1"/><ellipse cx="32" cy="37" rx="15" ry="14" fill="#fff"/><ellipse cx="24" cy="28" rx="4.5" ry="3.5" fill="#44403c" transform="rotate(-20 24 28)"/><ellipse cx="43" cy="32" rx="3.4" ry="2.6" fill="#44403c" transform="rotate(15 43 32)"/><ellipse cx="32" cy="43" rx="8" ry="6" fill="#fecdd3"/><ellipse cx="29" cy="43" rx="1.3" ry="1.7" fill="#881337"/><ellipse cx="35" cy="43" rx="1.3" ry="1.7" fill="#881337"/><circle cx="25.5" cy="35" r="2.4" fill="#1c1917"/><circle cx="38.5" cy="35" r="2.4" fill="#1c1917"/><path d="M28 38.5 Q32 41 36 38.5" stroke="#1c1917" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "giraffe",
    name: "Stretch",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc7" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef9c3"/><stop offset="1" stop-color="#eab308"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc7)"/><path d="M26 16 L25 9 M38 16 L39 9" stroke="#92400e" stroke-width="2.2" stroke-linecap="round"/><circle cx="25" cy="8" r="2.4" fill="#92400e"/><circle cx="39" cy="8" r="2.4" fill="#92400e"/><ellipse cx="18" cy="30" rx="4.5" ry="6" fill="#eab308" transform="rotate(-20 18 30)"/><ellipse cx="46" cy="30" rx="4.5" ry="6" fill="#eab308" transform="rotate(20 46 30)"/><ellipse cx="32" cy="37" rx="14" ry="14" fill="#fde047"/><ellipse cx="27" cy="28" rx="2.6" ry="3.2" fill="#b45309"/><ellipse cx="38" cy="33" rx="2.2" ry="2.8" fill="#b45309"/><ellipse cx="33" cy="44" rx="2" ry="2.4" fill="#b45309"/><circle cx="26.5" cy="35" r="2.4" fill="#451a03"/><circle cx="37.5" cy="35" r="2.4" fill="#451a03"/><ellipse cx="32" cy="42" rx="4.5" ry="3.2" fill="#fef9c3"/><ellipse cx="32" cy="41" rx="1.8" ry="1.3" fill="#92400e"/><path d="M28.5 45 Q32 47 35.5 45" stroke="#451a03" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "elephant",
    name: "Ellie",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc8" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0e7ff"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc8)"/><ellipse cx="15" cy="34" rx="6" ry="10" fill="#a5b4fc"/><ellipse cx="49" cy="34" rx="6" ry="10" fill="#a5b4fc"/><ellipse cx="15" cy="34" rx="3" ry="6" fill="#c7d2fe"/><ellipse cx="49" cy="34" rx="3" ry="6" fill="#c7d2fe"/><ellipse cx="32" cy="33" rx="14" ry="13" fill="#a5b4fc"/><path d="M28 38 C28 44 28 48 32 50 C36 48 36 44 36 38 L32 40 Z" fill="#93a4f5"/><path d="M28 38 C28 44 28 48 32 50 C36 48 36 44 36 38" stroke="#6366f1" stroke-width="1.6" fill="none"/><circle cx="26" cy="30" r="2.4" fill="#1e1b4b"/><circle cx="38" cy="30" r="2.4" fill="#1e1b4b"/><ellipse cx="21.5" cy="34" rx="2" ry="1.4" fill="#f0abfc"/><ellipse cx="42.5" cy="34" rx="2" ry="1.4" fill="#f0abfc"/><path d="M25 25 Q27 23 29 24.5" stroke="#6366f1" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "hippo",
    name: "Bubbles",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc9" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cffafe"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc9)"/><circle cx="24" cy="22" r="3.4" fill="#a5b4fc"/><circle cx="40" cy="22" r="3.4" fill="#a5b4fc"/><ellipse cx="32" cy="38" rx="17" ry="13" fill="#a5b4fc"/><ellipse cx="32" cy="42" rx="11" ry="7.5" fill="#c7d2fe"/><ellipse cx="27" cy="41.5" rx="1.8" ry="2.2" fill="#312e81"/><ellipse cx="37" cy="41.5" rx="1.8" ry="2.2" fill="#312e81"/><circle cx="24.5" cy="31" r="2.4" fill="#1e1b4b"/><circle cx="39.5" cy="31" r="2.4" fill="#1e1b4b"/><circle cx="25.3" cy="30.2" r=".8" fill="#fff"/><circle cx="40.3" cy="30.2" r=".8" fill="#fff"/><path d="M27 36.5 Q32 39 37 36.5" stroke="#1e1b4b" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "sloth",
    name: "SloMo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc10" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d3d1"/><stop offset="1" stop-color="#78716c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc10)"/><ellipse cx="32" cy="36" rx="15" ry="14" fill="#a8a29e"/><ellipse cx="32" cy="37" rx="10" ry="10" fill="#e7e5e4"/><path d="M22 32 L28 35 L23 39 Z" fill="#57534e"/><path d="M42 32 L36 35 L41 39 Z" fill="#57534e"/><circle cx="25.5" cy="35.5" r="2" fill="#1c1917"/><circle cx="38.5" cy="35.5" r="2" fill="#1c1917"/><ellipse cx="32" cy="41" rx="1.8" ry="1.4" fill="#57534e"/><path d="M28.5 44.5 Q32 46.5 35.5 44.5" stroke="#1c1917" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M20 16 L24 22 L18 24 Z" fill="#87a96b"/><path d="M44 16 L40 22 L46 24 Z" fill="#87a96b"/></svg>`,
  },
  {
    id: "hedgehog",
    name: "Prickles",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc11" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc11)"/><path d="M14 40 L18 28 L22 36 L26 24 L30 33 L34 22 L38 32 L42 23 L45 33 L50 28 L48 42 Z" fill="#78350f"/><ellipse cx="32" cy="42" rx="12" ry="9" fill="#fde68a"/><circle cx="27" cy="40" r="2.2" fill="#451a03"/><circle cx="37" cy="40" r="2.2" fill="#451a03"/><ellipse cx="32" cy="44" rx="1.8" ry="1.4" fill="#451a03"/><ellipse cx="24" cy="43.5" rx="1.8" ry="1.2" fill="#fda4af"/><ellipse cx="40" cy="43.5" rx="1.8" ry="1.2" fill="#fda4af"/><path d="M29 46.5 Q32 48 35 46.5" stroke="#451a03" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "squirrel",
    name: "Nutty",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc12" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffedd5"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc12)"/><path d="M46 50 C52 44 54 34 50 26 C48 32 46 34 44 34 C48 40 48 46 46 50 Z" fill="#9a3412"/><path d="M20 22 L18 10 L28 17 Z" fill="#9a3412"/><path d="M44 22 L46 10 L36 17 Z" fill="#9a3412"/><ellipse cx="32" cy="39" rx="13" ry="12" fill="#fdba74"/><circle cx="26.5" cy="36" r="2.4" fill="#431407"/><circle cx="37.5" cy="36" r="2.4" fill="#431407"/><rect x="29.5" y="41" width="5" height="6" rx="1.5" fill="#fff"/><path d="M32 41 L32 44" stroke="#431407" stroke-width="1.4"/><ellipse cx="22" cy="40" rx="2" ry="1.4" fill="#fda4af"/><ellipse cx="42" cy="40" rx="2" ry="1.4" fill="#fda4af"/><ellipse cx="32" cy="51" rx="4.5" ry="3.5" fill="#92400e"/><path d="M32 48.5 L32 47" stroke="#451a03" stroke-width="1.6"/></svg>`,
  },
  {
    id: "hamster",
    name: "Cheeks",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc13" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fce7f3"/><stop offset="1" stop-color="#f9a8d4"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc13)"/><circle cx="21" cy="22" r="5" fill="#fbcfe8"/><circle cx="43" cy="22" r="5" fill="#fbcfe8"/><circle cx="21" cy="22" r="2.2" fill="#f472b6"/><circle cx="43" cy="22" r="2.2" fill="#f472b6"/><ellipse cx="32" cy="39" rx="15" ry="13" fill="#fdf2f8"/><ellipse cx="23" cy="42" rx="5" ry="4.4" fill="#f9a8d4"/><ellipse cx="41" cy="42" rx="5" ry="4.4" fill="#f9a8d4"/><circle cx="26.5" cy="34" r="2.4" fill="#500f28"/><circle cx="37.5" cy="34" r="2.4" fill="#500f28"/><rect x="29.5" y="38.5" width="5" height="4.5" rx="1.5" fill="#fff"/><path d="M32 38.5 L32 40.5" stroke="#500f28" stroke-width="1.4"/></svg>`,
  },
  {
    id: "mouse",
    name: "Squeak",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc14" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#94a3b8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc14)"/><circle cx="18" cy="22" r="8" fill="#94a3b8"/><circle cx="46" cy="22" r="8" fill="#94a3b8"/><circle cx="18" cy="22" r="4" fill="#fecdd3"/><circle cx="46" cy="22" r="4" fill="#fecdd3"/><ellipse cx="32" cy="40" rx="13" ry="11" fill="#cbd5e1"/><circle cx="26.5" cy="37" r="2.4" fill="#0f172a"/><circle cx="37.5" cy="37" r="2.4" fill="#0f172a"/><ellipse cx="32" cy="41.5" rx="2" ry="1.5" fill="#f472b6"/><path d="M12 38 L21 39.5 M12 43 L21 42 M43 39.5 L52 38 M43 42 L52 43" stroke="#64748b" stroke-width="1.3" stroke-linecap="round"/><path d="M44 18 Q50 14 52 8" stroke="#94a3b8" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "bat",
    name: "Echo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc15" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ddd6fe"/><stop offset="1" stop-color="#4c1d95"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc15)"/><path d="M18 44 C10 44 8 36 10 30 C13 34 15 34 17 30 C19 36 22 38 24 40 Z" fill="#2e1065"/><path d="M46 44 C54 44 56 36 54 30 C51 34 49 34 47 30 C45 36 42 38 40 40 Z" fill="#2e1065"/><path d="M20 22 L18 8 L28 16 Z" fill="#4c1d95"/><path d="M44 22 L46 8 L36 16 Z" fill="#4c1d95"/><ellipse cx="32" cy="37" rx="12" ry="12" fill="#5b21b6"/><circle cx="27" cy="35" r="2.4" fill="#fff"/><circle cx="37" cy="35" r="2.4" fill="#fff"/><circle cx="27" cy="35.3" r="1.1" fill="#2e1065"/><circle cx="37" cy="35.3" r="1.1" fill="#2e1065"/><path d="M28 41 L30 44 L32 41 L34 44 L36 41" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    id: "duck",
    name: "Ducky",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc16" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc16)"/><path d="M27 12 Q29 7 32 10 Q34 6 36 12" stroke="#eab308" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="37" rx="14" ry="13" fill="#fde047"/><path d="M14 40 Q18 34 24 36 Q20 38 19 42 Q16 42 14 40 Z" fill="#facc15"/><circle cx="25.5" cy="33" r="2.6" fill="#713f12"/><circle cx="38.5" cy="33" r="2.6" fill="#713f12"/><circle cx="26.3" cy="32.2" r=".9" fill="#fff"/><circle cx="39.3" cy="32.2" r=".9" fill="#fff"/><ellipse cx="32" cy="38.5" rx="6" ry="3.6" fill="#fb923c"/><path d="M26 38.5 L38 38.5" stroke="#c2410c" stroke-width="1.4"/><ellipse cx="22" cy="37.5" rx="2" ry="1.3" fill="#fdba74"/><ellipse cx="42" cy="37.5" rx="2" ry="1.3" fill="#fdba74"/></svg>`,
  },
  {
    id: "flamingo",
    name: "Pinky",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc17" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fce7f3"/><stop offset="1" stop-color="#f9a8d4"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc17)"/><path d="M32 50 C32 44 32 40 32 36" stroke="#db2777" stroke-width="2.6" stroke-linecap="round"/><circle cx="32" cy="28" r="11" fill="#f9a8d4"/><path d="M32 28 L46 32 L44 36 L32 34 Z" fill="#fff"/><path d="M44 32 L46 32 L45 35.5 L43 36 Z" fill="#1f2937"/><circle cx="28" cy="25" r="2.6" fill="#1f2937"/><circle cx="28.8" cy="24.2" r=".9" fill="#fff"/><path d="M20 22 L24 18 M24 20 L28 15" stroke="#db2777" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="36" cy="31" rx="2" ry="1.3" fill="#fda4af"/></svg>`,
  },
  {
    id: "parrot",
    name: "Polly",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc18" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcfce7"/><stop offset="1" stop-color="#16a34a"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc18)"/><path d="M26 14 L28 6 L31 13 Z" fill="#fbbf24"/><path d="M32 14 L34 5 L37 13 Z" fill="#f87171"/><ellipse cx="32" cy="36" rx="14" ry="14" fill="#22c55e"/><circle cx="32" cy="32" r="8.5" fill="#fff"/><circle cx="28" cy="31" r="2.6" fill="#052e16"/><circle cx="36" cy="31" r="2.6" fill="#052e16"/><path d="M28 38 C28 42 30 44 32 44 C34 44 36 42 36 38 C34 39.5 30 39.5 28 38 Z" fill="#f59e0b"/><path d="M28 38 C30 39.5 34 39.5 36 38" stroke="#92400e" stroke-width="1.4" fill="none"/><ellipse cx="22" cy="36" rx="2" ry="1.4" fill="#86efac"/><ellipse cx="42" cy="36" rx="2" ry="1.4" fill="#86efac"/></svg>`,
  },
  {
    id: "seal",
    name: "Sealy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc19" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc19)"/><ellipse cx="32" cy="38" rx="15" ry="12" fill="#94a3b8"/><ellipse cx="32" cy="41" rx="9" ry="7" fill="#cbd5e1"/><circle cx="14" cy="48" r="3.4" fill="#64748b"/><circle cx="50" cy="48" r="3.4" fill="#64748b"/><circle cx="25.5" cy="33" r="2.6" fill="#0f172a"/><circle cx="38.5" cy="33" r="2.6" fill="#0f172a"/><circle cx="26.3" cy="32.2" r=".9" fill="#fff"/><circle cx="39.3" cy="32.2" r=".9" fill="#fff"/><ellipse cx="32" cy="39" rx="2.2" ry="1.6" fill="#0f172a"/><path d="M14 34 L22 36 M14 39 L22 38.5 M42 36 L50 34 M42 38.5 L50 39" stroke="#475569" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  },
  {
    id: "otter",
    name: "Ollie",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc20" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ccfbf1"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc20)"/><circle cx="20" cy="24" r="4.5" fill="#78350f"/><circle cx="44" cy="24" r="4.5" fill="#78350f"/><ellipse cx="32" cy="38" rx="14" ry="13" fill="#92400e"/><ellipse cx="32" cy="41" rx="8.5" ry="7" fill="#ffedd5"/><circle cx="26" cy="34" r="2.5" fill="#1c1917"/><circle cx="38" cy="34" r="2.5" fill="#1c1917"/><circle cx="26.8" cy="33.2" r=".9" fill="#fff"/><circle cx="38.8" cy="33.2" r=".9" fill="#fff"/><ellipse cx="32" cy="40" rx="2.2" ry="1.6" fill="#1c1917"/><path d="M28 44 Q32 46 36 44" stroke="#1c1917" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M16 38 L23 39.5 M16 43 L23 42.5 M41 39.5 L48 38 M41 42.5 L48 43" stroke="#d6a87c" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  },
  {
    id: "dolphin",
    name: "Finny",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc21" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbeafe"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc21)"/><path d="M30 12 C32 8 35 7 37 9 C35 10 34 12 34 14 Z" fill="#93c5fd"/><path d="M32 8 C32 8 33 5 35 5" stroke="#1e3a8a" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="37" rx="16" ry="12" fill="#60a5fa"/><path d="M18 40 Q32 48 46 40 Q40 44 32 44 Q24 44 18 40 Z" fill="#dbeafe"/><path d="M44 26 L52 20 L50 30 Z" fill="#3b82f6"/><circle cx="25" cy="34" r="2.5" fill="#172554"/><path d="M21 39 Q26 42 31 40.5" stroke="#172554" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="40" cy="30" r="1.5" fill="#dbeafe" opacity=".9"/></svg>`,
  },
  {
    id: "shark",
    name: "Chomp",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc22" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0e7ff"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc22)"/><path d="M32 10 L37 20 L27 20 Z" fill="#475569"/><ellipse cx="32" cy="38" rx="16" ry="12" fill="#94a3b8"/><path d="M17 40 Q32 47 47 40 Q40 45 32 45 Q24 45 17 40 Z" fill="#f1f5f9"/><path d="M22 40.5 L24 44 L26 40.5 L28 44 L30 40.5 L32 44 L34 40.5 L36 44 L38 40.5 L40 44 L42 40.5" stroke="#475569" stroke-width="1.4" fill="#f1f5f9" stroke-linejoin="round"/><circle cx="24" cy="32" r="2.5" fill="#0f172a"/><circle cx="40" cy="32" r="2.5" fill="#0f172a"/><circle cx="24.8" cy="31.2" r=".9" fill="#fff"/><circle cx="40.8" cy="31.2" r=".9" fill="#fff"/></svg>`,
  },
  {
    id: "turtle",
    name: "Turbo",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc23" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f99d"/><stop offset="1" stop-color="#4d7c0f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc23)"/><path d="M14 44 C14 30 22 22 32 22 C42 22 50 30 50 44 Z" fill="#365314"/><path d="M18 44 C18 32 24 26 32 26 C40 26 46 32 46 44 Z" fill="#65a30d"/><path d="M32 26 L32 44 M24 29 L26 44 M40 29 L38 44" stroke="#365314" stroke-width="1.6"/><circle cx="32" cy="44" r="8" fill="#a3e635"/><circle cx="29" cy="43" r="2" fill="#1a2e05"/><circle cx="35" cy="43" r="2" fill="#1a2e05"/><path d="M29.5 47 Q32 48.5 34.5 47" stroke="#1a2e05" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="16" cy="50" r="2" fill="#365314"/><circle cx="48" cy="50" r="2" fill="#365314"/></svg>`,
  },
  {
    id: "crab",
    name: "Pinchy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc24" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe4e6"/><stop offset="1" stop-color="#fb7185"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc24)"/><path d="M20 32 L12 26 M44 32 L52 26" stroke="#e11d48" stroke-width="2.4" stroke-linecap="round"/><circle cx="11" cy="24" r="4.5" fill="#fb7185"/><circle cx="53" cy="24" r="4.5" fill="#fb7185"/><path d="M11 20 L11 24 M53 20 L53 24" stroke="#881337" stroke-width="1.8"/><path d="M27 20 L27 14 M37 20 L37 14" stroke="#881337" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="32" cy="38" rx="14" ry="11" fill="#f43f5e"/><circle cx="27" cy="18" r="3.4" fill="#fff"/><circle cx="37" cy="18" r="3.4" fill="#fff"/><circle cx="27" cy="18.5" r="1.6" fill="#4c0519"/><circle cx="37" cy="18.5" r="1.6" fill="#4c0519"/><circle cx="26" cy="36" r="2.2" fill="#4c0519"/><circle cx="38" cy="36" r="2.2" fill="#4c0519"/><path d="M28 40 Q32 42.5 36 40" stroke="#4c0519" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "snail",
    name: "Pokey",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc25" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#ca8a04"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc25)"/><path d="M24 14 L22 8 M32 13 L32 7" stroke="#713f12" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="13" r="1.8" fill="#713f12"/><circle cx="32" cy="12" r="1.8" fill="#713f12"/><circle cx="32" cy="30" r="13" fill="#b45309"/><path d="M32 22 C37 22 40 26 40 30 C40 35 36 38 32 38 C28 38 25 35 25 31 C25 28 27 26 29.5 26 C31.5 26 33 27.5 33 29.5 C33 31.5 31 32.5 29.5 31.5" stroke="#fde68a" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M14 48 C20 44 28 44 34 46 L46 46 C50 46 50 52 46 52 L18 52 C14 52 12 50 14 48 Z" fill="#fde68a"/><circle cx="20" cy="47" r="1.8" fill="#713f12"/><path d="M21 50 Q24 51.5 27 50" stroke="#713f12" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "ladybug",
    name: "Dotty",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc26" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fecdd3"/><stop offset="1" stop-color="#e11d48"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc26)"/><path d="M25 16 Q24 11 21 9 M39 16 Q40 11 43 9" stroke="#1c1917" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="32" cy="22" r="6" fill="#1c1917"/><circle cx="32" cy="38" r="15" fill="#ef4444"/><path d="M32 23 L32 53" stroke="#1c1917" stroke-width="2"/><circle cx="24" cy="33" r="2.6" fill="#1c1917"/><circle cx="40" cy="33" r="2.6" fill="#1c1917"/><circle cx="25" cy="43" r="2.2" fill="#1c1917"/><circle cx="39" cy="43" r="2.2" fill="#1c1917"/><circle cx="28" cy="21" r="1.8" fill="#fff"/><circle cx="36" cy="21" r="1.8" fill="#fff"/><circle cx="28" cy="21.3" r=".9" fill="#1c1917"/><circle cx="36" cy="21.3" r=".9" fill="#1c1917"/></svg>`,
  },
  {
    id: "caterpillar",
    name: "Inchy",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc27" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecfccb"/><stop offset="1" stop-color="#84cc16"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc27)"/><path d="M20 22 Q19 17 16 16 M26 20 Q26 15 24 13" stroke="#3f6212" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="16" cy="42" r="7.5" fill="#65a30d"/><circle cx="26" cy="44" r="8" fill="#84cc16"/><circle cx="37" cy="44" r="8.5" fill="#65a30d"/><circle cx="47" cy="41" r="9" fill="#4d7c0f"/><circle cx="50" cy="38" r="1.6" fill="#ecfccb"/><circle cx="44" cy="37" r="2.2" fill="#fff"/><circle cx="44" cy="37.2" r="1.1" fill="#1a2e05"/><path d="M47.5 42 Q50 43.5 52 42.5" stroke="#ecfccb" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="38" cy="47" rx="1.6" ry="1.1" fill="#d9f99d"/></svg>`,
  },
  {
    id: "dragon",
    name: "Ember",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc28" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fed7aa"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc28)"/><path d="M14 40 C10 34 10 28 14 24 C15 29 17 30 18 27 C20 32 22 34 24 35 Z" fill="#fbbf24"/><path d="M50 40 C54 34 54 28 50 24 C49 29 47 30 46 27 C44 32 42 34 40 35 Z" fill="#fbbf24"/><path d="M25 20 L27 12 L31 19 Z" fill="#fde68a"/><path d="M39 20 L37 12 L33 19 Z" fill="#fde68a"/><ellipse cx="32" cy="37" rx="14" ry="13" fill="#4ade80"/><ellipse cx="32" cy="42" rx="8" ry="6.5" fill="#bbf7d0"/><circle cx="25.5" cy="34" r="2.6" fill="#052e16"/><circle cx="38.5" cy="34" r="2.6" fill="#052e16"/><circle cx="26.3" cy="33.2" r=".9" fill="#fff"/><circle cx="39.3" cy="33.2" r=".9" fill="#fff"/><ellipse cx="32" cy="40" rx="1.8" ry="1.4" fill="#052e16"/><path d="M24 45 Q25 48 27 47 M40 45 Q39 48 37 47" stroke="#f97316" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "dino",
    name: "Tiny",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc29" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ccfbf1"/><stop offset="1" stop-color="#0d9488"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc29)"/><path d="M24 20 L26 12 L30 19 Z" fill="#fde047"/><path d="M32 19 L34 11 L38 18 Z" fill="#fde047"/><path d="M40 20 L43 13 L46 20 Z" fill="#fde047"/><ellipse cx="32" cy="39" rx="14" ry="12" fill="#2dd4bf"/><ellipse cx="32" cy="44" rx="8" ry="5.5" fill="#99f6e4"/><circle cx="37" cy="34" r="3" fill="#fff"/><circle cx="37" cy="34.2" r="1.5" fill="#042f2e"/><circle cx="24" cy="38" r="1.4" fill="#0f766e"/><circle cx="27" cy="42" r="1.2" fill="#0f766e"/><path d="M40 40 Q43 41.5 45.5 40" stroke="#042f2e" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "axolotl",
    name: "Gilly",
    category: "Animals",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pc30" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fce7f3"/><stop offset="1" stop-color="#f0abfc"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pc30)"/><path d="M16 26 L10 22 L11 27 L7 29 L12 31 L11 36 L16 33 Z" fill="#f472b6"/><path d="M48 26 L54 22 L53 27 L57 29 L52 31 L53 36 L48 33 Z" fill="#f472b6"/><ellipse cx="32" cy="39" rx="14" ry="12" fill="#f9a8d4"/><circle cx="25.5" cy="36" r="2.4" fill="#500f28"/><circle cx="38.5" cy="36" r="2.4" fill="#500f28"/><circle cx="26.3" cy="35.2" r=".8" fill="#fff"/><circle cx="39.3" cy="35.2" r=".8" fill="#fff"/><path d="M27 41 Q32 44.5 37 41" stroke="#500f28" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="21" cy="40" rx="2.2" ry="1.5" fill="#f472b6"/><ellipse cx="43" cy="40" rx="2.2" ry="1.5" fill="#f472b6"/></svg>`,
  },
];
