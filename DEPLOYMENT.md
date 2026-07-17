# Phase 6 — Production Prep & Deployment

## 1. Database migration

Run once against production (Turso), after deploying the new code:

```bash
npx tsx db/migrate-phase6.ts
```

It is **idempotent** and does two things:

1. **Roles** — updates every legacy `teacher` user to `faculty` (attendance-only,
   matching a teacher's old permissions). Edit `DEFAULT_TEACHER_TARGET` in the
   script to `"staff"` if preferred. Existing `admin`/`student` rows are untouched.
2. **Courses** — normalizes legacy `B.Pharm`/`D.Pharm`/`M.Pharm` values to the
   canonical enum `B.pharm`/`D.pharm`/`M.pharm` on both the `users` table and the
   `course` dropdown options, so attendance/fees roster filters keep matching.

No schema DDL is required — SQLite stores enums as plain text, so the enum
narrowing in `db/schema.ts` needs no `ALTER TABLE`.

### Fees — no setup needed
"Development fees" and "Scholarship (fund)" are UI dropdown options written as
free-text `particulars` on `fee_ledgers` rows. They are **not** enums or separate
tables, so there is nothing to seed or migrate in production.

## 2. Environment config

**No new environment variables.** Unchanged from before:

| Var | Purpose |
|-----|---------|
| `TURSO_DATABASE_URL` | libSQL database URL (required) |
| `TURSO_AUTH_TOKEN` | libSQL auth token |
| `AUTH_SECRET` | session-cookie HMAC secret (required) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | optional support address |

- **English-only layout:** the language switcher and Hindi/Marathi dictionaries
  were removed at build time — no runtime config, no locale env vars.
- **Dashboard aggregation:** a plain `GROUP BY` on the existing `users` table —
  no new indexes, services, or connection settings required.

## 3. Deploy checklist

1. Merge & deploy the app build (`next build` — verified green).
2. Run `npx tsx db/migrate-phase6.ts` against production.
3. Smoke test: log in as admin, confirm the dashboard breakdown widget renders,
   and confirm a former-teacher account now lands on the attendance recorder.
