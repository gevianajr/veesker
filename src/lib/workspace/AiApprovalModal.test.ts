// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

// vi.hoisted ensures these run before module resolution so vi.mock factories can reference them.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  aiApprovalResolve: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
}));

// Mock @tauri-apps/api/core so workspace.ts doesn't crash in jsdom.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

// Mock aiApprovalResolve from $lib/workspace — verify call args without Tauri IPC.
vi.mock("$lib/workspace", async (importOriginal) => {
  const mod = await importOriginal<typeof import("$lib/workspace")>();
  return {
    ...mod,
    aiApprovalResolve: mocks.aiApprovalResolve,
  };
});

import AiApprovalModal from "./AiApprovalModal.svelte";
import { aiApproval } from "$lib/stores/ai-approval.svelte";

const sampleRequest = {
  requestId: "req-001",
  tool: "execute_sql",
  input: { sql: "SELECT * FROM employees" },
};

beforeEach(() => {
  aiApproval.reset();
  mocks.aiApprovalResolve.mockReset();
  mocks.aiApprovalResolve.mockResolvedValue({ ok: true, data: undefined });
  mocks.invoke.mockReset();
});

describe("AiApprovalModal", () => {
  it("renders nothing when aiApproval.current is null", () => {
    render(AiApprovalModal);
    expect(screen.queryByRole("document")).toBeNull();
  });

  it("renders tool name and pretty-printed input when current is set", async () => {
    aiApproval.enqueue(sampleRequest);
    render(AiApprovalModal);
    await tick();
    // Tool name appears in both the title and the "allow this turn" label.
    const toolElements = screen.getAllByText(/execute_sql/);
    expect(toolElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/"SELECT \* FROM employees"/)).toBeInTheDocument();
  });

  it("clicking Approve calls aiApprovalResolve(requestId, true, false) and dequeues", async () => {
    aiApproval.enqueue(sampleRequest);
    render(AiApprovalModal);
    await tick();
    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await fireEvent.click(approveBtn);
    await tick();
    expect(mocks.aiApprovalResolve).toHaveBeenCalledWith("req-001", true, false);
    expect(aiApproval.current).toBeNull();
  });

  it("clicking Deny calls aiApprovalResolve(requestId, false, false) and dequeues", async () => {
    aiApproval.enqueue(sampleRequest);
    render(AiApprovalModal);
    await tick();
    const denyBtn = screen.getByRole("button", { name: /deny/i });
    await fireEvent.click(denyBtn);
    await tick();
    expect(mocks.aiApprovalResolve).toHaveBeenCalledWith("req-001", false, false);
    expect(aiApproval.current).toBeNull();
  });

  it("Approve with applyToTurn=true passes true as third arg", async () => {
    aiApproval.enqueue(sampleRequest);
    render(AiApprovalModal);
    await tick();
    const checkbox = screen.getByRole("checkbox");
    await fireEvent.click(checkbox);
    await tick();
    const approveBtn = screen.getByRole("button", { name: /approve/i });
    await fireEvent.click(approveBtn);
    await tick();
    expect(mocks.aiApprovalResolve).toHaveBeenCalledWith("req-001", true, true);
  });

  it("shows pending badge when pendingCount > 1", async () => {
    aiApproval.enqueue(sampleRequest);
    aiApproval.enqueue({ requestId: "req-002", tool: "read_file", input: { path: "/tmp/x" } });
    render(AiApprovalModal);
    await tick();
    expect(screen.getByText(/2 pending/)).toBeInTheDocument();
  });
});
