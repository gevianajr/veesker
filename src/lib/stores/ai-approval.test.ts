import { describe, it, expect, beforeEach } from "vitest";
import { aiApproval } from "./ai-approval.svelte";

const makeReq = (requestId: string) => ({
  requestId,
  tool: "sql_execute",
  input: { sql: "SELECT 1 FROM DUAL" },
});

beforeEach(() => {
  aiApproval.reset();
});

describe("aiApproval store", () => {
  it("current is null and pendingCount is 0 when empty", () => {
    expect(aiApproval.current).toBeNull();
    expect(aiApproval.pendingCount).toBe(0);
  });

  it("enqueue with a fresh requestId adds it; current returns that request", () => {
    aiApproval.enqueue(makeReq("r-1"));
    expect(aiApproval.pendingCount).toBe(1);
    expect(aiApproval.current?.requestId).toBe("r-1");
    expect(aiApproval.current?.tool).toBe("sql_execute");
  });

  it("enqueue stamps receivedAtMs", () => {
    const before = Date.now();
    aiApproval.enqueue(makeReq("r-ts"));
    const after = Date.now();
    expect(aiApproval.current?.receivedAtMs).toBeGreaterThanOrEqual(before);
    expect(aiApproval.current?.receivedAtMs).toBeLessThanOrEqual(after);
  });

  it("multiple enqueues are FIFO — current is the first one until resolved", () => {
    aiApproval.enqueue(makeReq("r-1"));
    aiApproval.enqueue(makeReq("r-2"));
    aiApproval.enqueue(makeReq("r-3"));
    expect(aiApproval.pendingCount).toBe(3);
    expect(aiApproval.current?.requestId).toBe("r-1");
  });

  it("dedupe — enqueue same requestId twice keeps only one entry", () => {
    aiApproval.enqueue(makeReq("r-dup"));
    aiApproval.enqueue(makeReq("r-dup"));
    expect(aiApproval.pendingCount).toBe(1);
  });

  it("resolve removes the entry; next becomes current", () => {
    aiApproval.enqueue(makeReq("r-1"));
    aiApproval.enqueue(makeReq("r-2"));
    aiApproval.resolve("r-1");
    expect(aiApproval.pendingCount).toBe(1);
    expect(aiApproval.current?.requestId).toBe("r-2");
  });

  it("resolve for unknown id is a no-op", () => {
    aiApproval.enqueue(makeReq("r-1"));
    aiApproval.resolve("no-such-id");
    expect(aiApproval.pendingCount).toBe(1);
    expect(aiApproval.current?.requestId).toBe("r-1");
  });

  it("resolve last entry leaves current null", () => {
    aiApproval.enqueue(makeReq("r-1"));
    aiApproval.resolve("r-1");
    expect(aiApproval.current).toBeNull();
    expect(aiApproval.pendingCount).toBe(0);
  });

  it("reset clears the entire queue", () => {
    aiApproval.enqueue(makeReq("r-1"));
    aiApproval.enqueue(makeReq("r-2"));
    aiApproval.reset();
    expect(aiApproval.current).toBeNull();
    expect(aiApproval.pendingCount).toBe(0);
  });
});
