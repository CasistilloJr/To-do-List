import "dotenv/config";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const configuredPath = process.env.DATABASE_PATH?.trim();

if (
  process.env.NODE_ENV === "production" &&
  !configuredPath
) {
  throw new Error(
    "Configura DATABASE_PATH antes de iniciar en producción."
  );
}

if (configuredPath && !isAbsolute(configuredPath)) {
  throw new Error(
    "DATABASE_PATH debe ser una ruta absoluta."
  );
}

// En tu computadora conserva la ubicación actual.
// En producción utiliza la ubicación configurada.
export const databasePath =
  configuredPath ??
  fileURLToPath(
    new URL("../../data/castle-pets.sqlite", import.meta.url)
  );

mkdirSync(dirname(databasePath), {
  recursive: true,
});

export const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");