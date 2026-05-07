<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  type Props = { lines: string[] };
  let { lines }: Props = $props();
</script>

<div class="output-tab">
  {#if lines.length === 0}
    <div class="placeholder">
      <div class="placeholder-icon">🔇</div>
      <div class="placeholder-text">No DBMS_OUTPUT for this execution</div>
      <div class="placeholder-hint">DBMS_OUTPUT is enabled for every session — run a PL/SQL block that calls <code>DBMS_OUTPUT.PUT_LINE</code> to see lines here.</div>
    </div>
  {:else}
    <pre class="output-pre">{lines.join("\n")}</pre>
  {/if}
</div>

<style>
  .output-tab { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); padding: 40px; text-align: center; }
  .placeholder-icon { font-size: 32px; opacity: 0.5; }
  .placeholder-text { font-size: 13px; }
  .placeholder-hint { font-size: 11px; max-width: 420px; line-height: 1.5; }
  .placeholder-hint code { background: var(--bg-surface-alt); padding: 1px 5px; border-radius: 3px; font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 10px; }
  .output-pre {
    flex: 1; overflow-y: auto; margin: 0; padding: 12px 16px;
    background: var(--bg-surface-alt); border: 1px solid var(--border); border-radius: 4px;
    font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 12px;
    color: var(--text-primary); white-space: pre-wrap; word-break: break-word;
  }
</style>
