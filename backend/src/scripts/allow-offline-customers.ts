import { db } from "../database/connection.js";

type Column = {
  name: string;
  notnull: number;
};

try {
  const backupPath = `data/backup-customers-${Date.now()}.sqlite`;

  await db.backup(backupPath);

  const columns = db
    .prepare("PRAGMA table_info(users)")
    .all() as Column[];

  const emailColumn = columns.find((column) => column.name === "email");
  const passwordColumn = columns.find(
    (column) => column.name === "password_hash"
  );

  if (!emailColumn || !passwordColumn) {
    throw new Error("La tabla users no tiene la estructura esperada.");
  }

  if (emailColumn.notnull === 1 || passwordColumn.notnull === 1) {
    // Se desactiva solo durante la reconstrucción de esta tabla.
    db.pragma("foreign_keys = OFF");

    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE users_updated (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            email TEXT COLLATE NOCASE UNIQUE,
            phone TEXT,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'CLIENT'
              CHECK (role IN ('CLIENT', 'ADMIN')),
            active INTEGER NOT NULL DEFAULT 1
              CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL
              DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            CHECK (
              role <> 'ADMIN'
              OR (email IS NOT NULL AND password_hash IS NOT NULL)
            )
          );

          INSERT INTO users_updated (
            id, name, email, phone, password_hash,
            role, active, created_at
          )
          SELECT
            id, name, email, phone, password_hash,
            role, active, created_at
          FROM users;

          DROP TABLE users;

          ALTER TABLE users_updated RENAME TO users;
        `);

        const problems = db.pragma("foreign_key_check") as unknown[];

        if (problems.length > 0) {
          throw new Error(
            "Se detectaron relaciones inválidas. La actualización fue revertida."
          );
        }
      }).immediate();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  console.log("Base preparada para clientes sin cuenta web.");
  console.log("Respaldo:", backupPath);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "No se pudo actualizar."
  );
  process.exitCode = 1;
} finally {
  db.close();
}