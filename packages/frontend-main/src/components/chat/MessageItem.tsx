import { memo, useState } from "react";
import { BookmarkPlus, ChevronRight } from "lucide-react";
import type { ChatMessage } from "@/types";
import { cn } from "@/utils/cn";
import { ToolChip } from "./ToolChip";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { SubmitPlanBlock } from "./SubmitPlanBlock";
import { AskQuestionBlock } from "./AskQuestionBlock";
import { AskSomethingBlock } from "./AskSomethingBlock";
import { AskSlidesTemplateBlock } from "./AskSlidesTemplateBlock";
import { PresentSlidesBlock } from "./PresentSlidesBlock";
import { TeamRunView } from "./TeamRunView";
import { SavePromptModal } from "@/components/panels/PromptLibraryPanel";

/** Tools that render as full-width blocks instead of inline chips. */
function isBlockTool(name: string): boolean {
  return (
    name === "submit_plan" ||
    name === "ask_question_to_user" ||
    name === "ask_for_something" ||
    name === "ask_user_to_choose_slides_template" ||
    name === "present_slides"
  );
}

function MessageItemImpl({ message }: { message: ChatMessage }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  if (message.role === "user") {
    return (
      <div className="group flex justify-end fade-in">
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          <div className="whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-br-md bg-[var(--secondary)] px-4 py-2.5 text-sm leading-relaxed text-[var(--secondary-fg)]">
            {message.content}
          </div>
          {message.content.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              title="Save prompt to library"
              aria-label="Save prompt to library"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--subtle)] opacity-0 transition-opacity hover:bg-[var(--chip)] hover:text-[var(--fg)] group-hover:opacity-100 focus-visible:opacity-100"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save to library
            </button>
          )}
          <SavePromptModal
            open={saveOpen}
            initialContent={message.content}
            onClose={() => setSaveOpen(false)}
          />
        </div>
      </div>
    );
  }

  const tools = message.tools ?? [];
  // submit_plan / ask_question_to_user / ask_for_something render as full-width blocks, not chips.
  const blockTools = tools.filter((t) => isBlockTool(t.name));
  const chipTools = tools.filter((t) => !isBlockTool(t.name));

  const hasContent = message.content.trim().length > 0;
  const isTeam = Boolean(message.team);
  const showThinking = message.streaming && !hasContent && tools.length === 0 && !isTeam;

  return (
    <div className="flex gap-3 fade-in">
      <div
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)]"
        aria-hidden
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.9" />
        </svg>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        {isTeam && message.team && <TeamRunView team={message.team} />}

        {message.reasoning && message.reasoning.trim().length > 0 && (
          <div className="overflow-hidden rounded-[var(--radius-md)] bg-[var(--chip)]">
            <button
              onClick={() => setShowReasoning((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", showReasoning && "rotate-90")}
              />
              Reasoning
            </button>
            {showReasoning && (
              <div className="whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-[var(--muted)]">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {chipTools.length > 0 && (
          <div className="flex flex-col items-start gap-1.5">
            {chipTools.map((tool) => (
              <ToolChip key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {blockTools.map((tool) =>
          tool.name === "submit_plan" ? (
            <SubmitPlanBlock key={tool.id} tool={tool} />
          ) : tool.name === "ask_for_something" ? (
            <AskSomethingBlock key={tool.id} tool={tool} />
          ) : tool.name === "ask_user_to_choose_slides_template" ? (
            <AskSlidesTemplateBlock key={tool.id} tool={tool} />
          ) : tool.name === "present_slides" ? (
            <PresentSlidesBlock key={tool.id} tool={tool} />
          ) : (
            <AskQuestionBlock key={tool.id} tool={tool} />
          ),
        )}

        {showThinking && <ThinkingIndicator />}

        {hasContent && (
          <div
            className={cn(
              "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--fg)]",
              message.streaming && "caret",
            )}
          >
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
