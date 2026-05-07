import { describe, it, expect, beforeEach } from "vitest";
import { fetchProgress } from "./fetch-progress.svelte";

beforeEach(() => {
  fetchProgress.reset();
});

describe("fetchProgress store", () => {
  it("initial state has all zeros and isStreaming false", () => {
    expect(fetchProgress.activeRequestId).toBeNull();
    expect(fetchProgress.rowsFetched).toBe(0);
    expect(fetchProgress.elapsedMs).toBe(0);
    expect(fetchProgress.isStreaming).toBe(false);
  });

  it("start sets activeRequestId, resets counters, sets isStreaming true", () => {
    fetchProgress.start("req-1");
    expect(fetchProgress.activeRequestId).toBe("req-1");
    expect(fetchProgress.rowsFetched).toBe(0);
    expect(fetchProgress.elapsedMs).toBe(0);
    expect(fetchProgress.isStreaming).toBe(true);
  });

  it("start resets counters even when a previous run had progress", () => {
    fetchProgress.start("req-0");
    fetchProgress.update({ requestId: "req-0", rowsFetched: 500, elapsedMs: 100 });
    fetchProgress.start("req-1");
    expect(fetchProgress.rowsFetched).toBe(0);
    expect(fetchProgress.elapsedMs).toBe(0);
  });

  it("update applies counters for the active requestId", () => {
    fetchProgress.start("req-1");
    fetchProgress.update({ requestId: "req-1", rowsFetched: 200, elapsedMs: 50 });
    expect(fetchProgress.rowsFetched).toBe(200);
    expect(fetchProgress.elapsedMs).toBe(50);
  });

  it("update for a different requestId is ignored", () => {
    fetchProgress.start("req-1");
    fetchProgress.update({ requestId: "req-stale", rowsFetched: 999, elapsedMs: 999 });
    expect(fetchProgress.rowsFetched).toBe(0);
    expect(fetchProgress.elapsedMs).toBe(0);
  });

  it("stop clears isStreaming but keeps counters", () => {
    fetchProgress.start("req-1");
    fetchProgress.update({ requestId: "req-1", rowsFetched: 150, elapsedMs: 30 });
    fetchProgress.stop();
    expect(fetchProgress.isStreaming).toBe(false);
    expect(fetchProgress.rowsFetched).toBe(150);
    expect(fetchProgress.elapsedMs).toBe(30);
    expect(fetchProgress.activeRequestId).toBe("req-1");
  });

  it("reset clears everything", () => {
    fetchProgress.start("req-1");
    fetchProgress.update({ requestId: "req-1", rowsFetched: 100, elapsedMs: 20 });
    fetchProgress.reset();
    expect(fetchProgress.activeRequestId).toBeNull();
    expect(fetchProgress.rowsFetched).toBe(0);
    expect(fetchProgress.elapsedMs).toBe(0);
    expect(fetchProgress.isStreaming).toBe(false);
  });
});
