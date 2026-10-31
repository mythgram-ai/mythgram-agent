import type { ProfileLogo } from "./profileLogos";

/**
 * Curated profile logos, part 2: faces and bots (9).
 * Same format as profileLogosA — self-contained ASCII-only 64x64 SVGs.
 */
export const PROFILE_LOGOS_B: ProfileLogo[] = [
  {
    id: "sunny-smile",
    name: "Sunny Smile",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#facc15"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb1)"/><circle cx="32" cy="34" r="17" fill="#fffbeb"/><circle cx="25.5" cy="31" r="2.8" fill="#713f12"/><circle cx="38.5" cy="31" r="2.8" fill="#713f12"/><ellipse cx="20" cy="37" rx="3" ry="2" fill="#fda4af"/><ellipse cx="44" cy="37" rx="3" ry="2" fill="#fda4af"/><path d="M23 39 Q32 48 41 39 Q32 43 23 39 Z" fill="#b45309"/><path d="M25 41 Q32 46.5 39 41" stroke="#fffbeb" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "bolt-bot",
    name: "Bolt",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#475569"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb2)"/><path d="M32 8 L32 15" stroke="#e2e8f0" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="7" r="2.6" fill="#22d3ee"/><rect x="18" y="17" width="4" height="10" rx="2" fill="#94a3b8"/><rect x="42" y="17" width="4" height="10" rx="2" fill="#94a3b8"/><rect x="16" y="16" width="32" height="26" rx="9" fill="#f1f5f9"/><rect x="16" y="16" width="32" height="26" rx="9" fill="none" stroke="#0f172a" stroke-width="2"/><circle cx="25" cy="29" r="3.4" fill="#0ea5e9"/><circle cx="39" cy="29" r="3.4" fill="#0ea5e9"/><circle cx="25" cy="29" r="1.2" fill="#e0f2fe"/><circle cx="39" cy="29" r="1.2" fill="#e0f2fe"/><path d="M26 36 L38 36" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/><rect x="27" y="45" width="10" height="5" rx="2.5" fill="#94a3b8"/></svg>`,
  },
  {
    id: "boo",
    name: "Boo",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9d5ff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb3)"/><path d="M32 12 C22 12 17 21 17 31 L17 48 L23 44 L27 49 L32 44 L37 49 L41 44 L47 48 L47 31 C47 21 42 12 32 12 Z" fill="#fff"/><circle cx="26" cy="30" r="2.8" fill="#4c1d95"/><circle cx="38" cy="30" r="2.8" fill="#4c1d95"/><ellipse cx="32" cy="37" rx="2.6" ry="3.2" fill="#4c1d95"/><ellipse cx="21.5" cy="34" rx="2.2" ry="1.5" fill="#ddd6fe"/><ellipse cx="42.5" cy="34" rx="2.2" ry="1.5" fill="#ddd6fe"/></svg>`,
  },
  {
    id: "zorp",
    name: "Zorp",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bbf7d0"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb4)"/><path d="M25 14 Q23 8 19 7 M39 14 Q41 8 45 7" stroke="#15803d" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="19" cy="7" r="1.8" fill="#15803d"/><circle cx="45" cy="7" r="1.8" fill="#15803d"/><ellipse cx="32" cy="37" rx="14" ry="15" fill="#86efac"/><ellipse cx="24.5" cy="34" rx="4.6" ry="6.4" fill="#052e16" transform="rotate(-18 24.5 34)"/><ellipse cx="39.5" cy="34" rx="4.6" ry="6.4" fill="#052e16" transform="rotate(18 39.5 34)"/><circle cx="26" cy="32" r="1.4" fill="#fff"/><circle cx="38" cy="32" r="1.4" fill="#fff"/><path d="M27 45 Q32 48 37 45" stroke="#052e16" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "shinobi",
    name: "Shinobi",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb5" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#334155"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb5)"/><path d="M46 22 L54 18 L52 26 Z" fill="#0f172a"/><ellipse cx="32" cy="37" rx="14" ry="14" fill="#ffedd5"/><rect x="18" y="28" width="28" height="10" rx="5" fill="#0f172a"/><ellipse cx="26" cy="33" rx="3.4" ry="3.8" fill="#fff"/><ellipse cx="38" cy="33" rx="3.4" ry="3.8" fill="#fff"/><circle cx="26.5" cy="33.5" r="1.7" fill="#0f172a"/><circle cx="37.5" cy="33.5" r="1.7" fill="#0f172a"/><rect x="29" y="29.5" width="6" height="7" rx="2" fill="#38bdf8"/><path d="M26 46 Q32 49 38 46" stroke="#7c2d12" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "lovey",
    name: "Lovey",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb6" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fecdd3"/><stop offset="1" stop-color="#fb7185"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb6)"/><circle cx="32" cy="34" r="17" fill="#fff1f2"/><path d="M25.5 27 C24 25 21.5 25.5 21.5 28 C21.5 30.5 24 32.5 25.5 34 C27 32.5 29.5 30.5 29.5 28 C29.5 25.5 27 25 25.5 27 Z" fill="#e11d48"/><path d="M38.5 27 C37 25 34.5 25.5 34.5 28 C34.5 30.5 37 32.5 38.5 34 C40 32.5 42.5 30.5 42.5 28 C42.5 25.5 40 25 38.5 27 Z" fill="#e11d48"/><path d="M25 41 Q32 47 39 41" stroke="#881337" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="36" rx="2.6" ry="1.8" fill="#fda4af"/><ellipse cx="44" cy="36" rx="2.6" ry="1.8" fill="#fda4af"/></svg>`,
  },
  {
    id: "cool",
    name: "Cool",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb7" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb7)"/><circle cx="32" cy="35" r="16" fill="#eff6ff"/><rect x="19" y="28" width="12" height="9" rx="4" fill="#0f172a"/><rect x="33" y="28" width="12" height="9" rx="4" fill="#0f172a"/><rect x="30" y="31" width="4" height="2.6" fill="#0f172a"/><path d="M22 30.5 L27 30.5" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round"/><path d="M36 30.5 L41 30.5" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round"/><path d="M27 44 Q33 46 38 42.5" stroke="#0f172a" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`,
  },
  {
    id: "snoozy",
    name: "Snoozy",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb8" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7d2fe"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb8)"/><path d="M22 22 L40 10 L36 24 Z" fill="#312e81"/><circle cx="40" cy="10" r="3" fill="#e0e7ff"/><circle cx="32" cy="39" r="15" fill="#eef2ff"/><path d="M23 37 Q25.5 39 28 37 M36 37 Q38.5 39 41 37" stroke="#312e81" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="21" cy="41" rx="2.2" ry="1.5" fill="#c7d2fe"/><ellipse cx="43" cy="41" rx="2.2" ry="1.5" fill="#c7d2fe"/><path d="M30 44 Q32 45.5 34 44" stroke="#312e81" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M47 36 L51 36 L49 39 L53 39" stroke="#312e81" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M51 27 L54 27 L52.5 29.5 L55.5 29.5" stroke="#312e81" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    id: "party",
    name: "Party",
    category: "Faces and Bots",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb9" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbcfe8"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#pb9)"/><circle cx="14" cy="14" r="1.8" fill="#fff"/><circle cx="51" cy="12" r="1.8" fill="#fde047"/><circle cx="55" cy="46" r="1.8" fill="#fff"/><circle cx="10" cy="44" r="1.8" fill="#4ade80"/><path d="M26 20 L36 6 L40 20 Z" fill="#f59e0b"/><circle cx="36" cy="6" r="2.4" fill="#ec4899"/><circle cx="31" cy="15" r="1.4" fill="#fff"/><circle cx="35" cy="12" r="1.4" fill="#4ade80"/><circle cx="32" cy="38" r="14" fill="#fdf4ff"/><circle cx="26.5" cy="36" r="2.6" fill="#701a75"/><circle cx="37.5" cy="36" r="2.6" fill="#701a75"/><path d="M25 42 Q32 48 39 42" stroke="#701a75" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="21.5" cy="40" rx="2.4" ry="1.6" fill="#f0abfc"/><ellipse cx="42.5" cy="40" rx="2.4" ry="1.6" fill="#f0abfc"/></svg>`,
  },
];
