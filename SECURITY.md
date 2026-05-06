# Security Policy

## Supported Versions

Only the latest release receives security updates.

| Version | Supported |
|---|---|
| Latest | ✅ |
| Older  | ❌ |

## Reporting a Vulnerability

Email **security@veesker.cloud** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Optional: suggested fix

We aim to acknowledge reports within **72 hours** and provide a fix timeline within **7 days** for critical issues. We will credit reporters in release notes unless anonymity is requested.

Please do not open public GitHub issues for security vulnerabilities.

## Security Architecture

### Credential Storage
Passwords and API keys are stored exclusively in the OS keychain:
- **Windows**: Windows Credential Manager (`veesker:` prefix)
- **macOS**: macOS Keychain (`veesker:` prefix)
- **Linux**: libsecret / GNOME Keyring

Credentials are never written to SQLite, log files, or audit files. They are transmitted only over a localhost stdin/stdout pipe (the Tauri IPC channel) to open Oracle sessions.

### SQL Execution Model
Every SQL statement requires explicit user action (clicking Run or pressing the execute shortcut). Veesker never:
- Executes SQL in the background
- Auto-commits transactions
- Runs scheduled or timed queries

`oracledb.autoCommit` is set to `false` globally and repeated on every execute call. Users must explicitly COMMIT or ROLLBACK.

### AI Boundaries (Sheep assistant)
The AI assistant suggests SQL and explains results — it never executes anything autonomously.

**What Sheep sends to `api.anthropic.com`:**
- Schema names, table names, column names
- SQL you write and submit for analysis
- Query result samples (up to 50 rows by default)
- Oracle database version string

**What Sheep never sends:**
- Passwords or connection strings
- Wallet files or certificate data
- Full table dumps or bulk data exports
- Data from schemas marked as sensitive (Cloud Edition)

An explicit disclosure modal is shown before AI can be used on a connection. The sidecar also enforces a secondary gate — AI calls on production-tagged connections require per-session acknowledgement.

### Audit Trail
Every executed statement is written to `<app_data>/audit/YYYY-MM-DD.jsonl` by the Rust host process (`src-tauri/src/commands.rs → write_audit_entry()`). This write happens in the native layer — a compromised renderer cannot suppress it. Each entry records: timestamp, connection id, host, username, SQL, success/failure, row count, elapsed time.

### Read-Only Mode
When a connection is configured as read-only, the sidecar (`sidecar/src/oracle.ts → enforceSafetyForStatement()`) rejects any non-SELECT statement with error code `-32030` before it reaches Oracle. This guard is enforced server-side and cannot be bypassed by the UI layer.

### Content Security Policy
The WebView CSP does not allow `eval`, inline scripts, or arbitrary network connections. The `connect-src` directive is limited to the Tauri IPC channel and `api.veesker.cloud`. The Anthropic API is called from the sidecar process, not the WebView.

## Known Limitations (Community Edition)

- **SQLite query history is not encrypted.** The `veesker.db` file stores query history in plaintext. Veesker Cloud Edition adds encrypted storage.
- **Audit JSONL has no cryptographic integrity protection.** A process with local filesystem access could modify log files without detection. Veesker Cloud Edition adds HMAC-chained audit logs.
- **AI read-only enforcement is keyword-based**, not parse-based. The SQL tokenizer used to validate AI-generated queries handles Oracle-specific syntax (q-quoted strings, block comments) but cannot provide formal guarantees.

## Open Source Auditability

All safety-critical code is in the Apache 2.0 Community Edition repository. You can read, audit, and compile every line that touches your Oracle database.

Key files to review:
- `sidecar/src/oracle.ts` — all Oracle operations, safety guards, auto-commit enforcement
- `sidecar/src/sql-kind.ts` — SQL classification and unsafe DML detection
- `sidecar/src/ai.ts` — AI integration, what data is sent, production gate
- `src-tauri/src/commands.rs` — audit logging, credential handling, SSRF protections
