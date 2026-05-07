import { describe, it, expect, beforeEach, vi } from "vitest";
import { resultPanel } from "./result-panel.svelte";

beforeEach(() => {
  localStorage.clear();
  resultPanel.setTab("results");
});

describe("resultPanel store", () => {
  it("default tab is results", () => {
    expect(resultPanel.activeTab).toBe("results");
  });

  it("setTab('plan') updates activeTab", () => {
    resultPanel.setTab("plan");
    expect(resultPanel.activeTab).toBe("plan");
  });

  it("setTab('output') updates activeTab", () => {
    resultPanel.setTab("output");
    expect(resultPanel.activeTab).toBe("output");
  });

  it("setTab('results') sets activeTab back to results", () => {
    resultPanel.setTab("plan");
    resultPanel.setTab("results");
    expect(resultPanel.activeTab).toBe("results");
  });

  it("setTab writes to localStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    resultPanel.setTab("plan");
    expect(spy).toHaveBeenCalledWith("resultPanel.tab", "plan");
    spy.mockRestore();
  });

  it("setTab('output') writes correct key to localStorage", () => {
    resultPanel.setTab("output");
    expect(localStorage.getItem("resultPanel.tab")).toBe("output");
  });
});
