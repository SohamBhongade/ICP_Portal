"use client";

// Logout button — posts to the logoutAction server action (which clears the
// cookie and redirects to /login).

import { useT } from "@/components/i18n/LanguageProvider";
import { logoutAction } from "@/app/actions/auth";

export function LogoutButton() {
  const t = useT();
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-lavender"
      >
        {t("common.logout")}
      </button>
    </form>
  );
}
