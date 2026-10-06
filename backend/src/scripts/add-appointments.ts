import { db } from "../database/connection.js";

type Column = { name: string };

try {
  db.transaction(() => {
    const columns = db
      .prepare("PRAGMA table_info(appointment_services)")
      .all() as Column[];

    if (columns.length === 0) {
      throw new Error("Primero ejecuta npm run db:init.");
    }

    const names = new Set(columns.map((column) => column.name));

    if (!names.has("price_max_cents")) {
      db.exec(`
        ALTER TABLE appointment_services
        ADD COLUMN price_max_cents INTEGER
        CHECK (
          price_max_cents IS NULL
          OR price_max_cents >= price_cents
        )
      `);
    }

    if (!names.has("duration_min_minutes")) {
      db.exec(`
        ALTER TABLE appointment_services
        ADD COLUMN duration_min_minutes INTEGER
        CHECK (
          duration_min_minutes IS NULL
          OR (
            duration_min_minutes > 0
            AND duration_min_minutes <= duration_minutes
          )
        )
      `);
    }

    db.exec(`
      UPDATE appointment_services
      SET price_max_cents = price_cents
      WHERE price_max_cents IS NULL;

      UPDATE appointment_services
      SET duration_min_minutes = duration_minutes
      WHERE duration_min_minutes IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_reception_slot
      ON appointments(starts_at)
      WHERE status IN (
        'CONFIRMED',
        'IN_PROGRESS',
        'COMPLETED',
        'NO_SHOW'
      );
    `);
  })();

  console.log("Base preparada para gestionar citas.");
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "No se pudo actualizar la base."
  );

  process.exitCode = 1;
} finally {
  db.close();
}