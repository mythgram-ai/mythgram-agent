import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, Plus, Sparkles, Terminal } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, TextArea, TextInput } from "@/components/ui/primitives";
import {
  createAcpClient,
  updateAcpClient,
  validateAcpClient,
  type AcpClient,
  type AcpClientInput,
  type AcpValidateResult,
} from "@/lib/acpClient";
import { cn } from "@/utils/cn";

/**
 * Add/edit form for an ACP-compatible agent. Only name, command and args are
 * required; cwd/env are optional advanced settings for agents that need them.
 * A "Test agent" action spawns + initializes the process without saving.
 */

interface Preset {
  id: string;
  name: string;
  command: string;
  args: string[];
  hint: string;
}

const PRESETS: Preset[] = [
  {
    id: "claude",
    name: "Claude Agent",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    hint: "Anthropic Claude Agent SDK adapter",
  },
  {
    id: "codex",
    name: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
    hint: "OpenAI Codex ACP adapter",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "npx",
    args: ["-y", "@google/gemini-cli", "--acp"],
    hint: "Google Gemini CLI",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
    hint: "OpenCode binary (install it first)",
  },
  {
    id: "qwen",
    name: "Qwen Code",
    command: "npx",
    args: ["-y", "@qwen-code/qwen-code", "--acp"],
    hint: "Alibaba Qwen Code",
  },
  {
    id: "cline",
    name: "Cline",
    command: "npx",
    args: ["-y", "cline", "--acp"],
    hint: "Cline CLI",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    command: "npx",
    args: ["-y", "@github/copilot", "--acp"],
    hint: "GitHub Copilot CLI (ACP preview)",
  },
  {
    id: "goose",
    name: "Goose",
    command: "goose",
    args: ["acp"],
    hint: "Block Goose (install it first)",
  },
];

interface FormState {
  name: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  enabled: boolean;
}

function formFrom(client?: AcpClient | null): FormState {
  return {
    name: client?.name ?? "",
    command: client?.command ?? "",
    argsText: (client?.args ?? []).join("\n"),
    envText: Object.entries(client?.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    cwd: client?.cwd ?? "",
    enabled: client?.enabled ?? true,
  };
}

/** Split args: one per line when multiline, otherwise a small shell-style tokenizer. */
export function parseArgsText(text: string): string[] {
  if (text.includes("\n")) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function toInput(form: FormState): AcpClientInput {
  return {
    name: form.name.trim(),
    command: form.command.trim(),
    args: parseArgsText(form.argsText),
    env: parseEnvText(form.envText),
    cwd: form.cwd.trim(),
    enabled: form.enabled,
  };
}

export function AcpConfigModal({
  open,
  client,
  workspace,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: AcpClient | null;
  workspace: string;
  onClose: () => void;
  onSaved: (saved: AcpClient) => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFrom(client));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AcpValidateResult | null>(null);

  useEffect(() => {
    if (!open) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setForm(formFrom(client));
    setError(null);
    setTestResult(null);
    setBusy(false);
    setTesting(false);
  }, [open, client]);

  const input = useMemo(() => toInput(form), [form]);
  const canSave = input.name.length > 0 && input.command.length > 0;

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setTestResult(null);
  };

  const applyPreset = (preset: Preset) => {
    setForm((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : preset.name,
      command: preset.command,
      argsText: preset.args.join("\n"),
    }));
    setTestResult(null);
  };

  const test = async () => {
    if (!canSave) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await validateAcpClient(input);
      setTestResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const saved = client ? await updateAcpClient(client.id, input) : await createAcpClient(input);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Terminal className="h-4 w-4" />}
      title={client ? "Edit ACP agent" : "Add ACP agent"}
      size="lg"
      align="top"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy || testing}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void test()} disabled={!canSave || testing || busy}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Test agent
          </Button>
          <Button onClick={() => void save()} disabled={!canSave || busy || testing}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {client ? "Save changes" : "Add agent"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <p className="m-0 text-sm leading-relaxed text-[var(--muted)]">
          Configure any ACP-compatible agent by name, command and arguments. Mythgram launches it
          over stdio, performs the ACP handshake and keeps it running while you chat.
        </p>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <Sparkles className="h-3.5 w-3.5" /> Quick presets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--secondary)] hover:text-[var(--fg)]"
              >
                {preset.name}
              </button>
            ))}
          </div>
          <p className="m-0 mt-1 text-[10px] text-[var(--subtle)]">
            Presets are starting points — edit the command or args for your installation.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Agent name" hint="Required">
            <TextInput
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Claude Agent"
              autoComplete="off"
            />
          </Field>
          <Field label="Command" hint="Required">
            <TextInput
              value={form.command}
              onChange={(e) => update({ command: e.target.value })}
              placeholder="npx"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Arguments" hint="One per line (or space-separated)">
          <TextArea
            value={form.argsText}
            onChange={(e) => update({ argsText: e.target.value })}
            placeholder={"-y\n@agentclientprotocol/claude-agent-acp"}
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Working directory" hint="Optional · defaults to workspace">
            <TextInput
              value={form.cwd}
              onChange={(e) => update({ cwd: e.target.value })}
              placeholder={workspace || "Absolute or relative path"}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Enabled">
            <label className="flex h-[38px] items-center gap-2 text-sm text-[var(--fg)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--secondary)]"
              />
              Allow this agent to connect
            </label>
          </Field>
        </div>

        <details className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
            Environment variables (optional)
          </summary>
          <div className="mt-2">
            <TextArea
              value={form.envText}
              onChange={(e) => update({ envText: e.target.value })}
              placeholder={"OPENAI_API_KEY=sk-...\nCODEX_PATH=/path/to/codex"}
              rows={3}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="m-0 mt-1 text-[10px] text-[var(--subtle)]">
              One KEY=value per line. Values are stored locally in the workspace database.
            </p>
          </div>
        </details>

        {testResult && (
          <div className="rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--success)_35%,var(--border))] bg-[var(--success-soft)] px-3 py-2.5 text-xs text-[var(--success)]">
            <p className="m-0 flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" /> ACP handshake succeeded
            </p>
            <p className="m-0 mt-1">
              {testResult.agent?.title || testResult.agent?.name || "Agent"} · protocol v
              {testResult.protocolVersion} · {testResult.authMethods.length} auth method
              {testResult.authMethods.length === 1 ? "" : "s"}
            </p>
            {testResult.authMethods.length > 0 && (
              <p className="m-0 mt-0.5">
                Authentication may be required: {testResult.authMethods.map((method) => method.name).join(", ")}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--chip)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The command is launched directly with its arguments (no shell on macOS/Linux). On
            Windows the platform shell is used so <code className="font-mono">npx</code> and{" "}
            <code className="font-mono">.cmd</code> launchers work. Install any required CLI first.
          </span>
        </div>
      </div>
    </Modal>
  );
}

/** Shared status chip used by the panel and cards. */
export function acpStatusStyle(status: string): string {
  return cn(
    status === "connected" && "bg-[var(--success-soft)] text-[var(--success)]",
    status === "connecting" && "bg-[var(--warning-soft)] text-[var(--warning)]",
    status === "error" && "bg-[var(--danger-soft)] text-[var(--danger)]",
    status === "disconnected" && "bg-[var(--chip)] text-[var(--muted)]",
  );
}