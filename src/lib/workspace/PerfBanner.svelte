<script lang="ts">
  import type { AnalysisState } from "$lib/stores/perf-analyzer.svelte";

  type Props = {
    state: AnalysisState;
    onWhySlow: () => void;
    enabled: boolean;
    onToggleEnabled: () => void;
  };
  let { state, onWhySlow, enabled, onToggleEnabled }: Props = $props();

  let criticalCount = $derived(
    state.kind === "analyzed" ? state.redFlags.filter((f) => f.severity === "critical").length : 0,
  );
  let warnCount = $derived(
    state.kind === "analyzed" ? state.redFlags.filter((f) => f.severity === "warn").length : 0,
  );
  let totalFlags = $derived(state.kind === "analyzed" ? state.redFlags.length : 0);
  let staleCount = $derived(state.kind === "analyzed" ? state.staleStats.length : 0);
</script>

<div class="perf-banner">
  {#if state.kind === "analyzing"}
    <span class="spinner" aria-hidden="true"></span>
    <span class="dim">Analyzing…</span>
  {:else if state.kind === "analyzed"}
    <span class="cost cost-{state.costClass}" title="Estimated cost: {state.plan[0]?.cost?.toLocaleString('en-US') ?? 'unknown'}">
      ● {state.costClass.toUpperCase()}
    </span>
    {#if criticalCount > 0}
      <span class="badge badge-critical">{criticalCount} critical</span>
    {/if}
    {#if warnCount > 0}
      <span class="badge badge-warn">{warnCount} warning{warnCount > 1 ? "s" : ""}</span>
    {/if}
    {#if staleCount > 0}
      <span class="badge badge-stale" title={state.staleStats.map((s) => `${s.table}: ${s.ageDays ?? "?"} days`).join(", ")}>
        ⚠ {staleCount} stale
      </span>
    {/if}
    {#if totalFlags > 0}
      <button class="why-slow" onclick={onWhySlow}>Why Slow?</button>
    {/if}
  {:else if state.kind === "error"}
    <span class="err" title={state.message}>
      {state.oraCode ?? "Analysis error"}: {state.message.slice(0, 72)}{state.message.length > 72 ? "…" : ""}
    </span>
  {:else if state.kind === "skipped" && (state.reason === "ddl" || state.reason === "plsql")}
    <span class="dim">{state.reason === "ddl" ? "DDL" : "PL/SQL"} — no analysis</span>
  {/if}
  <div class="push"></div>
  <button
    class="toggle"
    class:off={!enabled}
    onclick={onToggleEnabled}
    title={enabled ? "Disable auto-analysis" : "Enable auto-analysis"}
  >⚡ {enabled ? "Auto" : "Off"}</button>
</div>

<style>
  .perf-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 24px;
    padding: 0 0.6rem;
    background: var(--bg-page);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    overflow: hidden;
  }
  .push { flex: 1 1 auto; }

  .spinner {
    width: 8px; height: 8px;
    border: 1.5px solid rgba(255,255,255,0.12);
    border-top-color: rgba(255,255,255,0.5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .dim { color: rgba(255,255,255,0.3); }
  .err { color: #e74c3c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px; }

  .cost {
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .cost-green  { color: #7ec96a; }
  .cost-yellow { color: #f5be50; }
  .cost-red    { color: #e74c3c; }
  .cost-unknown{ color: rgba(255,255,255,0.3); }

  .badge {
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    white-space: nowrap;
  }
  .badge-critical { background: rgba(231,76,60,0.15); color: #e74c3c; }
  .badge-warn     { background: rgba(245,190,80,0.13); color: #f5be50; }
  .badge-stale    { background: rgba(255,165,0,0.13);  color: #f5a33a; }

  .why-slow {
    background: rgba(179,62,31,0.18);
    border: 1px solid rgba(179,62,31,0.4);
    border-radius: 3px;
    padding: 1px 7px;
    color: #f5a08a;
    font-size: 10px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  }
  .why-slow:hover { background: rgba(179,62,31,0.32); }

  .toggle {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.3);
    font-size: 10px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 3px;
    white-space: nowrap;
    transition: color 0.1s;
    flex-shrink: 0;
  }
  .toggle:hover { color: rgba(255,255,255,0.7); }
  .toggle.off { color: rgba(255,255,255,0.18); }
</style>
