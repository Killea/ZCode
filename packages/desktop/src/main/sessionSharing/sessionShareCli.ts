import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePlatformKeyForPackagedApp } from "../../../scripts/target-platform.mjs";

const CLI_MAX_OUTPUT_CHARS = 2 * 1024 * 1024;
const CLI_DEFAULT_TIMEOUT_MS = 120_000;

export interface SessionShareCliResult {
  json: unknown;
  stdout: string;
  stderr: string;
}

export class SessionShareCliError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, options: { stderr?: string; exitCode?: number | null } = {}) {
    super(message);
    this.name = "SessionShareCliError";
    this.stderr = options.stderr ?? "";
    this.exitCode = options.exitCode ?? null;
  }
}

export function resolveSessionShareCliPath(): string {
  const platformKey = resolvePlatformKeyForPackagedApp();
  const candidates = [
    // 打包态优先使用随包 resources/glm/zcode.cjs。
    typeof process.resourcesPath === "string"
      ? join(process.resourcesPath, "glm", "zcode.cjs")
      : null,
    // 本机开发/调试优先使用仓库内最新 CLI dist，避免读到旧的 bundled-agents 副本。
    join(process.cwd(), "apps", "zcode-cli", "packages", "cli", "dist", "zcode.cjs"),
    join(process.cwd(), "../../apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    join(import.meta.dirname, "../../../../apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    join(import.meta.dirname, "../../../../../apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    join(process.cwd(), "packages", "desktop", "bundled-agents", platformKey, "glm", "zcode.cjs"),
    join(process.cwd(), "bundled-agents", platformKey, "glm", "zcode.cjs"),
    join(import.meta.dirname, "../../../bundled-agents", platformKey, "glm", "zcode.cjs"),
    join(homedir(), ".zcode", "server", "agents", "glm", "zcode.cjs"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new SessionShareCliError(
      `ZCode CLI bundle not found for session sharing. Tried:\n${candidates.join("\n")}`,
    );
  }
  return found;
}

export function runSessionShareCli(
  args: string[],
  cwd: string,
  timeoutMs = CLI_DEFAULT_TIMEOUT_MS,
): Promise<SessionShareCliResult> {
  const cliPath = resolveSessionShareCliPath();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new SessionShareCliError(`Session share CLI timed out after ${timeoutMs}ms`, { stderr }),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SessionShareCliError(error.message, { stderr }));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(
          new SessionShareCliError(
            stderr.trim() || stdout.trim() || `Session share CLI exited with code ${exitCode}`,
            { stderr, exitCode },
          ),
        );
        return;
      }
      const line = stdout
        .trim()
        .split("\n")
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .at(-1);
      if (!line) {
        reject(
          new SessionShareCliError("Session share CLI returned no JSON", { stderr, exitCode }),
        );
        return;
      }
      try {
        resolve({ json: JSON.parse(line) as unknown, stdout, stderr });
      } catch {
        reject(
          new SessionShareCliError("Session share CLI returned invalid JSON", {
            stderr,
            exitCode,
          }),
        );
      }
    });
  });
}

function appendBounded(current: string, chunk: string): string {
  if (current.length >= CLI_MAX_OUTPUT_CHARS) return current;
  return (current + chunk).slice(0, CLI_MAX_OUTPUT_CHARS);
}
