// Pure helpers for the Budget page (src/app/(app)/budget/): types, CSV
// parsing and column detection, merchant keys for learned category rules,
// and month math. No server or browser APIs here, so both sides can use it.

export interface BudgetCategory {
  id: string;
  name: string;
  color: string; // hue key from memoryColors.ts
  sort_order: number;
}

export interface BudgetSplit {
  id: string;
  category_id: string | null;
  amount: number;
}

export interface BudgetTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive = spent, negative = refund/credit
  category_id: string | null;
  account: string | null;
  excluded: boolean;
  auto: boolean; // category picked by Claude, not by you
  reimbursed: number; // paid back by others; only amount - reimbursed counts
  splits: BudgetSplit[];
}

// A row ready to import, after the column mapping has been applied.
export interface ImportRow {
  date: string;
  description: string;
  amount: number;
}

export const STARTER_CATEGORIES: { name: string; color: string }[] = [
  { name: "Groceries", color: "green" },
  { name: "Dining Out", color: "orange" },
  { name: "Transportation", color: "blue" },
  { name: "Shopping", color: "purple" },
  { name: "Entertainment", color: "pink" },
  { name: "Subscriptions", color: "teal" },
  { name: "Bills & Utilities", color: "brown" },
  { name: "Health", color: "red" },
  { name: "Other", color: "gray" },
];

// ---- Money & months ------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_ROUND = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function money(n: number, round = false): string {
  return (round ? USD_ROUND : USD).format(n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const MONTH_RE = /^\d{4}-\d{2}$/;

// "2026-11" -> "2026-11-01", the form stored in the database.
export function monthStart(month: string): string {
  return `${month}-01`;
}

// First day of the following month, for date < end range queries.
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// How a transaction's amount divides among categories: its splits when it
// has them, otherwise all of it in its one category (null = uncategorized).
// What the charge actually cost you after others paid you back.
export function myShare(t: BudgetTransaction): number {
  return round2(t.amount - (t.reimbursed ?? 0));
}

export function allocationsOf(t: BudgetTransaction): { category_id: string | null; amount: number }[] {
  if (t.excluded) return [];
  if (t.splits.length > 0) return t.splits.map((s) => ({ category_id: s.category_id, amount: s.amount }));
  return [{ category_id: t.category_id, amount: myShare(t) }];
}

// ---- Merchant keys -------------------------------------------------------

// Strips the noise card statements add around a merchant name, so
// "SQ *BLUE BOTTLE COFFEE 0123 NEW YORK NY" and "SQ *BLUE BOTTLE COFFEE
// 9981 BROOKLYN NY" share a rule. Deliberately simple and predictable.
export function merchantKey(description: string): string {
  let s = description.toUpperCase();
  s = s.replace(/^(SQ|TST|SP|PP|PAYPAL|POS|DEBIT CARD PURCHASE|PURCHASE AUTHORIZED ON \d+\/\d+)\s*\*?\s*/, "");
  s = s.replace(/[#*]/g, " ");
  s = s.replace(/\b\d[\d\-/.]*\b/g, " "); // store numbers, dates, refs
  s = s.replace(/\b[A-Z]{2}\s*$/, ""); // trailing state code
  s = s.replace(/[^A-Z&' ]/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(Boolean).slice(0, 3);
  return words.join(" ") || description.trim().toUpperCase().slice(0, 40);
}

// ---- CSV -----------------------------------------------------------------

// RFC 4180-ish: quoted fields, doubled quotes, commas/newlines in quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

// Dates as banks write them: 2026-11-03, 11/03/2026, 11/3/26, 11-03-2026.
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return ymd(y, Number(m[1]), Number(m[2]));
  }
  return null;
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "$1,234.56", "(12.00)", "-12", "12.00 CR" -> number, or null.
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bCR$/i.test(s)) {
    neg = !neg;
    s = s.replace(/\s*CR$/i, "");
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  description: number;
  // Either one signed amount column, or separate debit/credit columns.
  amount: number; // -1 when using debit/credit
  debit: number; // -1 when unused
  credit: number; // -1 when unused
  // For a single amount column: are purchases negative (Chase, Bank of
  // America) or positive (Amex, Discover)?
  purchasesNegative: boolean;
}

const find = (headers: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

// Guesses the mapping from the header row (and the data when there's no
// header). The import screen shows the guess and lets it be changed.
export function detectMapping(rows: string[][]): ColumnMapping {
  const first = rows[0] ?? [];
  const hasHeader = first.length > 0 && first.every((f) => parseAmount(f) === null && parseDate(f) === null);
  const headers = hasHeader ? first.map((h) => h.toLowerCase()) : [];
  const data = hasHeader ? rows.slice(1) : rows;
  const sample = data.slice(0, 30);
  const width = Math.max(0, ...rows.map((r) => r.length));

  let date = -1;
  let description = -1;
  let amount = -1;
  let debit = -1;
  let credit = -1;
  if (hasHeader) {
    date = find(headers, /^(transaction|trans\.?)\s*date/, /^date$/, /posted|posting date|post date/, /date/);
    description = find(headers, /^description$/, /description|merchant|payee|name|details|memo/);
    debit = find(headers, /^debit|withdrawal|money out|charges?$/);
    credit = find(headers, /^credit|deposit|money in|payments?$/);
    amount = find(headers, /^amount$/, /amount/);
    if (amount >= 0) {
      debit = -1;
      credit = -1;
    }
    // "Details" on Chase checking is DEBIT/CREDIT, not the merchant.
    if (description >= 0 && headers[description] === "details" && headers.includes("description")) {
      description = headers.indexOf("description");
    }
  }
  const colOk = (i: number, test: (s: string) => boolean) =>
    sample.filter((r) => r[i] !== undefined && r[i] !== "").length > 0 &&
    sample.filter((r) => r[i] && test(r[i])).length >= sample.filter((r) => r[i]).length * 0.8;
  if (date < 0) for (let i = 0; i < width && date < 0; i++) if (colOk(i, (s) => parseDate(s) !== null)) date = i;
  if (amount < 0 && debit < 0) {
    for (let i = width - 1; i >= 0; i--) {
      if (i !== date && colOk(i, (s) => parseAmount(s) !== null)) {
        amount = i;
        // Prefer the left-most amount-like column (the right-most is often a balance).
      }
    }
  }
  if (description < 0) {
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (i === date || i === amount) continue;
      const len = sample.reduce((s, r) => s + (r[i] && parseAmount(r[i]) === null ? r[i].length : 0), 0);
      if (len > bestLen) {
        best = i;
        bestLen = len;
      }
    }
    description = best;
  }

  // Sign convention: in a card export most rows are purchases, so if most
  // amounts are negative, purchases are negative.
  let purchasesNegative = false;
  if (amount >= 0) {
    // Card payments and paychecks run the other way, so they don't vote.
    const vals = sample
      .filter((r) => description < 0 || !PAYMENTISH.test(r[description] ?? ""))
      .map((r) => parseAmount(r[amount] ?? ""))
      .filter((n): n is number => n !== null && n !== 0);
    purchasesNegative = vals.filter((n) => n < 0).length > vals.length / 2;
  }
  return { hasHeader, date, description, amount, debit, credit, purchasesNegative };
}

export interface MappedResult {
  rows: ImportRow[];
  skipped: number; // rows that couldn't be read
}

// Applies a mapping. Amounts come out as spending-positive.
export function applyMapping(rows: string[][], m: ColumnMapping): MappedResult {
  const data = m.hasHeader ? rows.slice(1) : rows;
  const out: ImportRow[] = [];
  let skipped = 0;
  for (const r of data) {
    const date = parseDate(r[m.date] ?? "");
    const description = (r[m.description] ?? "").replace(/\s+/g, " ").trim();
    let amount: number | null = null;
    if (m.amount >= 0) {
      const a = parseAmount(r[m.amount] ?? "");
      if (a !== null) amount = m.purchasesNegative ? -a : a;
    } else {
      const d = m.debit >= 0 ? parseAmount(r[m.debit] ?? "") : null;
      const c = m.credit >= 0 ? parseAmount(r[m.credit] ?? "") : null;
      if (d !== null || c !== null) amount = Math.abs(d ?? 0) - Math.abs(c ?? 0);
    }
    if (!date || !description || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    out.push({ date, description: description.slice(0, 300), amount: round2(amount) });
  }
  return { rows: out, skipped };
}

const PAYMENTISH = /\b(payment|thank you|autopay|transfer|xfer|direct dep|payroll|deposit|interest paid)\b/i;

// Payments to the card itself and transfers between accounts aren't
// spending, so they're imported as "not counted". Money in (a negative
// amount) is left out when it reads like a card payment, paycheck or
// transfer. Money out only when it's clearly paying a card or moving money
// (so "VENMO PAYMENT" to a friend still counts).
export function looksLikeTransfer(description: string, amount: number): boolean {
  if (amount < 0) return PAYMENTISH.test(description);
  return /\b(autopay|payment to|card payment|credit card|crd pmt|online pmt|epay|transfer|xfer)\b/i.test(description);
}
