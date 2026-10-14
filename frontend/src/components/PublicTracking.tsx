import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

type Tracking = {
  pet_name: string;
  appointment_status: string;
  current_status: string | null;
  events: {
    status: string;
    created_at: string;
  }[];
};

const stages = [
  ["RECEIVED", "Recibida"],
  ["CUTTING", "Corte"],
  ["BATHING", "Baño"],
  ["DRYING", "Secado"],
  ["DETAILING", "Detallado"],
  ["READY", "Lista para recoger"],
  ["DELIVERED", "Entregada"],
] as const;

const labels: Record<string, string> = {
  ...Object.fromEntries(stages),
  GROOMING: "Estética (registro anterior)",
};

function moment(value: string) {
  return new Date(value).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function PublicTracking() {
  const location = useLocation();
  const token =
    new URLSearchParams(location.hash.slice(1)).get("token") ?? "";

  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    setData(null);
    setError("");
    setLoading(true);

    async function load() {
      if (!/^[a-f0-9]{64}$/.test(token)) {
        setError("El enlace está incompleto o no es válido.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/public-tracking", {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal: controller.signal,
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          if (response.status === 404) stopped = true;
          throw new Error(
            result.message ?? "No se pudo consultar el seguimiento."
          );
        }

        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo conectar. Intenta actualizar."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);

          if (!stopped) {
            timer = setTimeout(() => void load(), 30_000);
          }
        }
      }
    }

    void load();

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [token, revision]);

  return (
    <main className="min-h-screen bg-brand-soft px-4 py-8">
      <section className="mx-auto max-w-xl rounded-3xl border border-border bg-white p-6 shadow-sm">
        <img
          src="/logo-castle-pets.jpeg"
          alt="Castle Pet’s"
          className="mx-auto h-20 w-20 rounded-full object-cover"
        />

        <h1 className="mt-4 text-center text-2xl font-bold text-brand-dark">
          Seguimiento de tu mascota
        </h1>

        {loading && (
          <p role="status" className="mt-6">
            Consultando seguimiento…
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-xl bg-danger-soft p-4 text-danger"
          >
            {error}
          </p>
        )}

        {data && (
          <>
            <div
              aria-live="polite"
              className="mt-6 rounded-2xl bg-brand-soft p-5"
            >
              <h2 className="text-xl font-bold">{data.pet_name}</h2>
              <p className="mt-2 text-lg font-semibold text-brand-dark">
                {data.current_status
                  ? labels[data.current_status] ?? "En atención"
                  : "Pendiente de recepción"}
              </p>

              {data.current_status === "READY" && (
                <p className="mt-3">
                  Su servicio terminó. Ya puedes pasar a recogerla.
                </p>
              )}

              {data.current_status === "DELIVERED" && (
                <p className="mt-3">
                  Tu mascota fue entregada. Gracias por visitarnos.
                </p>
              )}
            </div>

            <h3 className="mt-6 font-bold">Etapas del servicio</h3>

            <ol className="mt-3 space-y-3">
              {stages.map(([code, label]) => {
                const event = data.events.find(
                  (item) => item.status === code
                );
                const current = data.current_status === code;

                return (
                  <li
                    key={code}
                    aria-current={current ? "step" : undefined}
                    className={
                      "rounded-xl border p-3 " +
                      (current
                        ? "border-brand-dark bg-brand-soft"
                        : "border-border")
                    }
                  >
                    <p className="font-semibold">
                      {label}
                      {current ? " · Estado actual" : ""}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {event ? moment(event.created_at) : "Sin registrar"}
                    </p>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          className="mt-6 rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
        >
          Actualizar
        </button>

        <p className="mt-4 text-xs text-muted">
          Se consulta automáticamente cada 30 segundos mientras
          esta pantalla permanece abierta. No compartas este
          enlace con otras personas.
        </p>
      </section>
    </main>
  );
}