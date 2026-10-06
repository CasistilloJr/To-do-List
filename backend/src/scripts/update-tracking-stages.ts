import { db } from "../database/connection.js";

try {
  // Crea un respaldo antes de modificar la estructura.
  const backupPath =
    `data/backup-tracking-${Date.now()}.sqlite`;

  await db.backup(backupPath);

  db.transaction(() => {
    const table = db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'status_events'
    `).get() as { sql: string } | undefined;

    if (!table) {
      throw new Error(
        "No existe status_events. Ejecuta primero npm run db:init."
      );
    }

    // Si la actualización ya fue aplicada, conserva la tabla.
    if (
      table.sql.includes("'CUTTING'") &&
      table.sql.includes("'DETAILING'")
    ) {
      return;
    }

    db.exec(`
      CREATE TABLE status_events_updated (
        id INTEGER PRIMARY KEY,
        appointment_id INTEGER NOT NULL,
        status TEXT NOT NULL
          CHECK (
            status IN (
              'RECEIVED',
              'CUTTING',
              'BATHING',
              'DRYING',
              'DETAILING',
              'READY',
              'DELIVERED',
              'GROOMING'
            )
          ),
        changed_by INTEGER NOT NULL,
        customer_note TEXT,
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (appointment_id)
          REFERENCES appointments(id) ON DELETE RESTRICT,
        FOREIGN KEY (changed_by)
          REFERENCES users(id) ON DELETE RESTRICT
      );

      INSERT INTO status_events_updated (
        id,
        appointment_id,
        status,
        changed_by,
        customer_note,
        created_at
      )
      SELECT
        id,
        appointment_id,
        status,
        changed_by,
        customer_note,
        created_at
      FROM status_events;

      DROP TABLE status_events;

      ALTER TABLE status_events_updated
      RENAME TO status_events;

      CREATE INDEX idx_status_events_appointment
      ON status_events(appointment_id, id);
    `);
  })();

  console.log("Estados de seguimiento actualizados.");
  console.log("Respaldo:", backupPath);
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "No se pudo actualizar el seguimiento."
  );

  process.exitCode = 1;
} finally {
  db.close();
}