import { Router, type Request, type Response } from "express";
import type { UserProfileManager } from "../agents/profiles/index.js";
import { isDefaultProfileId } from "../agents/profiles/index.js";

/**
 * User Profiles API — read/CRUD over the persistent user-profile identities plus the
 * active-profile selection.
 *
 * The frontend primarily persists profiles through the shared app-state sync (the
 * `userProfiles` / `activeUserProfileId` documents), exactly like Custom Agents; these
 * endpoints expose the same data through a dedicated, well-typed surface (and give
 * external callers a clean CRUD API). Every write goes through the UserProfileManager,
 * which stores configs in the existing SQLite app_state repository.
 *
 * Profile DATA isolation (fresh chats/settings/memory/... per profile) is owned by the
 * frontend's per-profile snapshots (`profileStates` / `profileSessions` documents) —
 * this API only manages the identity records (name, description, logo avatar).
 */
export function buildUserProfilesRouter(manager: UserProfileManager): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    // ensureDefault also heals legacy defaults saved before curated logos existed
    // (routing them to the default SVG logo and persisting the fix).
    manager.ensureDefault();
    const profiles = manager.list();
    res.json({ ok: true, count: profiles.length, active_id: manager.getActiveId(), profiles });
  });

  router.get("/active", (_req: Request, res: Response) => {
    const active = manager.getActive();
    res.json({ ok: true, active_id: active.id, profile: active });
  });

  router.put("/active", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { id?: unknown };
    const id = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;
    const active = manager.setActive(id);
    res.json({ ok: true, active_id: active.id, profile: active });
  });

  router.get("/:id", (req: Request, res: Response) => {
    const profile = manager.get(String(req.params.id));
    if (!profile) {
      res.status(404).json({ error: "User profile not found." });
      return;
    }
    res.json({ ok: true, profile });
  });

  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : typeof body.username === "string"
          ? body.username.trim()
          : "";
    if (!name) {
      res.status(400).json({ error: "A profile name is required." });
      return;
    }
    const avatar =
      typeof body.avatar === "string"
        ? body.avatar
        : typeof body.logo === "string"
          ? (body.logo as string)
          : "";
    if (!avatar.trim()) {
      res.status(400).json({ error: "A profile logo is required. Choose one from the gallery or upload an image." });
      return;
    }
    try {
      const profile = manager.create({
        name,
        description: typeof body.description === "string" ? body.description : "",
        avatar,
      });
      res.json({ ok: true, active_id: manager.getActiveId(), profile });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<UserProfileManager["update"]>[1] = {};
    if (typeof body.name === "string") patch.name = body.name;
    else if (typeof body.username === "string") patch.name = body.username as string;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.avatar === "string") patch.avatar = body.avatar;
    else if (typeof body.logo === "string") patch.avatar = body.logo as string;
    if (patch.avatar !== undefined && !patch.avatar.trim()) {
      res.status(400).json({ error: "A profile logo is required. Choose one from the gallery or upload an image." });
      return;
    }

    try {
      const profile = manager.update(String(req.params.id), patch);
      if (!profile) {
        res.status(404).json({ error: "User profile not found." });
        return;
      }
      res.json({ ok: true, profile });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (isDefaultProfileId(id)) {
      res.status(400).json({ error: "The default profile cannot be deleted." });
      return;
    }
    const removed = manager.delete(id);
    if (!removed) {
      res.status(404).json({ error: "User profile not found, or it is the last remaining profile." });
      return;
    }
    res.json({ ok: true, active_id: manager.getActiveId() });
  });

  return router;
}
