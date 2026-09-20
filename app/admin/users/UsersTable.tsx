"use client";

// Admin > Users — frozen-column data grid (Phase 8, extended in Phase 9).
//
// ARCHITECTURE: native <table> + CSS `position: sticky`, no virtualization
// library. See the notes on `columnWidth` in lib/table-layout.ts for why the
// widths are declared rather than measured.
//
// Three rules make this work and are easy to break by accident:
//
//  1. `table-layout: fixed` + a <colgroup>. A frozen column is offset by
//     `left: <sum of widths before it>`, so those widths must be authoritative.
//     Fixed layout also means the browser resolves the grid from the colgroup
//     instead of measuring every cell — the single biggest win at row scale.
//
//  2. `border-separate; border-spacing: 0`. Under the collapsed border model,
//     borders belong to the table rather than to the cell and visibly fail to
//     travel with a sticky cell in Chrome and Safari.
//
//  3. Stacking order is explicit: scrolling body cells (auto) < frozen body
//     cells (z-20) < the sticky header (z-30) < the header's own frozen corner
//     cells (z-40). Every sticky cell also needs an opaque background, or the
//     rows it overlaps show through it.
//
// PHASE 9 adds two things to the same structure, without changing any of the
// above: the selection checkbox is simply the first entry of the frozen-left
// rail (its width was already reserved), and admin-defined columns are ordinary
// middle columns addressed by a `custom:<key>` column key.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Inbox, Pencil, Trash2 } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { formatDisplayDate } from "@/lib/dates";
import {
  USERS_COLUMN_LABEL_KEY,
  columnWidth,
  fieldKeyFromColumn,
  isBuiltInColumn,
  splitPinnedColumns,
  stickyLeftOffsets,
  type ColumnKey,
  type UsersColumnKey,
} from "@/lib/table-layout";
import {
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  type CustomField,
  type UserRow,
} from "./types";

type Translator = ReturnType<typeof useT>;

/** Shared cell chrome. Compact padding so more columns fit on a laptop screen. */
const CELL = "border-b border-line px-3 py-2.5 align-middle";
const HEAD_CELL =
  "border-b border-line bg-canvas px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted";

/** Below this the grid switches to the card list — see the note on UsersCardList. */
const TABLE_MEDIA_QUERY = "(min-width: 768px)";

/** Bounded scroll box: never taller than 68% of the viewport, never shorter
 *  than a few rows, so the surrounding page chrome stays put. */
const SCROLL_BOX = "max-h-[min(68vh,42rem)] min-h-[14rem]";

/** The selection column's synthetic key inside the frozen-left rail. */
const SELECT_KEY = "select";

export type SelectionApi = {
  /** Currently selected row ids. Always a subset of what is on screen. */
  selected: ReadonlySet<number>;
  /** Toggle one row. */
  toggle: (id: number) => void;
  /** Select or clear every row in the CURRENT filtered result set. */
  toggleAll: (checked: boolean) => void;
};

type GridProps = {
  rows: UserRow[];
  /** Visible columns, in the admin's saved order. May include `custom:<key>`. */
  columns: ColumnKey[];
  /** Live custom column definitions, for header labels and cell rendering. */
  customFields: CustomField[];
  /** Unfiltered row count — lets the empty state distinguish "no users yet"
   *  from "your filters matched nothing". */
  totalCount: number;
  canEditStudents: boolean;
  canDelete: boolean;
  onEdit: (user: UserRow) => void;
  onDelete: (user: UserRow) => void;
  /** Omitted when the viewer may not bulk-select (no `deleteUsers`). */
  selection?: SelectionApi;
};

export function UsersTable(props: GridProps) {
  // A real grid needs roughly 700px before it stops being readable and starts
  // being a scroll puzzle. Under 768px we render a card list instead — same
  // data, same actions, no horizontal scrolling at all.
  const isTable = useMediaQuery(TABLE_MEDIA_QUERY);
  return isTable ? <UsersGrid {...props} /> : <UsersCardList {...props} />;
}

function UsersGrid({
  rows,
  columns,
  customFields,
  totalCount,
  canEditStudents,
  canDelete,
  onEdit,
  onDelete,
  selection,
}: GridProps) {
  const t = useT();
  const canManage = canEditStudents || canDelete;
  const fieldByKey = new Map(customFields.map((f) => [f.key, f]));

  // The selection checkbox is the first entry of the frozen-left rail; its
  // width was reserved in the width table from the start, so adding it here
  // recomputes every offset below with no other change.
  const { left, middle } = splitPinnedColumns(columns);
  const leftKeys: string[] = selection ? [SELECT_KEY, ...left] : left;
  const leftOffsets = stickyLeftOffsets(leftKeys);

  const declaredWidth =
    leftKeys.reduce((sum, key) => sum + columnWidth(key), 0) +
    middle.reduce((sum, key) => sum + columnWidth(key), 0) +
    (canManage ? columnWidth("actions") : 0);

  // Header checkbox state. "All" means every row in the CURRENT filtered set —
  // selection never reaches beyond what the operator can see.
  const selectedHere = selection
    ? rows.filter((r) => selection.selected.has(r.id)).length
    : 0;
  const allSelected = rows.length > 0 && selectedHere === rows.length;
  const someSelected = selectedHere > 0 && !allSelected;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  // Track whether scrollable content is hiding behind either frozen rail. The
  // result is written to `data-edge-*` on the container and the shadows are
  // pure CSS (globals.css), so scrolling never re-renders a row.
  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const next = {
      left: el.scrollLeft > 1,
      // 1px of slack: fractional layout widths mean scrollLeft rarely lands
      // exactly on maxScroll, which would leave the shadow stuck on at the end.
      right: maxScroll > 1 && el.scrollLeft < maxScroll - 1,
    };
    setEdge((prev) =>
      prev.left === next.left && prev.right === next.right ? prev : next,
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncEdges();
    // passive: the handler only reads geometry, so tell the browser it will
    // never call preventDefault and let the scroll stay off the main thread.
    el.addEventListener("scroll", syncEdges, { passive: true });
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      observer.disconnect();
    };
  }, [syncEdges]);

  // Toggling a column changes scrollWidth without firing a scroll event.
  useEffect(syncEdges, [syncEdges, columns, rows.length, canManage]);

  return (
    // `isolate` gives the grid its own stacking context, so the frozen cells'
    // z-20…z-40 layers stay INSIDE the table. Without it they compete with the
    // app's global layers and the frozen header corner paints over the
    // slide-out sidebar.
    <div className="isolate overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <div
        ref={scrollRef}
        data-edge-left={edge.left}
        data-edge-right={edge.right}
        tabIndex={0}
        role="region"
        aria-label={t("onboarding.tableRegion")}
        // `overflow-auto` bounds BOTH axes to this element, and
        // `overscroll-x-contain` stops a horizontal fling from chaining out to
        // the document once the rail hits its end. Together these are what keep
        // the page itself from ever scrolling sideways.
        className={`relative ${SCROLL_BOX} overflow-auto overscroll-x-contain`}
      >
        <table
          className="w-full border-separate border-spacing-0 text-left text-sm"
          style={{ minWidth: declaredWidth, tableLayout: "fixed" }}
        >
          <colgroup>
            {leftKeys.map((key) => (
              <col key={key} style={{ width: columnWidth(key) }} />
            ))}
            {middle.map((key) => (
              <col key={key} style={{ width: columnWidth(key) }} />
            ))}
            {canManage && <col style={{ width: columnWidth("actions") }} />}
          </colgroup>

          <thead>
            <tr>
              {leftKeys.map((key, i) => (
                <th
                  key={key}
                  scope="col"
                  // z-40: the top-left corner outranks both the sticky header
                  // row and the frozen body cells it crosses.
                  className={`${HEAD_CELL} sticky top-0 z-40 whitespace-nowrap ${
                    i === leftKeys.length - 1 ? "dt-pin-left-edge" : ""
                  }`}
                  style={{ left: leftOffsets[i] }}
                >
                  {key === SELECT_KEY ? (
                    <SelectAllCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={rows.length === 0}
                      onChange={(next) => selection?.toggleAll(next)}
                      label={t("onboarding.bulk.selectAllFiltered", {
                        count: rows.length,
                      })}
                    />
                  ) : (
                    t(USERS_COLUMN_LABEL_KEY[key as UsersColumnKey])
                  )}
                </th>
              ))}
              {middle.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className={`${HEAD_CELL} sticky top-0 z-30`}
                >
                  <span className="block truncate" title={headerLabel(key, fieldByKey, t)}>
                    {headerLabel(key, fieldByKey, t)}
                  </span>
                </th>
              ))}
              {canManage && (
                <th
                  scope="col"
                  className={`${HEAD_CELL} dt-pin-right-edge sticky right-0 top-0 z-40`}
                >
                  {t("onboarding.colActions")}
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={leftKeys.length + middle.length + (canManage ? 1 : 0)}
                  className="px-4 py-16"
                >
                  <EmptyState filtered={totalCount > 0} />
                </td>
              </tr>
            ) : (
              rows.map((user) => (
                <UserTableRow
                  key={user.id}
                  user={user}
                  leftKeys={leftKeys}
                  leftOffsets={leftOffsets}
                  middle={middle}
                  fieldByKey={fieldByKey}
                  canEditStudents={canEditStudents}
                  canDelete={canDelete}
                  canManage={canManage}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  selected={selection?.selected.has(user.id) ?? false}
                  onToggleSelect={selection?.toggle}
                  t={t}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Header checkbox with a real `indeterminate` state.
 *
 * `indeterminate` is a DOM PROPERTY with no HTML attribute, so React cannot set
 * it declaratively — it has to be written to the node in an effect. Without it
 * a partial selection renders identically to an empty one, which is precisely
 * the state the operator most needs to see.
 */
function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      title={label}
      className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** Header text for a middle column: an i18n key for built-ins, the admin's own
 *  label for a custom one. */
function headerLabel(
  key: ColumnKey,
  fieldByKey: Map<string, CustomField>,
  t: Translator,
): string {
  if (isBuiltInColumn(key)) return t(USERS_COLUMN_LABEL_KEY[key]);
  const fieldKey = fieldKeyFromColumn(key);
  return (fieldKey && fieldByKey.get(fieldKey)?.label) || key;
}

/**
 * One body row.
 *
 * Memoized on purpose: at several hundred rows the cost that matters is React
 * re-rendering the whole tbody whenever unrelated parent state moves (a toast
 * arriving, the scroll-edge flags flipping). Every prop here is a primitive or
 * a value the parent keeps stable, so a parent re-render skips the rows.
 *
 * `selected` is a boolean rather than the whole Set for exactly this reason:
 * passing the Set would re-render every row on every checkbox click, whereas a
 * boolean re-renders only the row whose state actually changed.
 */
const UserTableRow = memo(function UserTableRow({
  user,
  leftKeys,
  leftOffsets,
  middle,
  fieldByKey,
  canEditStudents,
  canDelete,
  canManage,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
  t,
}: {
  user: UserRow;
  leftKeys: string[];
  leftOffsets: number[];
  middle: ColumnKey[];
  fieldByKey: Map<string, CustomField>;
  canEditStudents: boolean;
  canDelete: boolean;
  canManage: boolean;
  onEdit: (user: UserRow) => void;
  onDelete: (user: UserRow) => void;
  selected: boolean;
  onToggleSelect?: (id: number) => void;
  t: Translator;
}) {
  return (
    <tr className={`group/row ${selected ? "bg-lavender/50" : ""}`}>
      {leftKeys.map((key, i) => (
        <td
          key={key}
          // Frozen body cells need their own opaque background (or the
          // scrolling cells read through them) and must repeat the row hover,
          // since a background on the <tr> paints beneath the cell's own.
          className={`${CELL} sticky z-20 transition-colors group-hover/row:bg-canvas ${
            selected ? "bg-lavender" : "bg-surface"
          } ${i === leftKeys.length - 1 ? "dt-pin-left-edge" : ""}`}
          style={{ left: leftOffsets[i] }}
        >
          {key === SELECT_KEY ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(user.id)}
              aria-label={`${t("onboarding.bulk.selectRow")}: ${user.fullName}`}
              className="size-4 cursor-pointer accent-primary"
            />
          ) : (
            <CellValue
              column={key as UsersColumnKey}
              user={user}
              fieldByKey={fieldByKey}
              t={t}
            />
          )}
        </td>
      ))}

      {middle.map((key) => (
        <td
          key={key}
          className={`${CELL} transition-colors group-hover/row:bg-canvas`}
        >
          <CellValue column={key} user={user} fieldByKey={fieldByKey} t={t} />
        </td>
      ))}

      {canManage && (
        <td
          className={`${CELL} dt-pin-right-edge sticky right-0 z-20 transition-colors group-hover/row:bg-canvas ${
            selected ? "bg-lavender" : "bg-surface"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {canEditStudents && (
              <button
                type="button"
                onClick={() => onEdit(user)}
                aria-label={`${t("onboarding.edit")}: ${user.fullName}`}
                title={t("onboarding.edit")}
                className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line p-1.5 text-ink hover:border-teal hover:bg-lavender"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete(user)}
                aria-label={`${t("onboarding.delete")}: ${user.fullName}`}
                title={t("onboarding.delete")}
                className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line p-1.5 text-danger hover:border-danger/40 hover:bg-danger/10"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
});

/**
 * Format a joined date defensively — the value crosses the RSC boundary and may
 * arrive as a Date, an ISO string, or an epoch number.
 *
 * Uses formatDisplayDate, which pins BOTH locale and time zone. A plain
 * `toLocaleDateString(undefined, ...)` falls back to the host default, so the
 * server (en-US, UTC) and the browser (the visitor's locale and zone) produce
 * different strings for the same date — a hydration mismatch on every
 * non-en-US visitor, with the column visibly changing after load.
 */
function formatJoined(value: Date | string | number | null): string {
  return formatDisplayDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Plain-text value for a column — also what the `title` tooltip shows. */
function columnText(
  column: ColumnKey,
  u: UserRow,
  t: Translator,
): string {
  if (!isBuiltInColumn(column)) {
    // Custom column. Values are keyed by FIELD key, not by the `custom:` key.
    const fieldKey = fieldKeyFromColumn(column);
    return (fieldKey && u.custom[fieldKey]) || "—";
  }
  switch (column) {
    case "name":
      return u.fullName;
    case "rollNo":
      return u.studentId ?? "—";
    case "email":
      return u.email ?? "—";
    case "phone":
      return u.phone ?? "—";
    case "role":
      return t(ROLE_LABEL[u.role]);
    case "course":
      return u.course ?? "—";
    case "className":
      return u.className ?? "—";
    case "admissionYear":
      return u.admissionYear != null ? String(u.admissionYear) : "—";
    case "status":
      return t(STATUS_LABEL[u.status]);
    case "joinedDate":
      return formatJoined(u.createdAt);
  }
}

/**
 * Cell contents for one column. Every text value is clamped to a single line
 * with an ellipsis and carries a `title`, so a long email can never widen a
 * fixed-width column or push the frozen offsets out of alignment.
 */
function CellValue({
  column,
  user: u,
  fieldByKey,
  t,
}: {
  column: ColumnKey;
  user: UserRow;
  fieldByKey: Map<string, CustomField>;
  t: Translator;
}) {
  if (column === "status") {
    return (
      <span
        className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[u.status]}`}
      >
        {t(STATUS_LABEL[u.status])}
      </span>
    );
  }

  const text = columnText(column, u, t);
  const custom = !isBuiltInColumn(column);
  const fieldKey = custom ? fieldKeyFromColumn(column) : null;
  const field = fieldKey ? fieldByKey.get(fieldKey) : undefined;

  const tone =
    column === "name"
      ? "font-medium text-ink"
      : column === "role"
        ? "text-ink"
        : "text-muted";
  // Numbers and dates read better right-aligned to a common figure width.
  const numeric =
    column === "joinedDate" ||
    column === "rollNo" ||
    column === "admissionYear" ||
    field?.type === "number" ||
    field?.type === "date";

  return (
    <span
      title={text}
      // The name wraps onto a second line instead of truncating, so a long full
      // name stays readable in a column sized for the rest of the grid to fit.
      className={`block ${column === "name" ? "line-clamp-2 break-words" : "truncate"} ${custom ? "text-muted" : tone} ${
        numeric ? "[font-variant-numeric:tabular-nums]" : ""
      }`}
    >
      {text}
    </span>
  );
}

/**
 * Mobile fallback (< 768px). A nine-column grid cannot be made usable on a
 * 390px phone by any amount of freezing, so the same rows render as cards:
 * name + roll number as the heading, the remaining visible columns as a
 * definition list, and the same Edit / Delete actions. Selection works here
 * too — the checkbox moves into the card header.
 */
function UsersCardList({
  rows,
  columns,
  customFields,
  totalCount,
  canEditStudents,
  canDelete,
  onEdit,
  onDelete,
  selection,
}: GridProps) {
  const t = useT();
  const canManage = canEditStudents || canDelete;
  const fieldByKey = new Map(customFields.map((f) => [f.key, f]));

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-8 shadow-sm">
        <EmptyState filtered={totalCount > 0} />
      </div>
    );
  }

  // Name and roll number are promoted into the card header, so the detail list
  // shows everything else the admin has chosen to keep visible.
  const details = columns.filter((k) => k !== "name" && k !== "rollNo");
  const showsName = columns.includes("name");
  const showsRoll = columns.includes("rollNo");

  return (
    <ul
      className={`flex ${SCROLL_BOX} flex-col gap-3 overflow-y-auto overscroll-y-contain`}
    >
      {rows.map((u) => {
        const selected = selection?.selected.has(u.id) ?? false;
        return (
          <li
            key={u.id}
            className={`rounded-lg border bg-surface p-4 shadow-sm ${
              selected ? "border-primary bg-lavender/40" : "border-line"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {selection && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => selection.toggle(u.id)}
                    aria-label={`${t("onboarding.bulk.selectRow")}: ${u.fullName}`}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                  />
                )}
                <div className="min-w-0">
                  {showsName && (
                    <p className="truncate font-medium text-ink" title={u.fullName}>
                      {u.fullName}
                    </p>
                  )}
                  {showsRoll && (
                    <p className="truncate text-xs text-muted [font-variant-numeric:tabular-nums]">
                      {u.studentId ?? "—"}
                    </p>
                  )}
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {canEditStudents && (
                    <button
                      type="button"
                      onClick={() => onEdit(u)}
                      aria-label={`${t("onboarding.edit")}: ${u.fullName}`}
                      className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line p-2 text-ink hover:border-teal hover:bg-lavender"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(u)}
                      aria-label={`${t("onboarding.delete")}: ${u.fullName}`}
                      className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line p-2 text-danger hover:border-danger/40 hover:bg-danger/10"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </div>

            {details.length > 0 && (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-sm">
                {details.map((key) => (
                  <div key={key} className="contents">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                      {headerLabel(key, fieldByKey, t)}
                    </dt>
                    <dd className="min-w-0">
                      <CellValue
                        column={key}
                        user={u}
                        fieldByKey={fieldByKey}
                        t={t}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Empty state — distinguishes an over-narrow filter from an empty roster. */
function EmptyState({ filtered }: { filtered: boolean }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <span className="rounded-full bg-lavender p-3 text-primary">
        <Inbox className="size-6" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-ink">
        {filtered ? t("onboarding.noResults") : t("onboarding.emptyTitle")}
      </p>
      <p className="text-sm text-muted">
        {filtered ? t("onboarding.noResultsHint") : t("onboarding.emptyHint")}
      </p>
    </div>
  );
}

/**
 * Loading skeleton. Mirrors the real grid's chrome (same container, same
 * bounded height, same row rhythm) so swapping in the real table does not
 * shift the layout underneath it.
 */
export function UsersTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading users"
      className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
    >
      <div className="flex h-11 items-center gap-4 border-b border-line bg-canvas px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-2.5 flex-1 animate-pulse rounded bg-line" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0"
        >
          {Array.from({ length: 5 }).map((_, c) => (
            <div
              key={c}
              className="h-3 flex-1 animate-pulse rounded bg-lavender"
              style={{ animationDelay: `${(r * 5 + c) * 25}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
