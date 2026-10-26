import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/** Minimum number of seconds the wait tool accepts. */
export const WAIT_MIN_SECONDS = 1;
/** Maximum number of seconds the wait tool accepts (3 minutes). */
export const WAIT_MAX_SECONDS = 180;

const schema = z.object({
  seconds: z
    .number()
    .int("The wait duration must be a whole number of seconds.")
    .min(WAIT_MIN_SECONDS, `The wait duration must be at least ${WAIT_MIN_SECONDS} second.`)
    .max(WAIT_MAX_SECONDS, `The wait duration must be at most ${WAIT_MAX_SECONDS} seconds.`)
    .describe(
      `The amount of time to wait in seconds. Must be between ${WAIT_MIN_SECONDS} and ${WAIT_MAX_SECONDS} seconds.`,
    ),
});

export const waitTool = defineTool({
  name: "wait",
  description:
    "Pause the agent for a specified amount of time before continuing. Use this tool when you " +
    "need to wait for a process, task, event, or external operation to complete. The wait " +
    "duration is provided in seconds and can be between 1 and 180 seconds (3 minutes).",
  schema,
  label: (args) => {
    const seconds = typeof args.seconds === "number" ? args.seconds : 0;
    return `Wait ${seconds} second${seconds === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const seconds = args.seconds;

    // Respect an already-cancelled turn: never start a wait if the run is aborting.
    if (ctx.signal?.aborted) {
      return {
        ok: false,
        error: { code: "aborted", message: "The wait was aborted before it started." },
      };
    }

    const aborted = await sleep(seconds * 1000, ctx.signal);
    if (aborted) {
      return {
        ok: false,
        error: { code: "aborted", message: "The wait was aborted before it completed." },
      };
    }

    return {
      ok: true,
      data: {
        waited_seconds: seconds,
        message: `Waited ${seconds} second${seconds === 1 ? "" : "s"}. Continue with the task.`,
      },
    };
  },
});

/**
 * Sleep for `ms` milliseconds, resolving early when the abort signal fires. Resolves to `true` when
 * the sleep was cut short by an abort, and `false` when the full duration elapsed. The timer and the
 * abort listener are always cleaned up so no handle or listener leaks after the call settles.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
