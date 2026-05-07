<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import { fetchProgress } from "$lib/stores/fetch-progress.svelte";

  let formattedRows = $derived(fetchProgress.rowsFetched.toLocaleString());
  let formattedSeconds = $derived(
    fetchProgress.elapsedMs >= 1000
      ? `${(fetchProgress.elapsedMs / 1000).toFixed(1)}s`
      : `${fetchProgress.elapsedMs}ms`
  );
</script>

{#if fetchProgress.isStreaming}
  <div class="fetch-progress" role="status" aria-live="polite">
    <span class="dot"></span>
    <span class="label">Streaming…</span>
    <span class="rows">{formattedRows} rows</span>
    <span class="elapsed">({formattedSeconds})</span>
  </div>
{/if}

<style>
  .fetch-progress {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 12px;
    background: rgba(122, 168, 196, 0.12);
    border-bottom: 1px solid var(--border);
    font-size: 11px; color: var(--text-muted);
    font-family: "JetBrains Mono", "SF Mono", monospace;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #7aa8c4; flex-shrink: 0;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .label { font-weight: 600; }
  .rows { color: var(--text-primary); font-weight: 600; }
  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
</style>
