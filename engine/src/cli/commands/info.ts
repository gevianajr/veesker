import type { Command } from "commander";
import { readVskHeader, readVskManifest } from "../../vsk-format/reader";

export function registerInfo(program: Command): void {
  program
    .command("info <file>")
    .description("show .vsk header + manifest summary")
    .action((file: string) => {
      const header = readVskHeader(file);
      const isEncrypted = header.envelopeLength > 0n;
      console.log(`File:           ${file}`);
      console.log(`Format version: ${header.version}`);
      console.log(`Encrypted:      ${isEncrypted ? "yes" : "no"}`);
      if (isEncrypted) {
        console.log(`Envelope size:  ${header.envelopeLength} bytes`);
        console.log(`Encrypted blob: ${header.dataLength} bytes`);
        console.log(`(manifest details require decryption — use 'vsk-engine decrypt' first)`);
        return;
      }
      const manifest = readVskManifest(file);
      console.log(`Built at:       ${manifest.builtAt}`);
      console.log(`Source:         ${manifest.sourceId}`);
      console.log(`Schema:         ${manifest.schemaName}`);
      console.log(`TTL expires:    ${manifest.ttlExpiresAt}`);
      if (manifest.engineVersion) console.log(`Engine version: ${manifest.engineVersion}`);
      if (manifest.dataFormat) console.log(`Data format:    ${manifest.dataFormat}`);
      console.log(`Tables (${manifest.tables.length}):`);
      for (const t of manifest.tables) {
        console.log(`  - ${t.name} (${t.rowCount.toLocaleString()} rows, ${t.columns.length} columns)`);
      }
      console.log(`PII masks:      ${manifest.piiMasks.length}`);
      // Gate the PL/SQL summary block to v0.2.x manifests specifically. Future
      // engine versions (v0.3.x onward) may carry the same fields but with
      // semantics this CLI doesn't yet understand — they should pass through
      // their own dedicated rendering path. Bump this prefix when v0.3.x ships.
      const isV2 = (manifest.engineVersion ?? "0.1.0").startsWith("0.2");
      if (isV2 && manifest.plsqlObjectCount !== undefined) {
        console.log(`Plsql objects:  ${manifest.plsqlObjectCount}`);
        if (manifest.skippedObjects && manifest.skippedObjects.length > 0) {
          console.log(`Skipped:        ${manifest.skippedObjects.length}`);
          for (const s of manifest.skippedObjects) {
            const detail = s.detail ? ` (${s.detail})` : "";
            console.log(`  - ${s.kind} ${s.owner}.${s.name} — ${s.reason}${detail}`);
          }
        }
      }
    });
}
