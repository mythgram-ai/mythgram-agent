import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import {
  DEFAULT_PROFILE_AVATAR,
  DEFAULT_PROFILE_ID,
  UserProfileManager,
  isDefaultProfileId,
  normalizeAvatar,
  normalizeUserProfile,
} from "./index.js";

describe("user profiles — configuration & normalization", () => {
  it("requires a name (returns null without one)", () => {
    assert.equal(normalizeUserProfile({}, { id: "x", now: 1 }), null);
    assert.equal(normalizeUserProfile({ name: "   " }, { id: "x", now: 1 }), null);
    const ok = normalizeUserProfile({ name: "Ada" }, { id: "x", now: 1 });
    assert.ok(ok);
    assert.equal(ok!.name, "Ada");
  });

  it("accepts both snake_case (wire) and camelCase (stored) field spellings", () => {
    const wire = normalizeUserProfile(
      { name: "A", description: "d", avatar: "", created_at: 5, updated_at: 6 },
      { id: "id1", now: 5 },
    );
    const stored = normalizeUserProfile(
      { name: "A", description: "d", avatar: "", createdAt: 5, updatedAt: 6 },
      { id: "id1", now: 5 },
    );
    assert.equal(wire!.description, "d");
    assert.equal(stored!.description, "d");
    assert.equal(wire!.createdAt, 5);
    assert.equal(stored!.createdAt, 5);
  });

  it("accepts a username spelling for the name", () => {
    const ok = normalizeUserProfile({ username: "Grace" }, { id: "x", now: 1 });
    assert.ok(ok);
    assert.equal(ok!.name, "Grace");
  });

  it("caps names and descriptions instead of failing", () => {
    const ok = normalizeUserProfile(
      { name: "n".repeat(500), description: "d".repeat(900) },
      { id: "x", now: 1 },
    );
    assert.ok(ok);
    assert.ok(ok!.name.length <= 70);
    assert.ok(ok!.description.length <= 300);
  });

  it("normalizes avatars: data-URLs and https URLs pass, garbage becomes empty", () => {
    assert.equal(normalizeAvatar(""), "");
    assert.equal(normalizeAvatar(undefined), "");
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(normalizeAvatar(dataUrl), dataUrl);
    assert.equal(normalizeAvatar("https://example.com/logo.png"), "https://example.com/logo.png");
    assert.equal(normalizeAvatar("not-an-image"), "");
  });

  it("rejects over-long avatars with null", () => {
    assert.equal(normalizeAvatar(`data:image/png;base64,${"a".repeat(2_000_000)}`), null);
    assert.equal(
      normalizeUserProfile(
        { name: "A", avatar: `data:image/png;base64,${"a".repeat(2_000_000)}` },
        { id: "x", now: 1 },
      ),
      null,
    );
  });

  it("recognizes the default profile id", () => {
    assert.equal(isDefaultProfileId("default"), true);
    assert.equal(isDefaultProfileId(" other "), false);
  });
});

describe("user profiles — persistent manager (existing SQLite app_state repo)", () => {
  let manager: UserProfileManager;
  let repo: AppStateRepo;

  beforeEach(() => {
    const db = new Database(":memory:");
    applySchema(db);
    repo = new AppStateRepo(db);
    manager = new UserProfileManager(repo);
  });

  it("always has a default profile, even on empty storage", () => {
    const list = manager.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, DEFAULT_PROFILE_ID);
    assert.ok(list[0]!.name.length > 0);
    assert.ok(
      list[0]!.avatar.startsWith("data:image/svg+xml;base64,"),
      "default profile is automatically routed to its SVG logo",
    );
    assert.equal(manager.getActive().id, DEFAULT_PROFILE_ID);
  });

  it("heals a legacy default profile without a logo", () => {
    repo.set("userProfiles", [
      { id: DEFAULT_PROFILE_ID, name: "Default User", description: "", avatar: "" },
    ]);
    const healed = manager.ensureDefault();
    assert.equal(healed.id, DEFAULT_PROFILE_ID);
    assert.equal(healed.avatar, DEFAULT_PROFILE_AVATAR);
    const stored = repo.get("userProfiles") as Array<{ avatar?: string }>;
    assert.ok(stored[0]!.avatar!.startsWith("data:image/svg+xml;base64,"));
  });

  it("creates, lists, gets, updates and deletes", () => {
    const created = manager.create({
      name: "Ada",
      description: "Researcher",
      avatar: DEFAULT_PROFILE_AVATAR,
    });
    assert.ok(created.id.length > 0);
    assert.notEqual(created.id, DEFAULT_PROFILE_ID);

    assert.equal(manager.list().length, 2);
    // Default profile stays first.
    assert.equal(manager.list()[0]!.id, DEFAULT_PROFILE_ID);
    assert.equal(manager.get(created.id)!.name, "Ada");

    const updated = manager.update(created.id, { name: "Ada Lovelace" });
    assert.equal(updated!.name, "Ada Lovelace");
    assert.equal(updated!.createdAt, created.createdAt);

    assert.equal(manager.delete(created.id), true);
    assert.equal(manager.get(created.id), null);
    assert.equal(manager.list().length, 1);
  });

  it("persists profiles into the shared `userProfiles` app_state document", () => {
    const created = manager.create({ name: "Grace", avatar: DEFAULT_PROFILE_AVATAR });
    const reopened = new UserProfileManager(repo);
    assert.equal(reopened.get(created.id)!.name, "Grace");
    const raw = repo.get("userProfiles") as unknown[];
    assert.ok(Array.isArray(raw) && raw.length === 2);
  });

  it("never deletes the default profile or the last remaining profile", () => {
    assert.equal(manager.delete(DEFAULT_PROFILE_ID), false);
    assert.equal(manager.list().length, 1);
    // A single non-default profile cannot be removed while it is the only extra one...
    const created = manager.create({ name: "Solo", avatar: DEFAULT_PROFILE_AVATAR });
    assert.equal(manager.list().length, 2);
    assert.equal(manager.delete(created.id), true);
    assert.equal(manager.delete(DEFAULT_PROFILE_ID), false);
  });

  it("throws when creating a profile without a name", () => {
    assert.throws(() => manager.create({ name: "   ", avatar: DEFAULT_PROFILE_AVATAR }));
  });

  it("requires a logo on create and update", () => {
    assert.throws(() => manager.create({ name: "No Logo" }), /logo is required/i);
    assert.throws(() => manager.create({ name: "No Logo", avatar: "  " }), /logo is required/i);
    assert.throws(
      () => manager.create({ name: "Bad Logo", avatar: "not-an-image" }),
      /logo is required/i,
    );
    const created = manager.create({ name: "Ada", avatar: DEFAULT_PROFILE_AVATAR });
    assert.throws(() => manager.update(created.id, { avatar: "" }), /logo is required/i);
  });

  it("activates exactly one profile at a time, falling back to default", () => {
    const a = manager.create({ name: "A", avatar: DEFAULT_PROFILE_AVATAR });
    const b = manager.create({ name: "B", avatar: DEFAULT_PROFILE_AVATAR });
    assert.equal(manager.setActive(a.id).id, a.id);
    assert.equal(manager.getActiveId(), a.id);
    assert.equal(manager.setActive(b.id).id, b.id);
    assert.equal(manager.setActive("missing-id").id, DEFAULT_PROFILE_ID);
    assert.equal(manager.setActive(null).id, DEFAULT_PROFILE_ID);
  });

  it("deleting the active profile falls back to default and forgets its data", () => {
    const created = manager.create({ name: "Temp", avatar: DEFAULT_PROFILE_AVATAR });
    manager.setActive(created.id);
    repo.set("profileStates", { [created.id]: { settings: {} } });
    repo.set("profileSessions", { [created.id]: ["abc"] });
    assert.equal(manager.delete(created.id), true);
    assert.equal(manager.getActiveId(), DEFAULT_PROFILE_ID);
    assert.deepEqual(repo.get("profileStates"), {});
    assert.deepEqual(repo.get("profileSessions"), {});
  });
});
