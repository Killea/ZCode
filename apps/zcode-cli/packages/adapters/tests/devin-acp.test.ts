import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import type { ModelInputMessage } from "@zcode/contracts";
import {
  extractForwardableContext,
  flattenTranscriptForNewSession,
} from "../src/model/devin-acp/context-filter.js";
import { AcpTransport } from "../src/model/devin-acp/transport.js";

const system = (text: string): ModelInputMessage => ({ role: "system", content: text });
const user = (text: string): ModelInputMessage => ({ role: "user", content: text });
const assistant = (text: string): ModelInputMessage => ({ role: "assistant", content: text });

describe("extractForwardableContext", () => {
  const messages: ModelInputMessage[] = [
    system(
      [
        "# Harness\nYou are ZCode agent. Use the following tools.",
        "# Global Memory\n用户偏好中文回答。",
        "# Environment\nworkspace=/tmp/proj",
        "# Communicating with the user\nUse Read tool first.",
      ].join("\n\n"),
    ),
    user("hello"),
  ];

  it("memory-only 只转发白名单段", () => {
    const result = extractForwardableContext(messages, "memory-only");
    expect(result).toContain("# Global Memory");
    expect(result).toContain("用户偏好中文回答");
    expect(result).toContain("# Environment");
    expect(result).not.toContain("ZCode agent");
    expect(result).not.toContain("Use Read tool");
  });

  it("none 返回空串", () => {
    expect(extractForwardableContext(messages, "none")).toBe("");
  });

  it("all-dynamic 原样转发全部 system 文本", () => {
    const result = extractForwardableContext(messages, "all-dynamic");
    expect(result).toContain("ZCode agent");
    expect(result).toContain("Global Memory");
  });

  it("忽略非 system 消息", () => {
    const result = extractForwardableContext(
      [user("# Global Memory\nfake")],
      "memory-only",
    );
    expect(result).toBe("");
  });
});

describe("flattenTranscriptForNewSession", () => {
  it("按角色序列化历史并跳过 system", () => {
    const transcript = flattenTranscriptForNewSession([
      system("# Global Memory\nnote"),
      user("任务 A"),
      assistant("已完成 A"),
    ]);
    expect(transcript).toContain("user: 任务 A");
    expect(transcript).toContain("assistant: 已完成 A");
    expect(transcript).not.toContain("Global Memory");
    expect(transcript).toContain("此前的对话记录");
  });

  it("tool 消息只保留状态行", () => {
    const hugeOutput = "x".repeat(50_000);
    const transcript = flattenTranscriptForNewSession([
      {
        role: "tool",
        toolName: "Read",
        toolCallId: "t1",
        content: hugeOutput,
      },
    ]);
    expect(transcript).toContain("tool Read");
    expect(transcript.length).toBeLessThan(1000);
  });
});

describe("AcpTransport", () => {
  function fakeProcess() {
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stdin,
      stderr,
      kill: vi.fn(),
      pid: 1,
    });
    return proc;
  }

  async function makeTransport(proc: ReturnType<typeof fakeProcess>) {
    const { spawn } = await import("node:child_process");
    (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
    return new AcpTransport({ command: "devin", args: ["acp"], cwd: "/tmp" });
  }

  it("request/response 按 id 配对", async () => {
    const proc = fakeProcess();
    const transport = await makeTransport(proc);
    const resultPromise = transport.request<{ ok: boolean }>("initialize", { v: 1 });
    const written = await new Promise<string>((resolve) =>
      proc.stdin.once("data", (chunk: Buffer) => resolve(chunk.toString())),
    );
    const frame = JSON.parse(written.trim());
    expect(frame.method).toBe("initialize");
    proc.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { ok: true } })}\n`);
    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it("notification 分发给 handler，reverse request 走 onRequest", async () => {
    const proc = fakeProcess();
    const transport = await makeTransport(proc);
    const updates: string[] = [];
    transport.onNotification((method, params) => {
      if (method === "session/update") updates.push(JSON.stringify(params));
    });
    transport.onRequest((method) =>
      Promise.resolve(
        method === "session/request_permission"
          ? { result: { outcome: { outcome: "cancelled" } } }
          : { error: { code: -32601, message: "unsupported" } },
      ),
    );
    proc.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1" } })}\n`,
    );
    proc.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "session/request_permission", params: {} })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(updates).toHaveLength(1);
    const reply = await new Promise<string>((resolve) =>
      proc.stdin.once("data", (chunk: Buffer) => resolve(chunk.toString())),
    );
    const frame = JSON.parse(reply.trim());
    expect(frame.id).toBe(9);
    expect(frame.result.outcome.outcome).toBe("cancelled");
  });

  it("进程退出时挂起请求全部 reject", async () => {
    const proc = fakeProcess();
    const transport = await makeTransport(proc);
    const pending = transport.request("session/prompt", {});
    proc.emit("exit", 1);
    await expect(pending).rejects.toThrow(/exited/);
  });
});
