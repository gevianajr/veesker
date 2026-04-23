# Tray Icon — Design Spec

**Date:** 2026-04-23  
**Status:** Approved

---

## Overview

Add a system tray icon to Veesker that acts as a quick launcher, connection status indicator, and shortcut hub — similar to Docker Desktop's tray behavior.

---

## Architecture

The sidecar (Bun/TypeScript) is the source of truth for connection state. When any connection changes state, the sidecar emits a `connection.state_changed` JSON-RPC event over stdout. The Rust layer (`lib.rs` / `tray.rs`) listens, updates the tray icon and rebuilds the context menu. The frontend is not involved in tray state management — this keeps the tray functional even when the window is hidden.

```
Sidecar (Bun) ── connection.state_changed ──▶ Rust ── updates ──▶ Tray icon + menu
Rust ── Tauri event ──▶ Frontend (only when window is open)
```

### Files changed

| File | Change |
|---|---|
| `sidecar/src/oracle.ts` | Emit `connection.state_changed` on connect/disconnect |
| `src-tauri/src/lib.rs` | Create tray in `setup()`, route sidecar events to tray |
| `src-tauri/src/tray.rs` | New module: tray icon state machine and menu builder |
| `src-tauri/Cargo.toml` | Add `tray-icon` feature to Tauri dependency |
| `src-tauri/icons/` | Add 4 tray PNG variants derived from existing `32x32.png` |

---

## Tray Icon States

Global state = worst state across all connections.

| State | Icon file | Indicator | Trigger |
|---|---|---|---|
| Idle | `tray-idle.png` | No overlay | No connections active |
| Connecting | `tray-connecting.png` | Blue dot | Any connection in progress |
| Connected | `tray-connected.png` | Orange dot | ≥1 connection active, none errored |
| Error | `tray-error.png` | Red dot | Any connection errored |

Icon base: existing `src-tauri/icons/32x32.png` (sheep). Four PNG variants add a 10px colored dot in the lower-right corner.

---

## Context Menu (right-click)

```
CONNECTIONS
  ● PROD_DB          [Disconnect]
  ○ DEV_DB           [Connect]
─────────────────────────────────
ACTIONS
  Nova Query
  Schema Browser
─────────────────────────────────
  Abrir Veesker
  Sair
```

- Section headers are disabled labels (not clickable)
- "Connect" / "Disconnect" sends a command to the sidecar
- "Nova Query" and "Schema Browser" open the window focused on those views
- "Abrir Veesker" brings the window to focus (or opens if hidden)
- "Sair" quits immediately without a dialog
- If no connections are saved: show a single disabled item "Nenhuma conexão cadastrada"

---

## Sidecar Protocol

New outbound event emitted by the sidecar:

```json
{
  "method": "connection.state_changed",
  "params": {
    "connections": [
      { "name": "PROD_DB", "state": "connected" },
      { "name": "DEV_DB",  "state": "idle" }
    ]
  }
}
```

States: `idle` | `connecting` | `connected` | `error`

---

## Close Window Behavior

The Tauri `close-requested` window event is intercepted. Instead of quitting, a native dialog is shown:

> **Fechar o Veesker?**  
> O app continuará rodando em segundo plano.  
> [ Encerrar ]  [ **Minimizar para o Tray** ]

"Minimizar para o Tray" is the default action (Enter key). Clicking it hides the window; the tray remains active. "Encerrar" quits the app and removes the tray icon.

---

## Edge Cases

| Situation | Behavior |
|---|---|
| Double-click tray icon | Show/focus the main window |
| Window already open, click "Abrir Veesker" | Bring window to foreground |
| Sidecar crash | Icon switches to error state |
| "Sair" in tray menu | App quits immediately, no dialog |
| Connect via tray menu | Sends command to sidecar; icon animates to connecting |

---

## Out of Scope

- Native toast notifications (can be added later)
- Animated "pulsing" icon during connecting (static blue icon instead)
- Windows autostart on login

---

## Cross-Platform Notes (Windows + macOS)

### Cargo.toml
The `tray-icon` feature must be enabled for both platforms:
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

### Icon format
- **Windows:** PNG 32x32 works natively for the tray.
- **macOS:** The tray uses a **template image** — a monochrome PNG (16x16 or 32x32 @2x) that macOS colorizes automatically for light/dark mode. The status dot overlay (color indicator) should be a separate composited layer, **not** baked into the template image. Recommended approach: ship `tray-idle-template.png` (monochrome sheep) + colored dot PNGs per state, then composite at runtime using the `image` crate, or ship pre-composited PNGs and skip template mode for simplicity.
- **Simplest cross-platform approach:** Use pre-composited 32x32 PNGs for all 4 states on both platforms. Skip macOS template images. The sheep will not auto-invert for Dark Mode but this is acceptable for v1.

### Sidecar binary
On macOS, the sidecar must be compiled for the correct target before `tauri build`:
```bash
cd sidecar
bun build src/index.ts --compile --minify \
  --outfile ../src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin
# or x86_64-apple-darwin for Intel Macs
cd ..
```
Check your target with: `rustc -vV | grep host`

### Code signing
`tauri.conf.json` already has `"signingIdentity": "-"` (ad-hoc signing). For distribution via Mac App Store, a real Developer ID is required — out of scope for now.

### `close-requested` dialog on macOS
On macOS, the native dialog uses `NSAlert`. Tauri's `dialog` plugin handles this cross-platform — no platform-specific code needed.

### Menu item labels
Keep menu item strings in English (as per project conventions). macOS renders them in the system font automatically.

### Build checklist for macOS
1. Install Rust target: `rustup target add aarch64-apple-darwin` (or `x86_64-apple-darwin`)
2. Compile sidecar binary for macOS target (see above)
3. Run `bun install` from repo root
4. Run `bun run tauri build`
5. App bundle is output to `src-tauri/target/release/bundle/macos/Veesker.app`
