#!/usr/bin/env node
/**
 * `mythgram` — the unified CLI for the published package.
 *
 * Running `mythgram` starts the whole application (Express API + the bundled web
 * console) through the background deamon, so it keeps running and self-heals, and
 * opens ONE port for the frontend and interaction. Its ".mythgram" data folder is
 * created in the directory where the command was run.
 *
 *   mythgram                 start the app (daemonized, prints the URL)
 *   mythgram start           same as above
 *   mythgram start --foreground   run the supervisor in the foreground
 *   mythgram stop            stop the app + supervisor
 *   mythgram restart         restart
 *   mythgram status          show supervisor + app status
 *   mythgram logs [--lines N]     tail the logs
 *   mythgram install         install autostart (systemd/cron) and start now
 *   mythgram uninstall       remove autostart entries
 *   mythgram acp             run the ACP stdio bridge (for editors like Zed)
 *
 * An ACP client (e.g. Zed) launches the agent with `npx --yes mythgram`. Because
 * such clients attach pipes (not a TTY) to stdin, `mythgram` with no arguments
 * automatically speaks ACP on stdio in that context — so the advertised command
 * just works.
 */
import http from "node:http";
import {
  cmdInstall,
  cmdLogs,
  cmdStart,
  cmdStatus,
  cmdStop,
  cmdUninstall,
  printHelp as printDaemonHelp,
} from "./deamon/daemon.js";
import { runAcp } from "./acp/index.js";

const PORT = Number(process.env.PORT ?? 8787);

/** Poll the backend health endpoint until it answers (or the deadline passes). */
function waitForHealth(timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get(`http://localhost:${PORT}/health`, { timeout: 4000 }, (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 500) {
          resolve(true);
          return;
        }
        retry();
      });
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      req.on("error", () => retry());
    };
    const retry = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function printBanner(url: string): void {
  process.stdout.write(
    [
      "",
      `  Mythgram is running → ${url}`,
      `  Workspace           → ${process.cwd()}`,
      `  Data folder         → ${process.cwd()}/.mythgram`,
      "",
      "  The app runs in the background and restarts itself if it crashes.",
      "  Stop it with: mythgram stop    Status: mythgram status",
      "",
    ].join("\n"),
  );
}

function printCliHelp(): void {
  process.stdout.write(
    [
      "mythgram — local autonomous coding agent with a bundled web console",
      "",
      "Usage:",
      "  mythgram                       start the app (daemonized)",
      "  mythgram start [--foreground]  start the app",
      "  mythgram stop | restart        stop / restart",
      "  mythgram status | logs         inspect the running app",
      "  mythgram install | uninstall   manage autostart",
      "  mythgram acp                   run the ACP stdio bridge",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case undefined:
    case "start": {
      const foreground = args.includes("--foreground");
      cmdStart(foreground);
      if (foreground) return;
      const ok = await waitForHealth();
      if (ok) {
        printBanner(`http://localhost:${PORT}`);
      } else {
        process.stdout.write(
          "[mythgram] started, but the app is not answering yet. Check logs with: mythgram logs\n",
        );
      }
      return;
    }
    case "restart": {
      await cmdStop();
      const foreground = args.includes("--foreground");
      cmdStart(foreground);
      if (foreground) return;
      const ok = await waitForHealth();
      if (ok) printBanner(`http://localhost:${PORT}`);
      return;
    }
    case "stop":
      await cmdStop();
      return;
    case "status":
      await cmdStatus();
      return;
    case "logs": {
      const idx = args.indexOf("--lines");
      const lines = idx >= 0 ? Number(args[idx + 1]) || 80 : 80;
      cmdLogs(lines);
      return;
    }
    case "install":
      cmdInstall();
      return;
    case "uninstall":
      cmdUninstall();
      return;
    case "help":
    case "-h":
    case "--help":
      printCliHelp();
      return;
    default:
      // Unknown command: defer to the deamon help so `mythgram foo` explains the surface.
      process.stdout.write(`[mythgram] unknown command: ${command}\n\n`);
      printDaemonHelp();
      process.exitCode = 1;
      return;
  }
}

const command = process.argv[2];
const explicitAcp = command === "acp" || command === "--acp";
// Editors/ACP clients spawn the agent with piped stdio (no TTY), which is how
// `npx --yes mythgram` ends up here. In an interactive terminal we start the app.
const implicitAcp = command === undefined && !process.stdin.isTTY;

if (explicitAcp || implicitAcp) {
  runAcp();
} else {
  void main();
}
