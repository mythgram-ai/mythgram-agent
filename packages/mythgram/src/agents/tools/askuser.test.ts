import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { askUserTool, ASK_ANSWERED, ASK_TIMEOUT, buildAnswers } from "./askuser.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";
import { QuestionStore } from "../../services/questionStore.js";

/** Wait ~1 tick so a pending execute has registered its questions before we answer. */
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_ARGS = {
  questions: [
    {
      question: "Which database should the application use?",
      context: "The database choice affects the backend architecture.",
      options: ["PostgreSQL", "MongoDB", "SQLite"],
    },
    {
      question: "Which frontend framework should we use?",
      context: "Choose the framework you prefer for the frontend.",
      options: ["React", "Vue", "Svelte", "Next.js"],
    },
  ],
};

describe("ask_question_to_user tool", () => {
  let registry: ToolRegistry;
  let store: QuestionStore;

  before(() => {
    registry = new ToolRegistry().registerAll([askUserTool]);
    store = new QuestionStore();
  });

  interface EmittedEvent {
    event: string;
    data: Record<string, unknown>;
  }

  type CtxWithEmit = ToolContext & { __emitted: EmittedEvent[] };

  function makeCtx(overrides: Partial<ToolContext> = {}): CtxWithEmit {
    const emitted: EmittedEvent[] = [];
    return {
      workspaceRoot: "/tmp",
      shellTimeoutMs: 10_000,
      chatId: "chat-1",
      toolCallId: "toolcall-1",
      askQuestions: store,
      questionTimeoutMs: 60_000,
      emit: (event, data) => emitted.push({ event, data }),
      ...overrides,
      __emitted: emitted,
    } as CtxWithEmit;
  }

  function emittedFor(ctx: CtxWithEmit): EmittedEvent[] {
    return ctx.__emitted;
  }

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("ask_question_to_user"));
    const schema = registry.schemas.find((s) => s.function.name === "ask_question_to_user");
    assert.ok(schema, "ask_question_to_user must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");

    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    const questions = params.properties.questions as {
      type: string;
      minItems?: number;
      items: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
    };
    assert.ok(questions, "questions property must be declared");
    assert.equal(questions.type, "array");
    assert.equal(questions.minItems, 1);
    assert.equal(questions.items.type, "object");
    assert.equal(questions.items.additionalProperties, false, "item schema must forbid extra props");
    const itemProps = questions.items.properties;
    assert.ok(itemProps.question, "question field required");
    assert.ok(itemProps.context, "context field required");
    assert.ok(itemProps.options, "options field required");
    const itemRequired = questions.items.required;
    assert.ok(itemRequired.includes("question"));
    assert.ok(itemRequired.includes("context"));
    assert.ok(itemRequired.includes("options"));
    const options = itemProps.options as { type: string; minItems?: number };
    assert.equal(options.minItems, 1, "options must have at least one item");

    const required = params.required;
    assert.ok(required.includes("questions"), "questions must be required");
  });

  it("validates the arguments with the zod schema", () => {
    const parsed = askUserTool.schema.parse(SAMPLE_ARGS);
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.questions[0].options.length, 3);
  });

  it("rejects a missing questions array via the registry", async () => {
    const ctx = makeCtx();
    const result = await registry.execute("ask_question_to_user", {}, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects an empty questions array via the registry", async () => {
    const ctx = makeCtx();
    const result = await registry.execute("ask_question_to_user", { questions: [] }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a question without options via the registry schema", async () => {
    const ctx = makeCtx();
    const result = await registry.execute(
      "ask_question_to_user",
      { questions: [{ question: "q", context: "c", options: [] }] },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects whitespace-only options during execution", async () => {
    const ctx = makeCtx();
    const result = await registry.execute(
      "ask_question_to_user",
      { questions: [{ question: "q", context: "c", options: ["  "] }] },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_questions");
  });

  it("rejects an empty question/context/option during execution", async () => {
    const ctx = makeCtx();
    const result = await registry.execute(
      "ask_question_to_user",
      { questions: [{ question: "  ", context: "c", options: ["a"] }] },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_questions");
  });

  it("fails cleanly when run without a question runtime (e.g. inside a sub-agent)", async () => {
    const ctx = makeCtx({ askQuestions: undefined });
    const result = await registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "no_question_store");
  });

  it("emits an ask_question SSE event before blocking on the user's answers", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    await tick();

    const events = emittedFor(ctx);
    assert.ok(events.length > 0, "must emit at least one event");
    const evt = events.find((e) => e.event === "ask_question");
    assert.ok(evt, "ask_question event must be emitted");
    assert.equal(evt!.data.id, "toolcall-1");
    assert.equal(evt!.data.chat_id, "chat-1");
    assert.deepEqual(evt!.data.questions, SAMPLE_ARGS.questions);

    const answered = SAMPLE_ARGS.questions.map((q) => ({ question: q.question, answer: q.options[0] }));
    store.submitAnswers("chat-1", "toolcall-1", answered);
    const result = await runPromise;
    assert.equal(result.ok, true);
  });

  it("returns the structured result with answers when the user answers", async () => {
    const ctx = makeCtx();
    const runPromise = registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    await tick();
    const answered = SAMPLE_ARGS.questions.map((q) => ({ question: q.question, answer: "custom answer" }));
    assert.equal(store.submitAnswers("chat-1", "toolcall-1", answered), true);
    const result = await runPromise;

    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "answered");
    assert.equal(data.message, ASK_ANSWERED);
    assert.equal(data.tool, "ask_question_to_user");
    const answers = data.answers as Array<{ question: string; answer: string }>;
    assert.equal(answers.length, 2);
    assert.equal(answers[0].answer, "custom answer");
    assert.deepEqual(data.questions, SAMPLE_ARGS.questions);
  });

  it("continues autonomously with the timeout message when the user never responds", async () => {
    const ctx = makeCtx({ questionTimeoutMs: 30 });
    const started = Date.now();
    const result = await registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2000, `timeout must fire quickly, took ${elapsed}ms`);
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.decision, "timeout");
    assert.equal(data.message, ASK_TIMEOUT);
    assert.equal(data.timed_out, true);
  });

  it("returns a no-op (ok:false) for answers on a request that is not pending", () => {
    assert.equal(store.submitAnswers("chat-1", "does-not-exist", []), false);
    assert.equal(store.submitAnswers("chat-1", "toolcall-1", []), false, "already answered");
  });

  it("waits for answers (3-minute default timeout) instead of timing out immediately", async () => {
    // No questionTimeoutMs override -> the 3-minute default applies.
    const ctx = makeCtx({});
    const runPromise = registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    await tick(50);

    // Still pending after a short wait — the default is far longer than a few ms.
    assert.equal(store.submitAnswers("chat-1", "toolcall-1", SAMPLE_ARGS.questions.map((q) => ({ question: q.question, answer: q.options[0] }))), true);
    const result = await runPromise;
    assert.equal(result.ok, true);
    assert.equal((result.data as { decision: string }).decision, "answered");
  });

  it("resolves to an aborted error when the turn is aborted while waiting", async () => {
    const controller = new AbortController();
    const ctx = makeCtx({ signal: controller.signal });
    const runPromise = registry.execute("ask_question_to_user", SAMPLE_ARGS, ctx);
    await tick();
    controller.abort();
    const result = await runPromise;

    assert.equal(result.ok, false);
    const error = result.error as { code: string };
    assert.equal(error.code, "aborted");
    // The pending entry must have been cleaned up.
    assert.equal(store.submitAnswers("chat-1", "toolcall-1", []), false);
  });

  it("does not throw and returns a valid ToolResult for every path", async () => {
    const results = await Promise.all([
      (async () => {
        const c = makeCtx();
        c.toolCallId = "t-answer";
        const p = registry.execute("ask_question_to_user", SAMPLE_ARGS, c);
        await tick();
        store.submitAnswers("chat-1", "t-answer", [{ question: "q", answer: "a" }]);
        return p;
      })(),
      (async () => {
        const c = makeCtx();
        c.toolCallId = "t-timeout";
        c.questionTimeoutMs = 20;
        const p = registry.execute("ask_question_to_user", SAMPLE_ARGS, c);
        return p;
      })(),
    ]);

    for (const result of results) {
      assert.equal(typeof result.ok, "boolean");
      if (result.ok) assert.ok(result.data);
      assert.deepEqual(Object.keys(result).sort(), ["data", "ok"]);
    }
  });

  it("exposes stable result strings, a clear UI label, and buildAnswers alignment", () => {
    assert.equal(askUserTool.name, "ask_question_to_user");
    assert.equal(askUserTool.label(SAMPLE_ARGS as never), "Ask 2 Questions");
    assert.equal(askUserTool.label({ questions: [{ question: "q", context: "c", options: ["o"] }] } as never), "Ask 1 Question");
    assert.ok(askUserTool.description.length > 0);
    assert.match(ASK_ANSWERED, /answered/i);
    assert.match(ASK_TIMEOUT, /user is not hare/i);

    const normalized = [
      { question: "Pick one", context: "ctx", options: ["a", "b"] },
      { question: "Pick two", context: "ctx2", options: ["x"] },
    ];
    const answers = buildAnswers(normalized, ["b", "x"]);
    assert.equal(answers.length, 2);
    assert.equal(answers[0].question, "Pick one");
    assert.equal(answers[0].answer, "b");
    assert.equal(answers[1].answer, "x");
  });
});