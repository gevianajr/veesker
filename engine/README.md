# @veesker/engine — VeeskerDB

Embedded analytical engine with Oracle SQL compatibility shim. Backed by DuckDB.

## Usage

```ts
import { DuckDBHost, writeVsk, readVsk } from "@veesker/engine";
```

## CLI

```bash
vsk-engine create --schema schema.json --data data.csv --out sandbox.vsk
vsk-engine query sandbox.vsk "SELECT * FROM orders LIMIT 10"
vsk-engine info sandbox.vsk
```

## License

Apache-2.0
