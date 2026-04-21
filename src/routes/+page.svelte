<script lang="ts">
  import { testConnection, type ConnectionConfig } from "$lib/connection";

  let config = $state<ConnectionConfig>({
    host: "localhost",
    port: 1521,
    serviceName: "FREEPDB1",
    username: "",
    password: "",
  });

  let testing = $state(false);
  let result = $state<
    | { kind: "idle" }
    | { kind: "ok"; serverVersion: string; elapsedMs: number }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function onTest(event: Event) {
    event.preventDefault();
    testing = true;
    result = { kind: "idle" };
    const res = await testConnection(config);
    testing = false;
    if (res.ok) {
      result = {
        kind: "ok",
        serverVersion: res.data.serverVersion,
        elapsedMs: res.data.elapsedMs,
      };
    } else {
      result = { kind: "err", message: res.error.message };
    }
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <div class="brand">
      <svg width="32" height="32" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="4" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="4" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="14" r="2.8" fill="#B33E1F" />
        <circle cx="24" cy="14" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="4" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="14" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
        <circle cx="24" cy="24" r="2" fill="rgba(179,62,31,0.4)" />
      </svg>
      <h1>veesker</h1>
    </div>
    <p class="tagline">connect to Oracle 23ai</p>
  </header>

  <form onsubmit={onTest}>
    <label>
      Host
      <input type="text" bind:value={config.host} required />
    </label>

    <div class="row">
      <label class="port">
        Port
        <input type="number" bind:value={config.port} min="1" max="65535" required />
      </label>
      <label class="service">
        Service name
        <input type="text" bind:value={config.serviceName} required />
      </label>
    </div>

    <label>
      Username
      <input type="text" bind:value={config.username} autocomplete="off" required />
    </label>

    <label>
      Password
      <input type="password" bind:value={config.password} autocomplete="off" required />
    </label>

    <button type="submit" disabled={testing}>
      {testing ? "Testing…" : "Test connection"}
    </button>
  </form>

  {#if result.kind === "ok"}
    <div class="status ok">
      <strong>Connected.</strong>
      <span>{result.serverVersion}</span>
      <span class="meta">{result.elapsedMs} ms</span>
    </div>
  {:else if result.kind === "err"}
    <div class="status err">
      <strong>Failed.</strong>
      <span>{result.message}</span>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 40px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    color: rgba(26, 22, 18, 0.6);
    font-style: italic;
    margin: 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(26, 22, 18, 0.55);
  }
  input {
    font-family: "Inter", sans-serif;
    font-size: 14px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: #1a1612;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 6px;
    padding: 0.6rem 0.75rem;
  }
  input:focus {
    outline: none;
    border-color: #b33e1f;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 1rem;
  }
  button {
    margin-top: 0.5rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #f6f1e8;
    background: #1a1612;
    border: none;
    border-radius: 6px;
    padding: 0.85rem 1rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  button:hover:not(:disabled) {
    background: #b33e1f;
  }
  .status {
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .status.ok {
    background: rgba(46, 125, 50, 0.08);
    color: #1b5e20;
    border: 1px solid rgba(46, 125, 50, 0.25);
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
