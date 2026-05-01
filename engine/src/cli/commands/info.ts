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
    });
}
