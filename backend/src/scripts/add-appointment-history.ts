import { fileURLToPath } from "node:url";
import { db } from "../database/connection.js";

async function main() {
  const backupPath = fileURLToPath(
    new URL(
      `../../data/backup-appointment-history-${Date.now()}.sqlite`,
      import.meta.url
    )
  );

  await db.backup(backupPath);

  console.log(`Copia de seguridad: ${backupPath}`);

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS appointment_history_hidden (
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,

        appointment_id INTEGER NOT NULL
          REFERENCES appointments(id) ON DELETE CASCADE,

        hidden_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

        PRIMARY KEY (user_id, appointment_id)
      );

      CREATE INDEX IF NOT EXISTS idx_history_hidden_appointment
        ON appointment_history_hidden(appointment_id);
    `);
  }).immediate();

  console.log(
    "Historial por usuario preparado. No se borró ninguna cita."
  );
}

main()
  .catch((error: unknown) => {
    console.error("No se pudo preparar el historial:", error);
    process.exitCode = 1;
  })
  .finally(() => db.close());