import { useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  appointmentId: number;
  petName: string;
  startsAt: string;
};

function formatMoment(value: string | number) {
  const date = new Date(value);

  const day = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "long",
    year: "numeric",
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

export default function TrackingShare({
  appointmentId,
  petName,
  startsAt,
}: Props) {
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");

  const lock = useRef(false);
  const printLock = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  async function changeLink(method: "POST" | "DELETE") {
    if (lock.current || printLock.current) return;

    const question =
      method === "POST"
        ? "¿Generar un enlace válido por 24 horas? Cualquier enlace anterior de esta cita dejará de funcionar."
        : "¿Desactivar el enlace y el QR de esta cita?";

    if (!window.confirm(question)) return;

    lock.current = true;
    setBusy(true);
    setMessage("");
    setLink("");
    setExpiresAt(null);

    try {
      const response = await fetch(
        `/api/tracking-links/${appointmentId}`,
        {
          method,
          credentials: "same-origin",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "No se pudo completar.");
      }

      if (method === "POST") {
        const url = new URL("/seguimiento", window.location.origin);
        url.hash = `token=${data.token}`;

        setLink(url.toString());
        setExpiresAt(data.expires_at);
        setMessage("Enlace creado. El anterior ya no funciona.");
      } else {
        setMessage(data.message);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo comprobar el resultado. Intenta nuevamente."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Enlace copiado.");
    } catch {
      setMessage("Selecciona el enlace y cópialo manualmente.");
    }
  }

  async function printSheet() {
    if (!link || !expiresAt || printLock.current || busy) return;

    if (expiresAt <= Date.now()) {
      setMessage("El enlace caducó. Genera otro antes de imprimir.");
      return;
    }

    printLock.current = true;
    setMessage("");

    try {
      // Coloca la ficha en el documento antes de abrir la impresión.
      flushSync(() => {
        setPrinting(true);
      });

      const logo = sheetRef.current?.querySelector("img");

      // Espera a que el logo esté listo para imprimir.
      if (logo) {
        await logo.decode().catch(() => undefined);
      }

      await document.fonts.ready;

      document.body.classList.add("printing-tracking");
      window.print();
    } catch {
      setMessage(
        "No se pudo abrir la impresión. Intenta nuevamente."
      );
    } finally {
      document.body.classList.remove("printing-tracking");
      setPrinting(false);
      printLock.current = false;
    }
  }

  const disabled = busy || printing;

  return (
    <section className="mt-4 rounded-xl border border-border p-4">
      <h5 className="font-semibold">Seguimiento por QR</h5>

      <p className="mt-2 text-sm text-muted">
        Quien tenga el enlace podrá ver el nombre de la mascota y
        las etapas de esta cita. Compártelo únicamente con su dueño.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void changeLink("POST")}
          className="rounded-xl bg-brand-dark px-4 py-2 text-white disabled:opacity-60"
        >
          {busy ? "Procesando…" : "Generar nuevo QR"}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => void changeLink("DELETE")}
          className="rounded-xl border border-border px-4 py-2 text-danger disabled:opacity-60"
        >
          Desactivar enlace
        </button>
      </div>

      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}

      {link && (
        <div className="mt-4 space-y-4">
          <div className="w-fit max-w-full rounded-xl border border-border bg-white p-3">
            <QRCodeSVG
              value={link}
              size={240}
              marginSize={4}
              level="M"
              title="Código QR para consultar el seguimiento"
              style={{ maxWidth: "100%", height: "auto" }}
            />
          </div>

          <label
            htmlFor={`tracking-link-${appointmentId}`}
            className="block text-sm font-semibold"
          >
            Enlace privado
          </label>

          <input
            id={`tracking-link-${appointmentId}`}
            readOnly
            value={link}
            onFocus={(event) => event.target.select()}
            className="w-full rounded-xl border border-border p-3 text-sm"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void copyLink()}
              className="rounded-xl border border-border px-4 py-2 disabled:opacity-60"
            >
              Copiar enlace
            </button>

            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-border px-4 py-2 text-brand-dark"
            >
              Abrir seguimiento
            </a>

            <button
              type="button"
              disabled={disabled}
              onClick={() => void printSheet()}
              className="rounded-xl bg-brand-dark px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {printing ? "Preparando…" : "Imprimir ficha"}
            </button>
          </div>

          {expiresAt && (
            <p className="text-sm text-muted">
              Caduca: {formatMoment(expiresAt)}
            </p>
          )}

          <p className="text-xs text-muted">
            Guarda el enlace antes de salir. Generar otro invalida
            el QR anterior, incluidas sus copias impresas.
          </p>
        </div>
      )}

      {printing &&
        link &&
        expiresAt &&
        createPortal(
          <div className="tracking-print-sheet" ref={sheetRef}>
            <header className="tracking-print-header">
              <img
                src="/logo-castle-pets.jpeg"
                alt="Castle Pet’s"
              />
              <h1>Castle Pet’s</h1>
              <p>Ficha de seguimiento</p>
            </header>

            <div className="tracking-print-details">
              <h2>{petName}</h2>
              <p>Cita #{appointmentId}</p>
              <p>
                <strong>Recepción programada:</strong>
                <br />
                {formatMoment(startsAt)}
              </p>
            </div>

            <div className="tracking-print-qr">
              <QRCodeSVG
                value={link}
                size={260}
                marginSize={4}
                level="M"
                fgColor="#000000"
                bgColor="#ffffff"
                title="Escanea para consultar el seguimiento"
              />
            </div>

            <p className="tracking-print-instruction">
              Escanea para consultar el estado de tu mascota.
            </p>

            <p>
              <strong>El enlace vence:</strong>
              <br />
              {formatMoment(expiresAt)}
            </p>

            <footer>
              <p>
                Este QR es privado. Quien tenga una copia podrá
                consultar el seguimiento de esta cita.
              </p>
              <p>
                Si el negocio reemplaza o desactiva el enlace,
                esta ficha dejará de dar acceso.
              </p>
              <p>Castle Pet’s · Colima</p>
            </footer>
          </div>,
          document.body
        )}
    </section>
  );
}