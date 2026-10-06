import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Method = "CASH" | "CARD" | "TRANSFER";

type ReadyAppointment = {
  id: number;
  starts_at: string;
  pet_name: string;
  owner_name: string;
  price_min_cents: number;
  price_max_cents: number;
};

type Payment = {
  sale_id: number;
  appointment_id: number;
  amount_cents: number;
  method: Method;
  reference: string | null;
  created_at: string;
  pet_name: string;
  owner_name: string;
  recorded_by_name: string;
};

type Report = {
  history: Payment[];
  totals: {
    payments_count: number;
    total_cents: number;
  };
  by_method: {
    method: Method;
    total_cents: number;
  }[];
};

const methodNames: Record<Method, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

const methods: Method[] = ["CASH", "CARD", "TRANSFER"];

const currency = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function money(cents: number) {
  return currency.format(cents / 100);
}

function todayInColima() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function displayMoment(value: string) {
  const date = new Date(value);

  const day = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
  }).format(date);

  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace("AM", "a. m.")
    .replace("PM", "p. m.");

  return `${day}, ${hour}`;
}

function toCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");

  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [pesos, decimals = ""] = normalized.split(".");
  const cents =
    Number(pesos) * 100 +
    Number(decimals.padEnd(2, "0"));

  return cents > 0 ? cents : null;
}

async function api<T>(
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

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Tu sesión terminó. Recarga e inicia sesión."
        : data?.message ?? "No se pudo completar la operación."
    );
  }

  return data as T;
}

async function getReport(from: string, to: string) {
  const params = new URLSearchParams({ from, to });

  return api<Report>(`/api/sales/history?${params.toString()}`);
}

export default function Sales() {
  const [ready, setReady] = useState<ReadyAppointment[]>([]);
  const [report, setReport] = useState<Report | null>(null);

  const [from, setFrom] = useState(todayInColima);
  const [to, setTo] = useState(todayInColima);
  const [appliedDates, setAppliedDates] = useState({
    from: todayInColima(),
    to: todayInColima(),
  });

  const [appointmentId, setAppointmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3";

  useEffect(() => {
    let active = true;
    const today = todayInColima();

    Promise.all([
      api<{ appointments: ReadyAppointment[] }>("/api/sales/ready"),
      getReport(today, today),
    ])
      .then(([pending, history]) => {
        if (!active) return;
        setReady(pending.appointments);
        setReport(history);
        setAppliedDates({ from: today, to: today });
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los cobros."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selected = ready.find(
    (appointment) => appointment.id === Number(appointmentId)
  );

  function selectAppointment(value: string) {
    setAppointmentId(value);
    setReference("");
    setMethod("CASH");

    const appointment = ready.find(
      (item) => item.id === Number(value)
    );

    setAmount(
      appointment &&
      appointment.price_min_cents === appointment.price_max_cents
        ? (appointment.price_min_cents / 100).toFixed(2)
        : ""
    );
  }

  async function refreshReady() {
    setBusy(true);
    setError("");

    try {
      const result = await api<{
        appointments: ReadyAppointment[];
      }>("/api/sales/ready");

      setReady(result.appointments);
      setAppointmentId("");
      setAmount("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la lista."
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const result = await getReport(from, to);
      setReport(result);
      setAppliedDates({ from, to });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo consultar el historial."
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const cents = toCents(amount);

    if (!selected || cents === null) {
      setError("Selecciona una cita y escribe un importe mayor que cero.");
      return;
    }

    const outsideEstimate =
      cents < selected.price_min_cents ||
      cents > selected.price_max_cents;

    const confirmed = window.confirm(
      `¿Confirmas que ya recibiste ${money(cents)} por ${
        selected.pet_name
      }, mediante ${methodNames[method]}?` +
        (outsideEstimate
          ? "\nEl importe está fuera del rango estimado. Confirma que es el precio acordado."
          : "")
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      const result = await api<{ message: string }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          appointment_id: selected.id,
          amount_cents: cents,
          method,
          reference,
        }),
      });

      // El pago ya se guardó. Limpiamos el formulario antes de recargar.
      setReady((current) =>
        current.filter((item) => item.id !== selected.id)
      );
      setAppointmentId("");
      setAmount("");
      setReference("");
      setSuccess(result.message);

      try {
        const updated = await getReport(
          appliedDates.from,
          appliedDates.to
        );
        setReport(updated);
      } catch {
        setError(
          "El cobro se guardó, pero no se pudo actualizar el historial. Pulsa Consultar; no vuelvas a registrar el pago."
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo confirmar el resultado. Consulta el historial antes de reintentar."
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p role="status">Cargando ventas y cobros…</p>;
  }

  return (
    <section className="space-y-8">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      {success && (
        <p role="status" className="rounded-xl bg-success-soft p-4 text-success">
          {success}
        </p>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Registrar cobro</h2>

          <button
            type="button"
            onClick={refreshReady}
            disabled={busy}
            className="rounded-xl border border-brand-dark px-4 py-2 text-brand-dark disabled:opacity-60"
          >
            Actualizar pendientes
          </button>
        </div>

        <p className="mt-2 text-sm text-muted">
          Un solo pago por el total. Regístralo después de recibirlo.
        </p>

        {ready.length === 0 ? (
          <p className="mt-4 rounded-xl bg-brand-soft p-4">
            No hay mascotas listas para recoger con cobro pendiente.
          </p>
        ) : (
          <form onSubmit={savePayment} className="mt-5">
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <label htmlFor="sale-appointment" className="mb-2 block font-semibold">
                  Mascota y cliente
                </label>
                <select
                  id="sale-appointment"
                  required
                  value={appointmentId}
                  onChange={(event) => selectAppointment(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecciona una cita</option>
                  {ready.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      #{appointment.id} · {appointment.pet_name} · {appointment.owner_name}
                    </option>
                  ))}
                </select>
              </div>

              {selected && (
                <div className="rounded-xl bg-brand-soft p-4">
                  <p>
                    Recepción: {displayMoment(selected.starts_at)}
                  </p>
                  <p className="mt-1 font-semibold">
                    Estimación: {money(selected.price_min_cents)}
                    {selected.price_min_cents !== selected.price_max_cents
                      ? `–${money(selected.price_max_cents)}`
                      : ""} MXN
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sale-amount" className="mb-2 block font-semibold">
                    Total definitivo en MXN
                  </label>
                  <input
                    id="sale-amount"
                    type="text"
                    inputMode="decimal"
                    required
                    maxLength={9}
                    placeholder="250.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="sale-method" className="mb-2 block font-semibold">
                    Método de pago
                  </label>
                  <select
                    id="sale-method"
                    value={method}
                    onChange={(event) => setMethod(event.target.value as Method)}
                    className={inputClass}
                  >
                    {methods.map((item) => (
                      <option key={item} value={item}>
                        {methodNames[item]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="sale-reference" className="mb-2 block font-semibold">
                  Referencia o folio — opcional
                </label>
                <input
                  id="sale-reference"
                  type="text"
                  maxLength={120}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-sm text-muted">
                  Usa un folio de operación. No escribas datos de la tarjeta.
                </p>
              </div>

              <button
                type="submit"
                disabled={!selected}
                className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Guardando…" : "Registrar pago recibido"}
              </button>
            </fieldset>
          </form>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <h2 className="text-xl font-bold">Historial de cobros</h2>

        <form
          onSubmit={searchHistory}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div>
            <label htmlFor="sales-from" className="mb-2 block font-semibold">
              Desde
            </label>
            <input
              id="sales-from"
              type="date"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="sales-to" className="mb-2 block font-semibold">
              Hasta
            </label>
            <input
              id="sales-to"
              type="date"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            Consultar
          </button>
        </form>

        {report && (
          <>
            <p className="mt-4 text-sm text-muted">
              Periodo consultado: {appliedDates.from} a {appliedDates.to}.
              Fechas de cobro en horario de Colima.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-brand-soft p-4">
                <p className="text-sm text-muted">Total cobrado</p>
                <p className="mt-2 text-2xl font-bold text-brand-dark">
                  {money(report.totals.total_cents)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {report.totals.payments_count} cobros
                </p>
              </div>

              {methods.map((item) => {
                const total = report.by_method.find(
                  (row) => row.method === item
                )?.total_cents ?? 0;

                return (
                  <div key={item} className="rounded-xl border border-border p-4">
                    <p className="text-sm text-muted">{methodNames[item]}</p>
                    <p className="mt-2 text-2xl font-bold">{money(total)}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-3">Venta</th>
                    <th scope="col" className="p-3">Fecha y hora</th>
                    <th scope="col" className="p-3">Mascota / cliente</th>
                    <th scope="col" className="p-3">Pago</th>
                    <th scope="col" className="p-3">Importe</th>
                    <th scope="col" className="p-3">Registró</th>
                  </tr>
                </thead>

                <tbody>
                  {report.history.map((payment) => (
                    <tr key={payment.sale_id} className="border-b border-border">
                      <td className="p-3">#{payment.sale_id}</td>
                      <td className="p-3 whitespace-nowrap">
                        {displayMoment(payment.created_at)}
                      </td>
                      <td className="p-3">
                        <p className="font-semibold">{payment.pet_name}</p>
                        <p className="text-muted">{payment.owner_name}</p>
                      </td>
                      <td className="p-3">
                        {methodNames[payment.method]}
                        {payment.reference && (
                          <p className="text-xs text-muted">
                            Folio: {payment.reference}
                          </p>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap font-semibold">
                        {money(payment.amount_cents)}
                      </td>
                      <td className="p-3">{payment.recorded_by_name}</td>
                    </tr>
                  ))}

                  {report.history.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-5 text-center text-muted">
                        No hay cobros en este periodo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-muted">
              El listado muestra hasta 200 cobros. Los totales incluyen
              todos los cobros del periodo. Importes en MXN.
            </p>
          </>
        )}
      </div>
    </section>
  );
}