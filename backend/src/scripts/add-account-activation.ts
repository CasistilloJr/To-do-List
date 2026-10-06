import { fileURLToPath } from "node:url";
import { db } from "../database/connection.js";

async function main() {
  const backupPath = fileURLToPath(
    new URL(
      `../../data/backup-account-activation-${Date.now()}.sqlite`,
      import.meta.url
    )
  );

  await db.backup(backupPath);

  console.log(`Copia de seguridad: ${backupPath}`);

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_activation_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL COLLATE NOCASE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_activation_user_created
        ON account_activation_tokens(user_id, created_at);
    `);
  }).immediate();

  console.log("Activación de cuentas preparada.");
}

main()
  .catch((error: unknown) => {
    console.error("Error al preparar la activación:", error);
    process.exitCode = 1;
  })
  .finally(() => db.close());