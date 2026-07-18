"use client";

// Login screen. Single form with a student/staff toggle: students sign in with
// their Student ID, staff with email. Errors come back as codes and are
// translated via useT().

import { useActionState, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { loginAction, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const t = useT();
  const [mode, setMode] = useState<"student" | "staff">("student");
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      {/* Campus backdrop — decorative only.
          - `fixed inset-0` already spans the viewport (no h-screen, which
            overshoots on mobile browsers with a collapsing URL bar).
          - `z-0` (not -z-10) so it paints ABOVE <main>'s own bg-canvas fill;
            a negative z-index would hide it behind that opaque background.
          - `scale-105` + `overflow-hidden` keeps the 1px blur from feathering
            transparent edges into the viewport corners. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <Image
          src="/campus-bg.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="scale-105 object-cover opacity-65 blur-[1px]"
        />
        {/* Light vignette only — top/bottom anchor the brand text and footer
            link, while the middle stays clear so the campus reads at full
            strength behind the card. */}
        <div className="absolute inset-0 bg-gradient-to-b from-canvas/35 via-transparent to-canvas/45" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand — sits directly on the photo, so a soft light halo keeps the
            dark ink legible over bright OR busy regions of the image.
            text-shadow inherits, so both lines are covered. */}
        <div className="mb-6 flex flex-col items-center gap-4 text-center [text-shadow:0_1px_6px_rgb(255_255_255/0.95),0_0_2px_rgb(255_255_255/0.9)]">
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {t("common.appName")}
            </h1>
            <p className="mt-1 text-sm text-muted">{t("common.collegeName")}</p>
          </div>
        </div>

        {/* bg-surface/95 (= white/95) + backdrop-blur-md: the blur neutralizes
            the photo detail behind the remaining 5%, so the card reads as solid
            and every field/label holds full AA contrast. shadow-2xl lifts it
            clearly off the now much more vivid backdrop. */}
        <div className="rounded-lg border border-line bg-surface/95 p-6 shadow-2xl ring-1 ring-line/50 backdrop-blur-md sm:p-8">
          <h2 className="text-lg font-semibold text-ink">{t("login.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("login.subtitle")}</p>

          {/* Student / Staff toggle */}
          <div
            role="tablist"
            aria-label={t("login.title")}
            className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1"
          >
            {(["student", "staff"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-ink hover:bg-lavender"
                }`}
              >
                {m === "student" ? t("login.studentTab") : t("login.staffTab")}
              </button>
            ))}
          </div>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="locale" value="en" />

            <div>
              <label
                htmlFor="identifier"
                className="mb-1 block text-sm font-medium text-ink"
              >
                {mode === "student"
                  ? t("login.studentIdLabel")
                  : t("login.emailLabel")}
              </label>
              <input
                id="identifier"
                name="identifier"
                type={mode === "student" ? "text" : "email"}
                inputMode={mode === "student" ? "text" : "email"}
                autoComplete={mode === "student" ? "username" : "email"}
                required
                placeholder={
                  mode === "student"
                    ? t("login.studentIdPlaceholder")
                    : t("login.emailPlaceholder")
                }
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-teal"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-ink"
              >
                {t("login.passwordLabel")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder={t("login.passwordPlaceholder")}
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 pr-10 text-sm text-ink placeholder:text-muted focus:border-teal"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={
                    showPassword
                      ? t("login.hidePassword")
                      : t("login.showPassword")
                  }
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-ink"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {state.error && (
              <p
                role="alert"
                aria-live="polite"
                className="rounded-md bg-lavender px-3 py-2 text-sm text-danger"
              >
                {t(`login.errors.${state.error}`)}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? t("login.signingIn") : t("login.submit")}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-muted">
            {t("login.noAccount")}{" "}
            <Link
              href="/request-account"
              className="font-medium text-primary hover:text-primary-hover"
            >
              {t("login.requestAccount")}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
