import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandPrefix, parseChannelCommand, stripMention } from "./commands.js";

describe("channel commands", () => {
  it("treats plain telegram text as a message", () => {
    assert.deepEqual(
      parseChannelCommand("hello, build my app", {
        mentionRequired: false,
        mention: { botId: "1", botName: "Bot" },
      }),
      { type: "message", text: "hello, build my app" },
    );
  });

  it("parses telegram slash-commands without any mention", () => {
    const mention = { botId: "1", botName: "Bot" };
    assert.deepEqual(
      parseChannelCommand("/@switch researcher", { mentionRequired: false, mention }),
      { type: "switch", name: "researcher" },
    );
    assert.deepEqual(
      parseChannelCommand("/@switch default", { mentionRequired: false, mention }),
      { type: "switch", name: "default" },
    );
    assert.deepEqual(
      parseChannelCommand("/@ok", { mentionRequired: false, mention }),
      { type: "ok" },
    );
    assert.deepEqual(
      parseChannelCommand("/@no", { mentionRequired: false, mention }),
      { type: "no" },
    );
    assert.deepEqual(
      parseChannelCommand("/@new-chat", { mentionRequired: false, mention }),
      { type: "new-chat" },
    );
  });

  it("accepts new-chat aliases", () => {
    const mention = { botId: "1", botName: "Bot" };
    for (const text of ["/@newchat", "/@new_chat", "/@NEW-CHAT"]) {
      assert.deepEqual(
        parseChannelCommand(text, { mentionRequired: false, mention }),
        { type: "new-chat" },
      );
    }
  });

  it("treats unknown /@commands as plain messages", () => {
    assert.deepEqual(
      parseChannelCommand("/@frobnicate now", {
        mentionRequired: false,
        mention: { botId: "1", botName: "Bot" },
      }),
      { type: "message", text: "/@frobnicate now" },
    );
  });

  it("ignores discord messages without a mention", () => {
    assert.equal(
      parseChannelCommand("/@switch x", {
        mentionRequired: true,
        mention: { botId: "123", botName: "Helper" },
      }),
      null,
    );
    assert.equal(
      parseChannelCommand("hello bot", {
        mentionRequired: true,
        mention: { botId: "123", botName: "Helper" },
      }),
      null,
    );
  });

  it("parses discord commands after a raw <@id> mention", () => {
    const mention = { botId: "123", botName: "Helper" };
    assert.deepEqual(
      parseChannelCommand("<@123> /@switch researcher", { mentionRequired: true, mention }),
      { type: "switch", name: "researcher" },
    );
    assert.deepEqual(
      parseChannelCommand("<@!123> /@ok", { mentionRequired: true, mention }),
      { type: "ok" },
    );
    assert.deepEqual(
      parseChannelCommand("<@123> /@new-chat", { mentionRequired: true, mention }),
      { type: "new-chat" },
    );
  });

  it("parses @Name mentions case-insensitively", () => {
    const mention = { botId: "123", botName: "HelperBot" };
    assert.deepEqual(
      parseChannelCommand("@helperbot /@no", { mentionRequired: true, mention }),
      { type: "no" },
    );
    assert.deepEqual(
      parseChannelCommand("@HelperBot: /@switch default", { mentionRequired: true, mention }),
      { type: "switch", name: "default" },
    );
  });

  it("keeps non-command text after the mention as a message", () => {
    assert.deepEqual(
      parseChannelCommand("<@123> what is the status?", {
        mentionRequired: true,
        mention: { botId: "123", botName: "Helper" },
      }),
      { type: "message", text: "what is the status?" },
    );
  });

  it("strips mentions for matching", () => {
    assert.deepEqual(stripMention("<@123> hi", { botId: "123", botName: "B" }), {
      stripped: "hi",
      mentioned: true,
    });
    assert.deepEqual(stripMention("@Bee hi", { botId: "", botName: "bee" }), {
      stripped: "hi",
      mentioned: true,
    });
    assert.deepEqual(stripMention("hi", { botId: "123", botName: "Bee" }), {
      stripped: "hi",
      mentioned: false,
    });
  });

  it("builds mention prefixes per channel", () => {
    assert.equal(commandPrefix("telegram", "Bot"), "");
    assert.equal(commandPrefix("discord", "Helper"), "@Helper ");
    assert.equal(commandPrefix("slack", ""), "@Bot ");
  });
});
