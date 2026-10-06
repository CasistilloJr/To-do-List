import { useState } from "react";
import type { FormEvent } from "react";

type RegisterProps = {
  onBack: () => void;
  onRegistered: (email: string) => void;
};

export default function Register({
  onBack,
  onRegistered,
}: RegisterProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (name.trim().length < 2) {
      setError("Escribe un nombre de al menos 2 caracteres.");
      return;
    }

    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: normalizedEmail,
          phone,
          password,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message ?? "No se pudo crear la cuenta."
        );
      }

      onRegistered(normalizedEmail);
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
    <main className="min-h-screen bg-brand-soft px-4 py-10">
      <section className="mx-auto max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <img
          src="/logo-castle-pets.jpeg"
          alt="Castle Pet’s"
          className="mx-auto h-24 w-24 rounded-full object-cover"
        />

        <h1 className="mt-5 text-center text-2xl font-bold text-ink">
          Crea tu cuenta
        </h1>

        <p className="mt-2 text-center text-muted">
          Regístrate como cliente de Castle Pet’s.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-danger-soft p-3 text-danger"
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="register-name"
              className="mb-2 block font-semibold"
            >
              Nombre completo
            </label>

            <input
              id="register-name"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="mb-2 block font-semibold"
            >
              Correo electrónico
            </label>

            <input
              id="register-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="register-phone"
              className="mb-2 block font-semibold"
            >
              Teléfono
            </label>

            <input
              id="register-phone"
              type="tel"
              autoComplete="tel-national"
              inputMode="numeric"
              required
              pattern="[0-9]{10}"
              maxLength={10}
              title="Escribe los 10 dígitos de tu teléfono."
              aria-describedby="phone-help"
              value={phone}
              onChange={(event) =>
                setPhone(
                  event.target.value.replace(/\D/g, "").slice(0, 10)
                )
              }
              className={inputClass}
            />

            <p id="phone-help" className="mt-1 text-sm text-muted">
              Número mexicano de 10 dígitos, sin +52.
            </p>
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="mb-2 block font-semibold"
            >
              Contraseña
            </label>

            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="password-help"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />

            <p id="password-help" className="mt-1 text-sm text-muted">
              Usa entre 12 y 128 caracteres.
            </p>
          </div>

          <div>
            <label
              htmlFor="register-confirmation"
              className="mb-2 block font-semibold"
            >
              Repite la contraseña
            </label>

            <input
              id="register-confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={confirmation}
              onChange={(event) =>
                setConfirmation(event.target.value)
              }
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-dark px-5 py-3 font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? "Creando cuenta…" : "Crear cuenta"}
          </button>

          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="w-full rounded-xl border border-brand-dark px-5 py-3 font-semibold text-brand-dark disabled:opacity-60"
          >
            Volver al inicio de sesión
          </button>
        </form>
      </section>
    </main>
  );
}