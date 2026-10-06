import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";

type Props = {
  mode: "request" | "confirm";
  signedIn: boolean;
};

export default function ActivateAccount({
  mode,
  signedIn,
}: Props) {
  const location = useLocation();

  const token =
    new URLSearchParams(location.hash.slice(1)).get("token") ?? "";

  const tokenValid = /^[a-f0-9]{64}$/.test(token);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isRequest = mode === "request";

  const inputClass =
    "mt-2 w-full rounded-xl border border-border px-4 py-3";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (
      !isRequest &&
      (password !== repeat || !tokenValid)
    ) {
      setError(
        !tokenValid
          ? "Abre el enlace completo de tu correo."
          : "Las contraseñas no coinciden."
      );
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `/api/auth/activation/${isRequest ? "request" : "confirm"}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            isRequest
              ? { email }
              : { token, password }
          ),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message ?? "No se pudo completar la solicitud."
        );
      }

      setSuccess(data.message);
      setPassword("");
      setRepeat("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo conectar con el servidor."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-soft px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-border bg-white p-7 shadow-sm">
        <img
          src="/logo-castle-pets.jpeg"
          alt="Castle Pets"
          className="mx-auto h-24 w-24 rounded-full object-cover"
        />

        <h1 className="mt-5 text-2xl font-bold text-brand-dark">
          {isRequest
            ? "Activa tu acceso web"
            : "Crea tu contraseña"}
        </h1>

        {signedIn ? (
          <p className="mt-4 text-muted">
            Ya tienes una sesión abierta. Cierra sesión desde
            tu panel y vuelve a abrir el enlace del correo para
            activar la cuenta correspondiente.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">
              {isRequest
                ? "Si el negocio ya registró tu ficha, escribe el correo que quedó registrado. Si tu ficha no tiene correo, contacta al negocio para añadirlo."
                : "Usa una contraseña de 12 a 128 caracteres. Tus mascotas y citas permanecerán en tu ficha."}
            </p>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-danger-soft p-3 text-danger"
              >
                {error}
              </p>
            )}

            {success && (
              <p
                role="status"
                className="mt-4 rounded-xl bg-success-soft p-3 text-success"
              >
                {success}
              </p>
            )}

            {!isRequest && !tokenValid && (
              <p role="alert" className="mt-4 text-danger">
                Falta un enlace válido. Solicita uno nuevo.
              </p>
            )}

            {(isRequest || (tokenValid && !success)) && (
              <form onSubmit={submit} className="mt-5">
                <fieldset disabled={busy} className="space-y-4">
                  {isRequest ? (
                    <div>
                      <label
                        htmlFor="activation-email"
                        className="font-semibold"
                      >
                        Correo de tu ficha
                      </label>

                      <input
                        id="activation-email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(event) =>
                          setEmail(event.target.value)
                        }
                        className={inputClass}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label
                          htmlFor="activation-password"
                          className="font-semibold"
                        >
                          Nueva contraseña
                        </label>

                        <input
                          id="activation-password"
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={password}
                          onChange={(event) =>
                            setPassword(event.target.value)
                          }
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="activation-repeat"
                          className="font-semibold"
                        >
                          Repite la contraseña
                        </label>

                        <input
                          id="activation-repeat"
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={repeat}
                          onChange={(event) =>
                            setRepeat(event.target.value)
                          }
                          className={inputClass}
                        />
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white disabled:opacity-60"
                  >
                    {busy
                      ? "Procesando…"
                      : isRequest
                        ? "Solicitar enlace"
                        : "Activar mi acceso"}
                  </button>
                </fieldset>
              </form>
            )}

            {!isRequest && !success && (
              <Link
                to="/solicitar-acceso"
                className="mt-5 block text-brand-dark underline"
              >
                Solicitar otro enlace
              </Link>
            )}
          </>
        )}

        <Link
          to={signedIn ? "/inicio" : "/login"}
          className="mt-5 block text-brand-dark underline"
        >
          {signedIn
            ? "Volver a mi panel"
            : "Ir al inicio de sesión"}
        </Link>
      </section>
    </main>
  );
}