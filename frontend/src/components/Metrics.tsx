import { useEffect, useState } from "react";

type Period = "today" | "week" | "month" | "custom";

type Report = {
  period: {
    from: string;
    to: string;
    timezone: string;
  };
  totals: {
    total_cents: number;
    payments_count: number;
    appointments_count: number;
  };
  by_method: {
    method: string;
    count: number;
    total_cents: number;
  }[];
  by_status: {
    status: string;
    count: number;
  }[];
  top_services: {
    id: number;
    name: string;
    requests: number;
  }[];
};

const methods = [
  ["CASH", "Efectivo"],
  ["CARD", "Tarjeta"],
  ["TRANSFER", "Transferencia"],
] as const;

const statuses = [
  ["PENDING", "Pendientes"],
  ["CONFIRMED", "Confirmadas"],
  ["IN_PROGRESS", "En atención"],
  ["COMPLETED", "Entregadas"],
  ["CANCELLED", "Canceladas"],
  ["NO_SHOW", "Inasistencias"],
] as const;

const presets = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["custom", "Personalizado"],
] as const;

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(cents / 100);
}

function todayInColima() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

const buttonClass =
  "rounded-xl border border-border px-4 py-2 font-semibold " +
  "text-brand-dark disabled:opacity-60";

export default function Metrics() {
  const [period, setPeriod] = useState<Period>("today");
  const [from, setFrom] = useState(todayInColima);
  const [to, setTo] = useState(todayInColima);

  const [query, setQuery] = useState("period=today");
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    setReport(null);

    async function load() {
      try {
        const response = await fetch(`/api/metrics?${query}`, {
          credentials: "same-origin",
          signal: controller.signal,
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Tu sesión terminó. Recarga e inicia sesión."
              : data.message ?? "No se pudieron consultar las métricas."
          );
        }

        if (!controller.signal.aborted) {
          setReport(data);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "No se pudo conectar con el servidor."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [query, revision]);

  function applyPeriod(next: Period) {
    setPeriod(next);

    if (next !== "custom") {
      setQuery(new URLSearchParams({ period: next }).toString());
      setRevision((value) => value + 1);
    }
  }

  function consultCustom() {
    setQuery(
      new URLSearchParams({
        period: "custom",
        from,
        to,
      }).toString()
    );

    setRevision((value) => value + 1);
  }

  return (
    <section className="space-y-6" aria-busy={loading}>
      <div>
        <h2 className="text-xl font-bold">Actividad del negocio</h2>
        <p className="mt-2 text-sm text-muted">
          Todos los periodos se calculan con el horario de Colima.
          La semana comienza el lunes; semana y mes abarcan hasta hoy.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Seleccionar periodo">
        {presets.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => applyPeriod(value)}
            className={
              buttonClass +
              (period === value ? " bg-brand-soft" : "")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            consultCustom();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div>
            <label
              htmlFor="metrics-from"
              className="mb-2 block font-semibold"
            >
              Desde
            </label>
            <input
              id="metrics-from"
              type="date"
              required
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-xl border border-border px-4 py-3"
            />
          </div>

          <div>
            <label
              htmlFor="metrics-to"
              className="mb-2 block font-semibold"
            >
              Hasta
            </label>
            <input
              id="metrics-to"
              type="date"
              required
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-xl border border-border px-4 py-3"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={buttonClass}
          >
            Consultar
          </button>
        </form>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={() => setRevision((value) => value + 1)}
        className={buttonClass}
      >
        {loading ? "Consultando…" : "Actualizar periodo consultado"}
      </button>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      {loading && <p role="status">Cargando métricas…</p>}

      {report && (
        <>
          <p className="text-sm text-muted">
            Resultados del {displayDate(report.period.from)} al{" "}
            {displayDate(report.period.to)}, ambos días incluidos.
          </p>

          <section className="space-y-4">
            <h3 className="text-lg font-bold">Cobros registrados</h3>

            <div className="rounded-2xl bg-brand-soft p-5">
              <p className="text-sm text-muted">Total cobrado</p>
              <p className="mt-2 text-3xl font-bold text-brand-dark">
                {money(report.totals.total_cents)}
              </p>
              <p className="mt-2 text-sm">
                {report.totals.payments_count} pagos registrados
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {methods.map(([code, label]) => {
                const item = report.by_method.find(
                  (row) => row.method === code
                );

                return (
                  <div
                    key={code}
                    className="rounded-xl border border-border p-4"
                  >
                    <p className="text-sm text-muted">{label}</p>
                    <p className="mt-2 text-xl font-bold">
                      {money(item?.total_cents ?? 0)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {item?.count ?? 0} pagos
                    </p>
                  </div>
                );
              })}
            </div>

            <p className="text-sm text-muted">
              Por fecha de pago, con el mismo criterio que Ventas y
              cobros. Incluye pagos de ventas cerradas; no descuenta
              gastos ni devoluciones.
            </p>
          </section>

          <section className="space-y-4 border-t border-border pt-6">
            <h3 className="text-lg font-bold">
              Citas con recepción programada en el periodo
            </h3>

            <p className="text-sm text-muted">
              Total: {report.totals.appointments_count}. Se muestra su
              estado actual, aunque haya cambiado después de la fecha
              de recepción.
            </p>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {statuses.map(([code, label]) => {
                const count =
                  report.by_status.find((row) => row.status === code)
                    ?.count ?? 0;

                return (
                  <div
                    key={code}
                    className="rounded-xl border border-border p-4"
                  >
                    <p className="text-sm text-muted">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-brand-dark">
                      {count}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4 border-t border-border pt-6">
            <h3 className="text-lg font-bold">
              Los 10 servicios más solicitados
            </h3>

            <p className="text-sm text-muted">
              Cuenta las citas que incluyen cada servicio, por fecha
              de recepción. Excluye canceladas e inasistencias e incluye
              solicitudes pendientes. Usa el nombre actual del catálogo.
            </p>

            {report.top_services.length === 0 ? (
              <p>No hay servicios para mostrar en este periodo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="p-3">Servicio</th>
                      <th scope="col" className="p-3 text-right">
                        Citas que lo incluyen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.top_services.map((service) => (
                      <tr
                        key={service.id}
                        className="border-b border-border"
                      >
                        <td className="p-3">{service.name}</td>
                        <td className="p-3 text-right font-semibold">
                          {service.requests}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted">
              Una cita puede incluir varios servicios, por lo que la
              suma de esta tabla puede superar el número de citas.
              Ocultar una cita no la elimina de las métricas.
            </p>
          </section>
        </>
      )}
    </section>
  );
}