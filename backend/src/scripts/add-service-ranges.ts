import { db } from "../database/connection.js";

type Column = {
  name: string;
};

try {
  db.transaction(() => {
    const columns = db
      .prepare("PRAGMA table_info(services)")
      .all() as Column[];

    if (columns.length === 0) {
      throw new Error(
        "No existe la tabla services. Ejecuta primero npm run db:init."
      );
    }

    const names = new Set(columns.map((column) => column.name));

    if (!names.has("price_max_cents")) {
      db.exec(`
        ALTER TABLE services
        ADD COLUMN price_max_cents INTEGER
        CHECK (
          price_max_cents IS NULL
          OR price_max_cents >= price_cents
        )
      `);
    }

    if (!names.has("duration_max_minutes")) {
      db.exec(`
        ALTER TABLE services
        ADD COLUMN duration_max_minutes INTEGER
        CHECK (
          duration_max_minutes IS NULL
          OR duration_max_minutes >= duration_minutes
        )
      `);
    }

    // Los servicios anteriores conservarán un valor único.
    db.exec(`
      UPDATE services
      SET price_max_cents = price_cents
      WHERE price_max_cents IS NULL;

      UPDATE services
      SET duration_max_minutes = duration_minutes
      WHERE duration_max_minutes IS NULL;
    `);
  })();

  console.log("Rangos agregados correctamente.");
  console.log("Los servicios existentes conservaron sus valores.");
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