<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import { aiApproval } from "$lib/stores/ai-approval.svelte";
  import { aiApprovalResolve } from "$lib/workspace";

  const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

  let now = $state(Date.now());
  let applyToTurn = $state(false);
  let resolving = $state(false);

  $effect(() => {
    const id = setInterval(() => { now = Date.now(); }, 500);
    return () => clearInterval(id);
  });

  let current = $derived(aiApproval.current);

  // Reset checkbox whenever a new request becomes current.
  $effect(() => {
    current; // tracking dependency
    applyToTurn = false;
  });

  let remainingMs = $derived(
    current ? Math.max(0, APPROVAL_TIMEOUT_MS - (now - current.receivedAtMs)) : 0
  );
  let mm = $derived(Math.floor(remainingMs / 60000));
  let ss = $derived(Math.floor((remainingMs % 60000) / 1000));

  // When the timer runs out, the sidecar has already auto-denied and the
  // promise has resolved. Dequeue locally so the modal closes / advances.
  $effect(() => {
    if (current && remainingMs === 0) {
      aiApproval.resolve(current.requestId);
    }
  });

  let prettyInput = $derived(
    current ? JSON.stringify(current.input, null, 2) : ""
  );

  async function decide(approved: boolean) {
    if (!current || resolving) return;
    resolving = true;
    const id = current.requestId;
    try {
      const res = await aiApprovalResolve(id, approved, approved && applyToTurn);
      // Swallow -32036 (unknown id) — means timeout already resolved on sidecar side.
      if (!res.ok && res.error.code !== -32036) {
        console.error("ai_approval_resolve failed", res.error);
      }
    } finally {
      aiApproval.resolve(id);
      resolving = false;
    }
  }
</script>

{#if current}
  <dialog
    class="modal"
    open
    onkeydown={(e) => { if (e.key === "Escape") decide(false); }}
  >
    <div class="modal-box" role="document">
      <div class="modal-header">
        <span class="severity-icon">🤖</span>
        <span class="modal-title">AI requests approval to call <code>{current.tool}</code></span>
        {#if aiApproval.pendingCount > 1}
          <span class="pending-badge">{aiApproval.pendingCount} pending</span>
        {/if}
        <span class="timer" class:timer-low={remainingMs < 30_000}>
          {mm}:{String(ss).padStart(2, "0")}
        </span>
      </div>
      <div class="modal-body">
        <div class="tool-label">Input</div>
        <pre class="tool-input">{prettyInput}</pre>
        <label class="apply-row">
          <input type="checkbox" bind:checked={applyToTurn} disabled={resolving} />
          <span>Allow <code>{current.tool}</code> for all calls in this turn</span>
        </label>
        <p class="info-note">Auto-denies after 5 minutes. Denied calls return an error to the AI; it can choose to retry, ask you, or stop.</p>
      </div>
      <div class="modal-footer">
        <button class="btn-deny" onclick={() => decide(false)} disabled={resolving}>
          {resolving ? "Processing…" : "Deny"}
        </button>
        <button class="btn-approve" onclick={() => decide(true)} disabled={resolving}>
          Approve
        </button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; border: none; padding: 0; z-index: 320; }
  .modal-box { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; width: 560px; max-width: 94vw; max-height: 82vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: rgba(122, 168, 196, 0.08); }
  .severity-icon { font-size: 18px; }
  .modal-title { flex: 1; font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .modal-title code { font-family: "JetBrains Mono", "SF Mono", monospace; background: var(--bg-surface-alt); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .pending-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(200, 160, 0, 0.15); color: #6b5600; font-weight: 600; }
  .timer { font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 12px; color: var(--text-muted); padding: 2px 8px; border-radius: 3px; background: var(--bg-surface-alt); }
  .timer-low { color: #b33e1f; font-weight: 700; }
  .modal-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .tool-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .tool-input { background: var(--bg-surface-alt); border: 1px solid var(--border); border-radius: 4px; padding: 10px 12px; font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 11px; color: var(--text-primary); overflow-y: auto; max-height: 300px; white-space: pre-wrap; word-break: break-word; margin: 0; }
  .apply-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-primary); cursor: pointer; }
  .apply-row code { font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 11px; background: var(--bg-surface-alt); padding: 1px 4px; border-radius: 3px; }
  .info-note { font-size: 11px; color: var(--text-muted); font-style: italic; margin: 0; line-height: 1.4; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
  .btn-deny, .btn-approve { padding: 6px 18px; border-radius: 5px; font-size: 12px; cursor: pointer; border: none; font-weight: 600; }
  .btn-deny { background: var(--bg-surface-alt); color: var(--text-primary); border: 1px solid var(--border); }
  .btn-approve { background: #2a7a3e; color: #fff; }
  .btn-approve:hover:not(:disabled) { background: #1f5a2d; }
  .btn-deny:hover:not(:disabled) { background: var(--bg-page); }
  .btn-deny:disabled, .btn-approve:disabled { opacity: 0.6; cursor: default; }
</style>
