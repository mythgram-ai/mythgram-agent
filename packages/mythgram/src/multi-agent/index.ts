/**
 * Pre-created multi-agent assets: 20 ready-to-use agent teams, 4 CEO agents (each controlling five
 * teams), and 20 custom agents. Every agent runs with a comprehensive, 5000+ character system prompt
 * composed from its role instructions plus the shared operating doctrine.
 */
export { PRECREATED_TEAMS, getPrecreatedTeam } from "./teams.js";
export { PRECREATED_CEOS, getPrecreatedCeo } from "./ceos.js";
export {
  PRECREATED_CUSTOM_AGENTS,
  getPrecreatedCustomAgent,
  type PrecreatedCustomAgent,
} from "./customAgents.js";
