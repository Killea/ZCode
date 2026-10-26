import { describe, expect, it } from "vitest";
import { userInputRowSchema } from "../src/zcode-protocol-v4/index.js";

const base = {
  rowId: 1,
  entityId: "message-1",
  turnId: "turn-1",
  createdAt: 1_700_000_000_000,
  createdAtSeq: 1,
  kind: "userInput" as const,
  origin: "realUser" as const,
  text: "Remember the project conventions",
};

describe("v4 userInput.includedGlobalMemoryIds", () => {
  it("accepts ordered memory ids in the same shape as the send command", () => {
    expect(
      userInputRowSchema.parse({
        ...base,
        includedGlobalMemoryIds: ["default", "code-style"],
      }).includedGlobalMemoryIds,
    ).toEqual(["default", "code-style"]);
    expect(userInputRowSchema.parse(base)).not.toHaveProperty("includedGlobalMemoryIds");
  });

  it("rejects ids outside the slug pattern and more than four entries", () => {
    expect(
      userInputRowSchema.safeParse({ ...base, includedGlobalMemoryIds: ["../escape"] }).success,
    ).toBe(false);
    expect(
      userInputRowSchema.safeParse({
        ...base,
        includedGlobalMemoryIds: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
  });
});
