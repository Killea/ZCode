// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const memoryService = vi.hoisted(() => ({ listGlobalMemories: vi.fn() }));

vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => ({ memoryService }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>): string => {
        if (id === "chat.memory.included.label") return `携带全局记忆（${values?.count ?? ""}）`;
        if (id === "chat.toolbar.memory.defaultName") return "默认";
        return id;
      },
    },
  }),
}));

import { GlobalMemoryChip } from "@/v4/composer/GlobalMemoryChip.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GlobalMemoryChip", () => {
  it("renders one chip and lists selected memory names in the hover card", async () => {
    memoryService.listGlobalMemories.mockResolvedValue([
      { id: "default", name: "default", chars: 0, updatedAt: null },
      { id: "code-style", name: "代码风格", chars: 120, updatedAt: null },
    ]);
    render(createElement(GlobalMemoryChip, { memoryIds: ["default", "code-style"] }));

    const trigger = screen.getByRole("button", { name: "携带全局记忆（2）" });
    expect(trigger.getAttribute("data-global-memory-count")).toBe("2");

    fireEvent.pointerEnter(trigger);
    expect(await screen.findByText("默认")).toBeTruthy();
    expect(await screen.findByText("代码风格")).toBeTruthy();
  });

  it("falls back to the id when a memory was deleted", async () => {
    memoryService.listGlobalMemories.mockResolvedValue([]);
    render(createElement(GlobalMemoryChip, { memoryIds: ["removed-memory"] }));

    fireEvent.pointerEnter(screen.getByRole("button", { name: "携带全局记忆（1）" }));
    expect(await screen.findByText("removed-memory")).toBeTruthy();
  });

  it("renders nothing and does not load names without a selection", () => {
    const { container } = render(createElement(GlobalMemoryChip, { memoryIds: [] }));
    expect(container.firstChild).toBeNull();
    expect(memoryService.listGlobalMemories).not.toHaveBeenCalled();
  });
});
