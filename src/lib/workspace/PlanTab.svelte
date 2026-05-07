<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import type { ExplainNode } from "$lib/workspace";
  import ExplainPlan from "./ExplainPlan.svelte";

  type State =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string; onRetry?: () => void }
    | { kind: "ready"; nodes: ExplainNode[]; onExplainWithAI: (planText: string) => void };

  type Props = { state: State };
  let { state }: Props = $props();
</script>

<div class="plan-tab">
  {#if state.kind === "idle"}
    <div class="placeholder">
      <div class="placeholder-icon">📋</div>
      <div class="placeholder-text">Run a query to see its execution plan</div>
    </div>
  {:else if state.kind === "loading"}
    <div class="placeholder">
      <span class="spinner"></span>
      <div class="placeholder-text">Computing plan…</div>
    </div>
  {:else if state.kind === "error"}
    <div class="placeholder error">
      <div class="placeholder-icon">⚠️</div>
      <div class="placeholder-text">{state.message}</div>
      {#if state.onRetry}
        <button class="btn-retry" onclick={state.onRetry}>Retry</button>
      {/if}
    </div>
  {:else}
    <ExplainPlan
      nodes={state.nodes}
      onBack={() => {}}
      onExplainWithAI={state.onExplainWithAI}
    />
  {/if}
</div>

<style>
  .plan-tab { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); padding: 40px; }
  .placeholder-icon { font-size: 32px; opacity: 0.5; }
  .placeholder-text { font-size: 13px; }
  .placeholder.error .placeholder-text { color: #b33e1f; }
  .btn-retry { padding: 6px 14px; border-radius: 4px; background: var(--bg-surface-alt); border: 1px solid var(--border); color: var(--text-primary); font-size: 12px; cursor: pointer; }
  .btn-retry:hover { background: var(--bg-page); }
  .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--text-muted); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
