// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

export type ResultTab = "results" | "plan" | "output";

const STORAGE_KEY = "resultPanel.tab";
const VALID_TABS: readonly ResultTab[] = ["results", "plan", "output"];

function loadTab(): ResultTab {
  if (typeof localStorage === "undefined") return "results";
  const raw = localStorage.getItem(STORAGE_KEY);
  return VALID_TABS.includes(raw as ResultTab) ? (raw as ResultTab) : "results";
}

let _activeTab = $state<ResultTab>(loadTab());

export const resultPanel = {
  get activeTab() {
    return _activeTab;
  },
  setTab(t: ResultTab): void {
    _activeTab = t;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, t);
    }
  },
};
