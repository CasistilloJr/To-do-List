import { useState } from "react";

type Stage =
  | "RECEIVED"
  | "CUTTING"
  | "BATHING"
  | "DRYING"
  | "DETAILING"
  | "READY"
  | "DELIVERED"
  | "GROOMING";

type TrackingEvent = {
  id: number;
  status: Stage;
  customer_note: string | null;
  created_at: string;
};

type TrackingData = {
  appointment_status: string;
  current_status: Stage | null;
  last_event_id: number | null;
  events: TrackingEvent[];
  allowed_statuses: Stage[];
};

type Props = {
  appointmentId: number;
  isAdmin: boolean;
  onUpdated: () => void;
};

const labels: Record<Stage, string> = {
  RECEIVED: "Recibida",
  CUTTING: "Corte",
  BATHING: "Baño",
  DRYING: "Secado",
  DETAILING: "Detallado",
  READY: "Lista para recoger",
  DELIVERED: "Entregada",
  GROOMING: "Estética (registro anterior)",
};

const descriptions: Record<Stage, string> = {
  RECEIVED:
    "Tu mascota ya fue recibida y puede estar esperando su turno.",
  CUTTING:
    "Estamos realizando el corte de tu mascota.",
  BATHING:
    "Tu mascota está en la etapa de baño.",
  DRYING:
    "Estamos secando a tu mascota.",
  DETAILING:
    "Estamos realizando los detalles finales del servicio.",
  READY:
    "El servicio terminó. Tu mascota está lista para recoger.",
  DELIVERED:
    "Tu mascota fue entregada. Gracias por visitarnos.",
  GROOMING:
    "Esta actualización corresponde a la clasificación anterior.",
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatMoment(value: string) {
  const date = new Date(value);

  const hour = hourFormatter
    .format(date)
    .replace("AM", "a. m.")
    .replace("PM", "p. m.");

  return `${dateFormatter.format(date)}, ${hour}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Tu sesión terminó. Recarga e inicia sesión."
        : result?.message ?? "No se pudo completar la operación."
    );
  }

  return result as T;
}

export default function AppointmentTracking({
  appointmentId,
  isAdmin,
  onUpdated,
}: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TrackingData | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const nextStage = data?.allowed_statuses[0];

  async function load() {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await request<TrackingData>(
        `/api/tracking/${appointmentId}`
      );

      setData(result);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo cargar el seguimiento."
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    await load();
  }

  async function save() {
    if (!data || !nextStage) return;

    const confirmed = window.confirm(
      `¿Marcar como "${labels[nextStage]}"? El cliente podrá ver este cambio.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await request<TrackingData>(
        `/api/tracking/${appointmentId}`,
        {
          method: "POST",
          body: JSON.stringify({
            status: nextStage,
            customer_note: note,
            expected_event_id: data.last_event_id,
          }),
        }
      );

      setData(result);
      setNote("");
      setSuccess("Seguimiento actualizado.");
      onUpdated();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el seguimiento."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-expanded={open}
        className="rounded-xl border border-brand-dark px-4 py-2 font-semibold text-brand-dark disabled:opacity-60"
      >
        {open ? "Ocultar seguimiento" : "Ver seguimiento"}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger-soft p-3 text-danger"
            >
              {error}
            </p>
          )}

          {success && (
            <p
              role="status"
              className="rounded-xl bg-success-soft p-3 text-success"
            >
              {success}
            </p>
          )}

          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60"
          >
            {busy ? "Procesando…" : "Actualizar seguimiento"}
          </button>

          {data && (
            <>
              <div className="rounded-xl bg-brand-soft p-4">
                <p className="text-sm text-muted">
                  Último estado registrado
                </p>

                <p className="mt-1 text-lg font-bold text-brand-dark">
                  {data.current_status
                    ? labels[data.current_status]
                    : "Pendiente de recepción"}
                </p>

                <p className="mt-2 text-sm text-muted">
                  {data.current_status
                    ? descriptions[data.current_status]
                    : "Todavía no se ha registrado la recepción de tu mascota."}
                </p>
              </div>

              {isAdmin && nextStage && (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <p className="font-semibold">
                    Siguiente paso: {labels[nextStage]}
                  </p>

                  <div>
                    <label
                      htmlFor={`tracking-note-${appointmentId}`}
                      className="mb-2 block font-semibold"
                    >
                      Nota para el cliente
                    </label>

                    <textarea
                      id={`tracking-note-${appointmentId}`}
                      rows={3}
                      maxLength={1000}
                      disabled={busy}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Opcional. El cliente podrá leer esta nota."
                      className="w-full rounded-xl border border-border bg-white px-3 py-3"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={save}
                    disabled={busy}
                    className="rounded-xl bg-brand-dark px-4 py-3 font-semibold text-white disabled:opacity-60"
                  >
                    Marcar: {labels[nextStage]}
                  </button>
                </div>
              )}

              <div>
                <h5 className="font-semibold">
                  Historial del servicio
                </h5>

                {data.events.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">
                    Todavía no hay actualizaciones.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {data.events.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-xl border border-border p-3"
                      >
                        <p className="font-semibold">
                          {labels[event.status]}
                        </p>

                        <p className="mt-1 text-xs text-muted">
                          {formatMoment(event.created_at)}
                        </p>

                        {event.customer_note && (
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                            {event.customer_note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <p className="text-xs text-muted">
                Pulsa “Actualizar seguimiento” para consultar cambios recientes.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}