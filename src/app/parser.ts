import Papa from "papaparse";

export interface Cook {
  sourceRow: number;
  raw: CsvRow;
  id: string | null;
  name: string | null;
  city: string | null;
  cuisine: string | null;
  serves: string[];
  phone: string | null;
  status: string | null;
  statusSince: string | null;
  joinedDate: string | null;
  maxDailyOrders: number | null;
}

export interface Subscriber {
  sourceRow: number;
  raw: CsvRow;
  id: string | null;
  name: string | null;
  city: string | null;
  phone: string | null;
  cookId: string | null;
  mealPlan: string | null;
  cuisinePreference: string | null;
  diet: string | null;
  status: string | null;
  startDate: string | null;
}

export interface Order {
  sourceRow: number;
  raw: CsvRow;
  id: string | null;
  date: string | null;
  subscriberId: string | null;
  cookId: string | null;
  mealType: string | null;
  status: string | null;
  amount: number | null;
}

export type WhatsappMessage =
  | {
      sourceLine: number;
      rawLine: string;
      date: string;
      time: string;
      sender: string;
      message: string;
      classification: 'dropout' | 'not_dropout' | 'ambiguous';
    }
  | { sourceLine: number; rawLine: string; parseError: true };

type CsvRow = Record<string, string>;
interface SourcedCsvRow {
  sourceRow: number;
  raw: CsvRow;
}

const CITY_MAP: Record<string, string> = {
  blr: "Bengaluru",
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  mum: "Mumbai",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  pune: "Pune",
};

function clean(value: unknown): string | null {
  if (value == null) return null;

  const v = String(value).trim();

  return v === "" ? null : v;
}

function normalizePhone(phone: unknown): string | null {
  if (!phone) return null;

  let digits = String(phone).replace(/\D/g, "");

  if (digits.length < 10)
    return null;

  if (digits.startsWith("91") && digits.length === 12)
    return digits;

  if (digits.length === 10)
    return "91" + digits;

  return digits || null;
}

function normalizeCity(city: unknown): string | null {
  const c = clean(city)?.toLowerCase();

  if (!c) return null;

  return CITY_MAP[c] || c.charAt(0).toUpperCase() + c.slice(1);
}

function normalizeOrderStatus(status: unknown): string | null {
  const s = clean(status)?.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

  if (!s) return null;

  if (s === 'delivered' || s === 'completed') return 'delivered';
  if (s === 'pending') return 'pending';
  if (s === 'in progress') return 'in_progress';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'refunded') return 'refunded';
  if (s === 'no show') return 'ambiguous';
  if (
    s === 'cook dropout' ||
    s === 'cook no show' ||
    s === 'cancelled cook unavailable'
  ) {
    return 'cook_failure';
  }

  return s;
}

function normalizeCookStatus(status: unknown): string | null {
  return clean(status)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
}

function normalizeSubscriptionStatus(status: unknown): string | null {
  return clean(status)?.toLowerCase() ?? null;
}

export function parseDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;

  let year: number;
  let month: number;
  let day: number;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
      if (year < 100) year += 2000;
    } else {
      match = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
      if (!match) return null;
      day = Number(match[1]);
      month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(match[2]!.toLowerCase()) + 1;
      year = Number(match[3]);
    }
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseCSV(csv: string): SourcedCsvRow[] {
  return Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  }).data.map((raw, index) => ({ sourceRow: index + 2, raw }));
}

function normalizeCook({ sourceRow, raw: row }: SourcedCsvRow): Cook {
  return {
    sourceRow,
    raw: { ...row },
    id: clean(row['cook_id']),
    name: clean(row['cook_name']),
    city: normalizeCity(row['city']),
    cuisine: clean(row['cuisine_specialty']),
    serves:
      clean(row['serves'])
        ?.split(',')
        .map((v) => v.trim())
        .filter(Boolean) ?? [],
    phone: normalizePhone(row['phone']),
    status: normalizeCookStatus(row['status']),
    statusSince: parseDate(row['status_since']),
    joinedDate: parseDate(row['joined_date']),
    maxDailyOrders: parseNumber(row['max_daily_orders']),
  };
}

function normalizeSubscriber({ sourceRow, raw: row }: SourcedCsvRow): Subscriber {
  return {
    sourceRow,
    raw: { ...row },
    id: clean(row["subscriber_id"]),
    name: clean(row["subscriber_name"]),
    city: normalizeCity(row["city"]),
    phone: normalizePhone(row["phone"]),
    cookId: clean(row["assigned_cook_id"]),
    mealPlan: clean(row["meal_plan"]),
    cuisinePreference: clean(row["cuisine_pref"]),
    diet: clean(row["diet"]),
    status: normalizeSubscriptionStatus(row["subscription_status"]),
    startDate: parseDate(row["start_date"]),
  };
}

function normalizeOrder({ sourceRow, raw: row }: SourcedCsvRow): Order {
  return {
    sourceRow,
    raw: { ...row },
    id: clean(row["order_id"]),
    date: parseDate(row["order_date"]),
    subscriberId: clean(row["subscriber_id"]),
    cookId: clean(row["cook_id"]),
    mealType: clean(row["meal_type"]),
    status: normalizeOrderStatus(row["status"]),
    amount: parseNumber(row["amount_inr"]),
  };
}

function parseNumber(value: unknown): number | null {
    const cleaned = clean(value);

    if (!cleaned) return null;

    const num = Number(
        cleaned.replace(/[^\d.-]/g, "")
    );

    return Number.isNaN(num)
        ? null
        : num;
}

export function parseCooks(csv: string): Cook[] {
  return parseCSV(csv).map(normalizeCook);
}

export function parseSubscribers(csv: string): Subscriber[] {
  return parseCSV(csv).map(normalizeSubscriber);
}

export function parseOrders(csv: string): Order[] {
  return parseCSV(csv).map(normalizeOrder);
}

export function parseWhatsapp(text: string): WhatsappMessage[] {
  const regex =
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(.+?)\s-\s(.+?):\s([\s\S]*)$/;

  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), sourceLine: index + 1 }))
    .filter(({ line }) => Boolean(line))
    .map(({ line, sourceLine }) => {
      const match = line.match(regex);

      if (!match)
        return {
          sourceLine,
          rawLine: line,
          parseError: true
        };

      const message = match[4]!;
      return {
        sourceLine,
        rawLine: line,
        date: parseDate(match[1]) ?? match[1]!,
        time: match[2]!,
        sender: match[3]!,
        message,
        classification: classifyWhatsappMessage(message),
      };
    });
}

function classifyWhatsappMessage(message: string): 'dropout' | 'not_dropout' | 'ambiguous' {
  const text = message.toLowerCase();
  if (/\bon track\b|\blate\b/.test(text)) return 'not_dropout';
  if (/\bno[- ]show\b/.test(text)) return 'ambiguous';
  if (
    /not cooking|out today|unable to cook|can't cook|cannot cook|won't cook|aaj nahi ho payega|not able to cook/.test(text)
  ) {
    return 'dropout';
  }
  return 'not_dropout';
}