import { readFileSync } from "node:fs";
import { db, databasePath } from "./connection.js";

try {
  // Lee las instrucciones SQL.
  const schema = readFileSync(
    new URL("./schema.sql", import.meta.url),
    "utf8"
  );

  // Si falla una instrucción, revierte los cambios de este bloque.
  const initialize = db.transaction(() => {
    db.exec(schema);

    const insertSetting = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `);

    insertSetting.run("business_name", "Castle Pet’s");
    insertSetting.run("timezone", "America/Mexico_City");
    insertSetting.run("currency", "MXN");
  });

  initialize();

  // Muestra las tablas creadas.
  const tables = db.prepare(`
    SELECT name AS tabla
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  console.log("Base de datos preparada correctamente.");
  console.log("Ubicación:", databasePath);
  console.table(tables);

  // Comprueba la integridad de la base.
  console.log(
    "Integridad:",
    db.pragma("integrity_check", { simple: true })
  );

  console.log(
    "Relaciones activas:",
    db.pragma("foreign_keys", { simple: true }) === 1
  );
} catch (error) {
  console.error("No se pudo preparar la base de datos.");
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}