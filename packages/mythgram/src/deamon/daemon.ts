#!/usr/bin/env node
/**
 * Background deamon (supervisor) for the Mythgram application.
 *
 * Keeps the application running forever on the user's computer: it starts the
 * mythgram backend (Express + SQLite) and the frontend-main UI (Vite) as
 * supervised child processes, restarts them on crash with backoff, health
 * checks the backend, and writes everything to log files.
 *
 * NOTE: the folder is intentionally named `deamon` (project convention).
 *
 * Usage (from the mythgram package):
 *   npx tsx src/deamon/daemon.ts start [--foreground]  start (daemonized by default)
 *   npx tsx src/deamon/daemon.ts stop                  stop the supervisor + app
 *   npx tsx src/deamon/daemon.ts restart               restart
 *   npx tsx src/deamon/daemon.ts status                human-readable status
 *   npx tsx src/deamon/daemon.ts logs [--lines N]      tail the log files
 *   npx tsx src/deamon/daemon.ts install               install autostart + start now
 *   npx tsx src/deamon/daemon.ts uninstall             stop + remove autostart
 *
 * Data dir: $MYTHGRAM_DEAMON_DIR or <mythgram>/.mythgram/deamon — next to the
 * SQLite database, so everything is in one place.
 *   supervisor.pid   supervisor process id
 *   supervisor.log   supervisor's own log
 *   backend.log      mythgram backend output
 *   frontend.log     frontend-main output
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(HERE, "..", "..");
const REPO_ROOT = path.resolve(BACKEND_DIR, "..");
const FRONTEND_DIR = path.join(REPO_ROOT, "frontend-main");
const DAEMON_TS = path.join(HERE, "daemon.ts");

const DEAMON_DIR =
  process.env.MYTHGRAM_DEAMON_DIR?.trim() ||
  path.join(BACKEND_DIR, ".mythgram", "deamon");
const PID_FILE = path.join(DEAMON_DIR, "supervisor.pid");
const SUPERVISOR_LOG = path.join(DEAMON_DIR, "supervisor.log");
const BACKEND_LOG = path.join(DEAMON_DIR, "backend.log");
const FRONTEND_LOG = path.join(DEAMON_DIR, "frontend.log");

const BACKEND_PORT = Number(process.env.PORT ?? 8787);
const FRONTEND_PORT = Number(process.env.VITE_PORT ?? 5173);
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
  const candidates = [
    path.join(BACKEND_DIR, "node_modules", ".bin", "tsx"),
    path.join(FRONTEND_DIR, "node_modules", ".bin", "tsx"),
  ];
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
  name: "backend" | "frontend";
  child: ChildProcess | null;
  restarts: number;
  lastStart: number;
  consecutiveHealthFails: number;
  logFile: string;
}

function spawnApp(s: Supervised, shuttingDown: () => boolean): void {
  const cwd = s.name === "backend" ? BACKEND_DIR : FRONTEND_DIR;
  const args = s.name === "backend" ? ["run", "start"] : ["run", "dev"];
  ensureDir(DEAMON_DIR);
  const out = fs.createWriteStream(s.logFile, { flags: "a" });
  const child = spawn("npm", args, {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.child = child;
  s.lastStart = Date.now();
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  logLine(`[deamon] ${s.name} started (pid ${child.pid})`);
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
      `[deamon] ${s.name} exited (code ${code}, signal ${signal}). Restarting in ${backoff}ms (attempt ${s.restarts}).`,
    );
    setTimeout(() => {
      if (!shuttingDown()) spawnApp(s, shuttingDown);
    }, backoff).unref?.();
  });
}

async function supervise(): Promise<void> {
  ensureDir(DEAMON_DIR);
  if (readPid() !== null && readPid() !== process.pid) {
    logLine("[deamon] another supervisor is already running. Exiting.");
    process.exit(1);
  }
  writePid(process.pid);
  logLine(`[deamon] supervisor started (pid ${process.pid}). Backend: ${BACKEND_DIR}, frontend: ${FRONTEND_DIR}`);

  let down = false;
  const isDown = () => down;
  const backend: Supervised = {
    name: "backend",
    child: null,
    restarts: 0,
    lastStart: 0,
    consecutiveHealthFails: 0,
    logFile: BACKEND_LOG,
  };
  const frontend: Supervised = {
    name: "frontend",
    child: null,
    restarts: 0,
    lastStart: 0,
    consecutiveHealthFails: 0,
    logFile: FRONTEND_LOG,
  };

  const shutdown = (signal: string) => {
    if (down) return;
    down = true;
    logLine(`[deamon] supervisor received ${signal}. Stopping children...`);
    for (const s of [backend, frontend]) {
      try {
        s.child?.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    setTimeout(() => {
      for (const s of [backend, frontend]) {
        try {
          if (s.child && !s.child.killed) s.child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      removePid();
      logLine("[deamon] supervisor stopped.");
      process.exit(0);
    }, 5000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  spawnApp(backend, isDown);
  spawnApp(frontend, isDown);

  const healthTimer = setInterval(() => {
    if (down) return;
    void (async () => {
      const backendOk = await httpGetOk(`http://localhost:${BACKEND_PORT}/health`);
      if (backendOk) {
        backend.consecutiveHealthFails = 0;
      } else {
        backend.consecutiveHealthFails += 1;
        logLine(
          `[deamon] backend health check failed (${backend.consecutiveHealthFails}/${HEALTH_FAIL_LIMIT}).`,
        );
        if (backend.consecutiveHealthFails >= HEALTH_FAIL_LIMIT && backend.child) {
          logLine("[deamon] backend unhealthy — restarting it.");
          try {
            backend.child.kill("SIGTERM");
          } catch {
            // exit handler restarts it
          }
          backend.consecutiveHealthFails = 0;
        }
      }
      const frontendOk = await httpGetOk(`http://localhost:${FRONTEND_PORT}/`);
      if (frontendOk) {
        frontend.consecutiveHealthFails = 0;
      } else {
        frontend.consecutiveHealthFails += 1;
        if (frontend.consecutiveHealthFails >= HEALTH_FAIL_LIMIT) {
          logLine(
            `[deamon] frontend not responding on :${FRONTEND_PORT} (${frontend.consecutiveHealthFails} checks). Leaving it to Vite; restart with 'restart' if needed.`,
          );
          frontend.consecutiveHealthFails = 0;
        }
      }
    })();
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref?.();

  await new Promise(() => {
    // run forever until a signal arrives
  });
}

function cmdStart(foreground: boolean): void {
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
  const tsx = resolveTsx();
  const child = spawn(tsx, [DAEMON_TS, "start", "--foreground"], {
    cwd: REPO_ROOT,
    env: { ...process.env },
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

async function cmdStop(): Promise<void> {
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

async function cmdStatus(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    process.stdout.write("[deamon] supervisor: NOT RUNNING\n");
  } else {
    process.stdout.write(`[deamon] supervisor: RUNNING (pid ${pid})\n`);
  }
  const backendOk = await httpGetOk(`http://localhost:${BACKEND_PORT}/health`);
  process.stdout.write(
    `[deamon] backend :${BACKEND_PORT}: ${backendOk ? "HEALTHY" : "DOWN"}\n`,
  );
  const frontendOk = await httpGetOk(`http://localhost:${FRONTEND_PORT}/`);
  process.stdout.write(
    `[deamon] frontend :${FRONTEND_PORT}: ${frontendOk ? "UP" : "DOWN"}\n`,
  );
  process.stdout.write(`[deamon] logs: ${SUPERVISOR_LOG}, ${BACKEND_LOG}, ${FRONTEND_LOG}\n`);
  if (pid === null || !backendOk) process.exitCode = 1;
}

function cmdLogs(lines: number): void {
  for (const file of [SUPERVISOR_LOG, BACKEND_LOG, FRONTEND_LOG]) {
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

function cmdInstall(): void {
  ensureDir(DEAMON_DIR);
  const tsx = resolveTsx();
  const tsxAbs = path.isAbsolute(tsx) ? tsx : "tsx";
  if (hasSystemdUser()) {
    const unitPath = systemdUnitPath();
    ensureDir(path.dirname(unitPath));
    const unit = [
      "[Unit]",
      "Description=Mythgram background deamon (backend + frontend supervisor)",
      "After=network.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${REPO_ROOT}`,
      `ExecStart=${tsxAbs} ${DAEMON_TS} start --foreground`,
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
      const entry = `@reboot ${tsxAbs} ${DAEMON_TS} start`;
      let current = "";
      try {
        current = execSync("crontab -l", { encoding: "utf8", timeout: 5000 });
      } catch {
        current = "";
      }
      if (!current.includes(`${DAEMON_TS} start`)) {
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

function cmdUninstall(): void {
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
        .filter((line) => !line.includes(`${DAEMON_TS} start`))
        .join("\n");
      execSync("crontab -", { input: filtered, timeout: 5000 });
    } catch {
      // no crontab or removal failed — ignore
    }
    process.stdout.write("[deamon] uninstalled autostart entries.\n");
  });
}

function printHelp(): void {
  process.stdout.write(
    [
      "mythgram deamon — run the app forever in the background",
      "",
      "  start [--foreground]   start the supervisor (daemonized by default)",
      "  stop                   stop the supervisor and the app",
      "  restart                restart",
      "  status                 supervisor + backend + frontend status",
      "  logs [--lines N]       tail supervisor/backend/frontend logs",
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

void main();
