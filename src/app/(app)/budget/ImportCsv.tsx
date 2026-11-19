"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyMapping,
  detectMapping,
  looksLikeTransfer,
  money,
  monthLabel,
  parseCsv,
  type ColumnMapping,
} from "@/lib/budget";
import { autoCategorize, importTransactions, type ImportPayloadRow } from "./actions";

const CHUNK = 500;

// Import a bank or credit card CSV export: pick the file, check the
// columns it guessed, import. Rows already imported are skipped, so an
// overlapping export (e.g. "last 90 days" every month) is safe.
export default function ImportCsv({
  aiEnabled,
  onClose,
  onDone,
}: {
  aiEnabled: boolean;
  onClose: () => void;
  onDone: (latestMonth: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [account, setAccount] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ sorted: number; unsure: number; failed: boolean } | null>(null);
  const [result, setResult] = useState<{ inserted: number; duplicates: number; failed: boolean } | null>(null);

  async function load(file: File) {
    setReadError(null);
    setResult(null);
    if (!/\.(csv|txt)$/i.test(file.name) && file.type !== "text/csv") {
      setReadError("That isn't a CSV file. Download your transactions as CSV from your bank's website.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 1) {
      setReadError("That file is empty.");
      return;
    }
    setFileName(file.name);
    setAccount(""); // optional; file names like "2026 11 19 transaction download" aren't useful labels
    setRows(parsed);
    setMapping(detectMapping(parsed));
  }

  const mapped = useMemo(() => (rows && mapping ? applyMapping(rows, mapping) : null), [rows, mapping]);
  const headers = rows && mapping ? (mapping.hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`)) : [];
  const months = mapped ? [...new Set(mapped.rows.map((r) => r.date.slice(0, 7)))].sort() : [];
  const spentTotal = mapped
    ? mapped.rows.filter((r) => !looksLikeTransfer(r.description, r.amount)).reduce((s, r) => s + r.amount, 0)
    : 0;
  const mappingOk =
    mapping && mapping.date >= 0 && mapping.description >= 0 && (mapping.amount >= 0 || mapping.debit >= 0 || mapping.credit >= 0);

  async function runImport() {
    if (!mapped || mapped.rows.length === 0) return;
    setBusy(true);
    // Number identical rows (two $5 coffees at the same place on the same
    // day), so both import, and both are recognized on a re-import.
    const seen = new Map<string, number>();
    const payload: ImportPayloadRow[] = mapped.rows.map((r) => {
      const k = `${r.date}|${r.amount}|${r.description.toLowerCase()}`;
      const occ = seen.get(k) ?? 0;
      seen.set(k, occ + 1);
      return { ...r, occ };
    });
    let inserted = 0;
    let duplicates = 0;
    let failed = false;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const res = await importTransactions(payload.slice(i, i + CHUNK), account);
      if (!res.ok) {
        failed = true;
        break;
      }
      inserted += res.inserted;
      duplicates += res.duplicates;
    }
    setResult({ inserted, duplicates, failed });
    setAiResult(null);
    // New rows the merchant rules didn't cover go to Claude.
    if (aiEnabled && !failed && inserted > 0) {
      const r = await autoCategorize();
      setAiResult({ sorted: r.sorted, unsure: r.unsure, failed: !r.ok });
    }
    setBusy(false);
  }

  const setM = (patch: Partial<ColumnMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const colSelect = (value: number, onChange: (i: number) => void, allowNone = false) => (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-md border border-border bg-bg px-1.5 py-1 text-sm outline-none focus:border-accent"
    >
      {allowNone && <option value={-1}>None</option>}
      {value < 0 && !allowNone && <option value={-1}>Pick a column</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </select>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4" onClick={busy ? undefined : onClose}>
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold">Import transactions</h3>
          {!busy && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
              ✕
            </button>
          )}
        </div>

        {result && busy ? (
          <p className="py-6 text-center text-sm text-muted">
            Imported {result.inserted}. Claude is sorting them into your categories…
          </p>
        ) : result ? (
          <div className="flex flex-col gap-3 text-sm">
            {result.failed ? (
              <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-bad">
                The import stopped partway ({result.inserted} saved). Try again; anything already saved will be skipped.
              </p>
            ) : (
              <p>
                Imported <strong>{result.inserted}</strong> new transaction{result.inserted === 1 ? "" : "s"}
                {result.duplicates > 0 && `, and skipped ${result.duplicates} that were already here`}.
              </p>
            )}
            {aiResult &&
              (aiResult.failed ? (
                <p className="text-warn">Claude couldn&apos;t sort them this time. Use &ldquo;Sort with AI&rdquo; on the page to try again.</p>
              ) : aiResult.sorted > 0 ? (
                <p>
                  Claude sorted <strong>{aiResult.sorted}</strong> into your categories (tagged &ldquo;AI&rdquo;)
                  {aiResult.unsure > 0 && `. ${aiResult.unsure} merchant${aiResult.unsure === 1 ? " was" : "s were"} too vague and are left for you`}.
                </p>
              ) : null)}
            <p className="text-muted">
              Card payments and transfers come in as &ldquo;not counted&rdquo;. Give each merchant a category once and
              it&apos;s remembered for that merchant from then on.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRows(null);
                  setMapping(null);
                  setResult(null);
                }}
                className="rounded-md border border-border bg-bg px-3 py-1.5 hover:border-accent"
              >
                Import another file
              </button>
              <button
                type="button"
                onClick={() => onDone(months[months.length - 1] ?? null)}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : !rows || !mapping ? (
          <div className="flex flex-col gap-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) load(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-10 text-center ${
                dragOver ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"
              }`}
            >
              <span className="text-sm font-medium">Drop a CSV here, or click to choose one</span>
              <span className="text-xs text-muted">From your bank or credit card&apos;s website</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) load(f);
                e.target.value = "";
              }}
            />
            {readError && <p className="text-sm text-bad">{readError}</p>}
            <p className="text-xs text-muted">
              Most banks have this under Transactions or Statements: pick a date range and choose Download, then CSV
              (sometimes called &ldquo;Spreadsheet&rdquo; or &ldquo;Excel&rdquo;).
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Account name (optional)</span>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Chase Freedom"
                  className="rounded-md border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">File</span>
                <span className="truncate py-1">{fileName}</span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Date column</span>
                {colSelect(mapping.date, (i) => setM({ date: i }))}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Description column</span>
                {colSelect(mapping.description, (i) => setM({ description: i }))}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Amounts are in</span>
                <select
                  value={mapping.amount >= 0 || (mapping.debit < 0 && mapping.credit < 0) ? "one" : "two"}
                  onChange={(e) =>
                    e.target.value === "one"
                      ? setM({ amount: mapping.debit >= 0 ? mapping.debit : 0, debit: -1, credit: -1 })
                      : setM({ debit: mapping.amount >= 0 ? mapping.amount : 0, credit: -1, amount: -1 })
                  }
                  className="rounded-md border border-border bg-bg px-1.5 py-1 outline-none focus:border-accent"
                >
                  <option value="one">One amount column</option>
                  <option value="two">Separate debit and credit columns</option>
                </select>
              </label>
              {mapping.amount >= 0 || (mapping.debit < 0 && mapping.credit < 0) ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Amount column</span>
                    {colSelect(mapping.amount, (i) => setM({ amount: i }))}
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="text-xs text-muted">In this file, purchases are</span>
                    <select
                      value={mapping.purchasesNegative ? "neg" : "pos"}
                      onChange={(e) => setM({ purchasesNegative: e.target.value === "neg" })}
                      className="rounded-md border border-border bg-bg px-1.5 py-1 outline-none focus:border-accent"
                    >
                      <option value="neg">Negative numbers (like −12.50)</option>
                      <option value="pos">Positive numbers (like 12.50)</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Money out (debit) column</span>
                    {colSelect(mapping.debit, (i) => setM({ debit: i }), true)}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Money in (credit) column</span>
                    {colSelect(mapping.credit, (i) => setM({ credit: i }), true)}
                  </label>
                </>
              )}
            </div>

            {mapped && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">
                  {mapped.rows.length} transactions
                  {months.length > 0 &&
                    ` from ${monthLabel(months[0])}${months.length > 1 ? ` to ${monthLabel(months[months.length - 1])}` : ""}`}
                  {mapped.skipped > 0 && ` · ${mapped.skipped} rows couldn't be read and will be skipped`}
                  {mapped.rows.length > 0 && ` · about ${money(spentTotal, true)} of spending`}
                </p>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full table-fixed text-xs">
                    <thead className="bg-bg text-left text-muted">
                      <tr>
                        <th className="w-24 px-2 py-1.5 font-normal">Date</th>
                        <th className="px-2 py-1.5 font-normal">Description</th>
                        <th className="w-24 px-2 py-1.5 text-right font-normal">Spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.rows.slice(0, 6).map((r, i) => (
                        <tr key={i} className="border-t border-border/70">
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums">{r.date}</td>
                          <td className="truncate px-2 py-1">{r.description}</td>
                          <td className={`px-2 py-1 text-right tabular-nums ${r.amount < 0 ? "text-good" : ""}`}>
                            {r.amount < 0 ? `−${money(-r.amount)}` : money(r.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  Purchases should show as positive here and refunds in green. If they&apos;re the wrong way round, flip
                  &ldquo;purchases are&rdquo; above.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRows(null);
                  setMapping(null);
                }}
                className="rounded-md px-3 py-1.5 text-muted hover:text-text disabled:opacity-40"
              >
                Choose a different file
              </button>
              <button
                type="button"
                disabled={busy || !mappingOk || !mapped || mapped.rows.length === 0}
                onClick={runImport}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Importing…" : `Import ${mapped?.rows.length ?? 0}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
