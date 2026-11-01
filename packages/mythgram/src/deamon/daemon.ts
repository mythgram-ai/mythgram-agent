#!/usr/bin/env node
/**
 * Background deamon (supervisor) for the Mythgram application.
 *
 * Keeps the application running forever on the user's computer: it starts the
 * unified mythgram server (Express API + the bundled web console) as a supervised
 * child process, restarts it on crash with backoff, health checks it, and writes
 * everything to log files.
 *
 * NOTE: the folder is intentionally named `deamon` (project convention).
 *
 * Usage (from the mythgram CLI):
 *   mythgram                 start the app through this deamon (driven by the CLI)
 *   node <mythgram>/dist/deamon/daemon.js start [--foreground]
 *   node <mythgram>/dist/deamon/daemon.js stop
 *   node <mythgram>/dist/deamon/daemon.js restart
 *   node <mythgram>/dist/deamon/daemon.js status
 *   node <mythgram>/dist/deamon/daemon.js logs [--lines N]
 *   node <mythgram>/dist/deamon/daemon.js install
 *   node <mythgram>/dist/deamon/daemon.js uninstall
 *
 * Workspace + data dir: the app runs in the directory where `mythgram` was started
 * (or MYTHGRAM_WORKSPACE). Its ".mythgram" data dir — SQLite DB, logs, supervisor
 * state — is created there, so a single command keeps everything in one place.
 *   <workspace>/.mythgram/deamon/supervisor.pid
 *   <workspace>/.mythgram/deamon/supervisor.log
 *   <workspace>/.mythgram/deamon/app.log
 *   <workspace>/.mythgram/mythgram.db
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Mythgram package root (one level above dist/ or src/). */
const PACKAGE_DIR = path.resolve(HERE, "..", "..");
const SELF_ENTRY = fileURLToPath(import.meta.url);
const RUNNING_FROM_TS = SELF_ENTRY.endsWith(".ts");
/** Compiled app entry (preferred) and the TypeScript source fallback for dev checkouts. */
const APP_ENTRY = path.join(PACKAGE_DIR, "dist", "index.js");
const APP_SRC_ENTRY = path.join(PACKAGE_DIR, "src", "index.ts");

/**
 * Directory `mythgram` was started in. This becomes the agent workspace, and its
 * ".mythgram" folder holds all runtime state.
 */
const WORKSPACE = process.env.MYTHGRAM_WORKSPACE?.trim() || process.cwd();

const DEAMON_DIR =
  process.env.MYTHGRAM_DEAMON_DIR?.trim() ||
  path.join(WORKSPACE, ".mythgram", "deamon");
const PID_FILE = path.join(DEAMON_DIR, "supervisor.pid");
const SUPERVISOR_LOG = path.join(DEAMON_DIR, "supervisor.log");
const APP_LOG = path.join(DEAMON_DIR, "app.log");

const BACKEND_PORT = Number(process.env.PORT ?? 8787);
const SERVICE_NAME = "mythgram";

const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const HEALTH_INTERVAL_MS = 15000;
const HEALTH_FAIL_LIMIT = 3;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function logLine(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    ensureDir(DEAMON_DIR);
    fs.appendFileSync(SUPERVISOR_LOG, line);
  } catch {
    // best effort
  }
  process.stdout.write(line);
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  ensureDir(DEAMON_DIR);
  fs.writeFileSync(PID_FILE, `${pid}\n`);
}

function removePid(): void {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    // ignore
  }
}

function resolveTsx(): string {
  const candidates = [path.join(PACKAGE_DIR, "node_modules", ".bin", "tsx")];
  for (const bin of candidates) {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch {
      // try next
    }
  }
  return "tsx";
}

/** Absolute command + args used to launch the unified app (node dist, or tsx src in dev). */
function appCommand(): { command: string; args: string[] } {
  if (fs.existsSync(APP_ENTRY)) {
    return { command: process.execPath, args: [APP_ENTRY] };
  }
  return { command: resolveTsx(), args: [APP_SRC_ENTRY] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetOk(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

interface Supervised {
  child: ChildProcess | null;
  restarts: number;
  lastStart: number;
  consecutiveHealthFails: number;
}

function spawnApp(s: Supervised, shuttingDown: () => boolean): void {
  ensureDir(DEAMON_DIR);
  ensureDir(path.join(WORKSPACE, ".mythgram"));
  const { command, args } = appCommand();
  const out = fs.createWriteStream(APP_LOG, { flags: "a" });
  const child = spawn(command, args, {
    cwd: WORKSPACE,
    env: { ...process.env, MYTHGRAM_WORKSPACE: WORKSPACE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.child = child;
  s.lastStart = Date.now();
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  logLine(`[deamon] app started (pid ${child.pid}) in ${WORKSPACE}`);
  child.on("exit", (code, signal) => {
    s.child = null;
    if (shuttingDown()) return;
    const healthyFor = Date.now() - s.lastStart;
    if (healthyFor > 60000) s.restarts = 0;
    const backoff =
      RESTART_BACKOFF_MS[Math.min(s.restarts, RESTART_BACKOFF_MS.length - 1)] ??
      30000;
    s.restarts += 1;
    logLine(
      `[deamon] app exited (code ${code}, signal ${signal}). Restarting in ${backoff}ms (attempt ${s.restarts}).`,
    );
    setTimeout(() => {
      if (!shuttingDown()) spawnApp(s, shuttingDown);
    }, backoff).unref?.();
  });
}

export async function supervise(): Promise<void> {
  ensureDir(DEAMON_DIR);
  if (readPid() !== null && readPid() !== process.pid) {
    logLine("[deamon] another supervisor is already running. Exiting.");
    process.exit(1);
  }
  writePid(process.pid);
  logLine(
    `[deamon] supervisor started (pid ${process.pid}). Workspace: ${WORKSPACE}, package: ${PACKAGE_DIR}`,
  );

  let down = false;
  const isDown = () => down;
  const app: Supervised = {
    child: null,
    restarts: 0,
    lastStart: 0,
    consecutiveHealthFails: 0,
  };

  const shutdown = (signal: string) => {
    if (down) return;
    down = true;
    logLine(`[deamon] supervisor received ${signal}. Stopping the app...`);
    try {
      app.child?.kill("SIGTERM");
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (app.child && !app.child.killed) app.child.kill("SIGKILL");
      } catch {
        // ignore
      }
      removePid();
      logLine("[deamon] supervisor stopped.");
      process.exit(0);
    }, 5000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  spawnApp(app, isDown);

  const healthTimer = setInterval(() => {
    if (down) return;
    void (async () => {
      const ok = await httpGetOk(`http://localhost:${BACKEND_PORT}/health`);
      if (ok) {
        app.consecutiveHealthFails = 0;
        return;
      }
      app.consecutiveHealthFails += 1;
      logLine(
        `[deamon] health check failed (${app.consecutiveHealthFails}/${HEALTH_FAIL_LIMIT}).`,
      );
      if (app.consecutiveHealthFails >= HEALTH_FAIL_LIMIT && app.child) {
        logLine("[deamon] app unhealthy — restarting it.");
        try {
          app.child.kill("SIGTERM");
        } catch {
          // exit handler restarts it
        }
        app.consecutiveHealthFails = 0;
      }
    })();
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref?.();

  await new Promise(() => {
    // run forever until a signal arrives
  });
}

export function cmdStart(foreground: boolean): void {
  ensureDir(DEAMON_DIR);
  const existing = readPid();
  if (existing !== null) {
    process.stdout.write(`[deamon] already running (supervisor pid ${existing}).\n`);
    return;
  }
  if (foreground) {
    void supervise();
    return;
  }
  const command = RUNNING_FROM_TS ? resolveTsx() : process.execPath;
  const child = spawn(command, [SELF_ENTRY, "start", "--foreground"], {
    cwd: WORKSPACE,
    env: { ...process.env, MYTHGRAM_WORKSPACE: WORKSPACE },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  process.stdout.write(`[deamon] starting supervisor (pid ${child.pid})...\n`);
  const deadline = Date.now() + 10000;
  const wait = () => {
    const pid = readPid();
    if (pid !== null) {
      process.stdout.write(`[deamon] supervisor running (pid ${pid}). Logs: ${SUPERVISOR_LOG}\n`);
      return;
    }
    if (Date.now() > deadline) {
      process.stdout.write("[deamon] supervisor did not write a pid file in time. Check supervisor.log.\n");
      process.exit(1);
    }
    setTimeout(wait, 200);
  };
  wait();
}

export async function cmdStop(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    process.stdout.write("[deamon] not running (no pid file).\n");
    return;
  }
  process.stdout.write(`[deamon] stopping supervisor ${pid}...\n`);
  try {
    if (process.platform === "win32") {
      process.kill(pid, "SIGTERM");
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (readPid() === null) {
      try {
        process.kill(pid, 0);
        await sleep(300);
        continue;
      } catch {
        removePid();
        process.stdout.write("[deamon] stopped.\n");
        return;
      }
    }
    await sleep(300);
  }
  try {
    if (process.platform === "win32") process.kill(pid, "SIGKILL");
    else process.kill(-pid, "SIGKILL");
  } catch {
    // ignore
  }
  removePid();
  process.stdout.write("[deamon] force-stopped.\n");
}

export async function cmdStatus(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    process.stdout.write("[deamon] supervisor: NOT RUNNING\n");
  } else {
    process.stdout.write(`[deamon] supervisor: RUNNING (pid ${pid})\n`);
  }
  const ok = await httpGetOk(`http://localhost:${BACKEND_PORT}/health`);
  process.stdout.write(
    `[deamon] app :${BACKEND_PORT}: ${ok ? "HEALTHY" : "DOWN"}\n`,
  );
  process.stdout.write(`[deamon] workspace: ${WORKSPACE}\n`);
  process.stdout.write(`[deamon] logs: ${SUPERVISOR_LOG}, ${APP_LOG}\n`);
  if (pid === null || !ok) process.exitCode = 1;
}

export function cmdLogs(lines: number): void {
  for (const file of [SUPERVISOR_LOG, APP_LOG]) {
    process.stdout.write(`\n===== ${file} (last ${lines} lines) =====\n`);
    try {
      const content = fs.readFileSync(file, "utf8").split("\n");
      process.stdout.write(`${content.slice(-lines).join("\n")}\n`);
    } catch {
      process.stdout.write("(no log file yet)\n");
    }
  }
}

function hasSystemdUser(): boolean {
  if (process.platform !== "linux") return false;
  try {
    execSync("systemctl --user status", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    // systemctl exists but no user bus (e.g. containers) -> treat as unavailable
    try {
      execSync("systemctl --version", { stdio: "ignore", timeout: 5000 });
      execSync("test -d /run/systemd/system", { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

export function cmdInstall(): void {
  ensureDir(DEAMON_DIR);
  const command = RUNNING_FROM_TS ? resolveTsx() : process.execPath;
  const execStart = `${command} ${SELF_ENTRY} start --foreground`;
  if (hasSystemdUser()) {
    const unitPath = systemdUnitPath();
    ensureDir(path.dirname(unitPath));
    const unit = [
      "[Unit]",
      "Description=Mythgram background deamon (unified API + web console supervisor)",
      "After=network.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${WORKSPACE}`,
      `Environment=MYTHGRAM_WORKSPACE=${WORKSPACE}`,
      `ExecStart=${execStart}`,
      "Restart=always",
      "RestartSec=5",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n");
    fs.writeFileSync(unitPath, unit);
    process.stdout.write(`[deamon] wrote systemd unit: ${unitPath}\n`);
    try {
      execSync("systemctl --user daemon-reload", { stdio: "inherit" });
      execSync(`systemctl --user enable --now ${SERVICE_NAME}`, { stdio: "inherit" });
      process.stdout.write("[deamon] systemd service enabled and started.\n");
    } catch (error) {
      process.stdout.write(`[deamon] systemd enable failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.stdout.write("[deamon] falling back to direct start.\n");
      cmdStart(false);
      return;
    }
  } else {
    // No systemd user bus (containers, minimal installs): persist via cron @reboot
    // and start the supervisor right now (detached, survives shell exit).
    try {
      const entry = `@reboot cd '${WORKSPACE}' && '${command}' '${SELF_ENTRY}' start`;
      let current = "";
      try {
        current = execSync("crontab -l", { encoding: "utf8", timeout: 5000 });
      } catch {
        current = "";
      }
      if (!current.includes(`${SELF_ENTRY} start`)) {
        const next = `${current.replace(/\n?$/, "\n")}${entry}\n`;
        execSync("crontab -", { input: next, timeout: 5000 });
        process.stdout.write("[deamon] added cron @reboot entry.\n");
      } else {
        process.stdout.write("[deamon] cron @reboot entry already present.\n");
      }
    } catch (error) {
      process.stdout.write(
        `[deamon] cron setup skipped: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    cmdStart(false);
    return;
  }
  // When systemd manages the supervisor, also make sure it is running now.
  const pid = readPid();
  if (pid === null) cmdStart(false);
}

export function cmdUninstall(): void {
  void cmdStop().then(() => {
    if (hasSystemdUser()) {
      try {
        execSync(`systemctl --user disable --now ${SERVICE_NAME}`, { stdio: "inherit" });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(systemdUnitPath(), { force: true });
        execSync("systemctl --user daemon-reload", { stdio: "ignore" });
      } catch {
        // ignore
      }
    }
    try {
      const current = execSync("crontab -l", { encoding: "utf8", timeout: 5000 });
      const filtered = current
        .split("\n")
        .filter((line) => !line.includes(`${SELF_ENTRY} start`))
        .join("\n");
      execSync("crontab -", { input: filtered, timeout: 5000 });
    } catch {
      // no crontab or removal failed — ignore
    }
    process.stdout.write("[deamon] uninstalled autostart entries.\n");
  });
}

export function printHelp(): void {
  process.stdout.write(
    [
      "mythgram deamon — run the app forever in the background",
      "",
      "  start [--foreground]   start the supervisor (daemonized by default)",
      "  stop                   stop the supervisor and the app",
      "  restart                restart",
      "  status                 supervisor + app status",
      "  logs [--lines N]       tail supervisor/app logs",
      "  install                install autostart (systemd or cron) and start now",
      "  uninstall              stop and remove autostart entries",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "start":
      cmdStart(rest.includes("--foreground"));
      break;
    case "stop":
      await cmdStop();
      break;
    case "restart":
      await cmdStop();
      cmdStart(rest.includes("--foreground"));
      break;
    case "status":
      await cmdStatus();
      break;
    case "logs": {
      const idx = rest.indexOf("--lines");
      const lines = idx >= 0 ? Number(rest[idx + 1]) || 80 : 80;
      cmdLogs(lines);
      break;
    }
    case "install":
      cmdInstall();
      break;
    case "uninstall":
      cmdUninstall();
      break;
    default:
      printHelp();
      if (command !== undefined) process.exitCode = 1;
      break;
  }
}

/** True when this module is the process entrypoint (direct `node dist/deamon/daemon.js`). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) void main();
