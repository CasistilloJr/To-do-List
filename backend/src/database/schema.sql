-- 1. USUARIOS
-- Las contraseñas se guardarán como hashes, nunca como texto normal.
CREATE TABLE IF NOT EXISTS users (
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

-- 2. SESIONES
-- Guarda el hash del token de sesión, no el token original.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. MASCOTAS
CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  species TEXT NOT NULL DEFAULT 'Perro',
  breed TEXT,
  birth_date TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- 4. CATÁLOGO DE SERVICIOS
-- Ejemplo: $250.00 se guarda como 25000 centavos.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,

  name TEXT NOT NULL UNIQUE,

  description TEXT,

  price_cents INTEGER NOT NULL
    CHECK (price_cents >= 0),

  price_max_cents INTEGER
    CHECK (
      price_max_cents IS NULL
      OR price_max_cents >= price_cents
    ),

  duration_minutes INTEGER NOT NULL
    CHECK (duration_minutes > 0),

  duration_max_minutes INTEGER
    CHECK (
      duration_max_minutes IS NULL
      OR duration_max_minutes >= duration_minutes
    ),

  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1))
);
 

-- 5. CITAS
-- Las fechas de inicio y fin se guardarán en UTC.
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  pet_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'CONFIRMED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW'
      )
    ),
  notes TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE RESTRICT
);

-- 6. SERVICIOS SOLICITADOS EN CADA CITA
-- Conservamos nombre, precio y duración acordados.
-- Así un cambio del catálogo no altera las citas anteriores.
CREATE TABLE IF NOT EXISTS appointment_services (
  id INTEGER PRIMARY KEY,

  appointment_id INTEGER NOT NULL,

  service_id INTEGER NOT NULL,

  service_name TEXT NOT NULL,

  price_cents INTEGER NOT NULL
    CHECK (price_cents >= 0),

  price_max_cents INTEGER
    CHECK (
      price_max_cents IS NULL
      OR price_max_cents >= price_cents
    ),

  -- En esta tabla, duration_minutes conserva la duración máxima.
  duration_minutes INTEGER NOT NULL
    CHECK (duration_minutes > 0),

  duration_min_minutes INTEGER
    CHECK (
      duration_min_minutes IS NULL
      OR (
        duration_min_minutes > 0
        AND duration_min_minutes <= duration_minutes
      )
    ),

  UNIQUE (appointment_id, service_id),

  FOREIGN KEY (appointment_id)
    REFERENCES appointments(id) ON DELETE RESTRICT,

  FOREIGN KEY (service_id)
    REFERENCES services(id) ON DELETE RESTRICT
);
-- 7. HISTORIAL DEL SEGUIMIENTO
-- Cada cambio genera una fila nueva.
CREATE TABLE IF NOT EXISTS status_events (
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
-- 8. VENTAS DE SERVICIOS
-- Esta primera versión permite una venta por cita.
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL UNIQUE,
  total_cents INTEGER NOT NULL
    CHECK (total_cents >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED', 'VOID')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (appointment_id)
    REFERENCES appointments(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE RESTRICT
);

-- 9. COBROS Y DEVOLUCIONES
-- Se pueden registrar varios pagos para una venta.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL
    CHECK (amount_cents > 0),
  kind TEXT NOT NULL DEFAULT 'PAYMENT'
    CHECK (kind IN ('PAYMENT', 'REFUND')),
  method TEXT NOT NULL
    CHECK (method IN ('CASH', 'CARD', 'TRANSFER')),
  reference TEXT,
  recorded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (sale_id)
    REFERENCES sales(id) ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by)
    REFERENCES users(id) ON DELETE RESTRICT
);

-- 10. CONFIGURACIÓN DEL NEGOCIO
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- 11. REGISTRO DE CAMBIOS ADMINISTRATIVOS
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (actor_id)
    REFERENCES users(id) ON DELETE RESTRICT
);

-- 12. CONTROL DE MENSAJES DE WHATSAPP
-- provider_message_id ayuda a detectar mensajes duplicados.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY,
  provider_message_id TEXT UNIQUE,
  user_id INTEGER,
  direction TEXT NOT NULL
    CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (
      status IN (
        'PENDING',
        'PROCESSED',
        'SENT',
        'DELIVERED',
        'READ',
        'FAILED'
      )
    ),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE RESTRICT
);

-- ÍNDICES: agilizan búsquedas frecuentes.
CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_pets_owner
  ON pets(owner_id);

CREATE INDEX IF NOT EXISTS idx_appointments_pet
  ON appointments(pet_id);

CREATE INDEX IF NOT EXISTS idx_appointments_date
  ON appointments(starts_at);

CREATE INDEX IF NOT EXISTS idx_status_events_appointment
  ON status_events(appointment_id, id);

CREATE INDEX IF NOT EXISTS idx_payments_sale
  ON payments(sale_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_reception_slot
  ON appointments(starts_at)
  WHERE status IN (
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'NO_SHOW'
  );