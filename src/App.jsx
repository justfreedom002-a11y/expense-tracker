import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus,
  X,
  Utensils,
  Car,
  Dumbbell,
  Plane,
  ShoppingBag,
  Receipt,
  MoreHorizontal,
  Trash2,
  ChevronLeft,
  Camera,
  Loader2,
  Sparkles,
  Heart,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { createWorker } from "tesseract.js";

// ---- Design tokens: deep-sea ledger, dark blue theme ---------------
const bg = "#0D1826";
const bgGradientEnd = "#0A121D";
const cardBg = "#142238";
const cardBgAlt = "#182A45";
const lineColor = "#24384F";
const ink = "#EAF0F7";
const inkDim = "#8CA0B8";
const inkFaint = "#5D6E85";
const accentCyan = "#43C6B8";
const stampCoral = "#FF7A66";

const CATEGORIES = [
  { id: "food", label: "Food", icon: Utensils, color: "#E8AC4E" },
  { id: "transport", label: "Transport", icon: Car, color: "#5FA8E0" },
  { id: "sports", label: "Sports", icon: Dumbbell, color: "#7FCB79" },
  { id: "travel", label: "Travel", icon: Plane, color: "#E0956B" },
  { id: "shopping", label: "Shopping", icon: ShoppingBag, color: "#C08FDA" },
  { id: "bills", label: "Bills", icon: Receipt, color: "#9AA7C4" },
  { id: "gf", label: "GF", icon: Heart, color: "#F08FB3" },
  { id: "other", label: "Other", icon: MoreHorizontal, color: "#7E8CA3" },
];

const catById = (id) =>
  CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === "other");

function formatRM(n) {
  return `RM ${n.toFixed(2)}`;
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return localDateISO();
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateISO(d);
}

function extractReceiptAmount(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const candidates = [];
  const amountPattern = /(?:RM\s*)?(\d{1,6}(?:[.,]\d{2}))/gi;

  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    let score = 0;
    if (/grand\s*total|total\s*(due|payable)|amount\s*(due|payable)/i.test(line)) score += 12;
    else if (/nett?\s*total|total\s*amount/i.test(line)) score += 10;
    else if (/total/i.test(line)) score += 7;
    if (/subtotal|sub-total/i.test(line)) score -= 8;
    if (/change|cash|tax|sst|rounding|discount/i.test(lower)) score -= 4;

    for (const match of line.matchAll(amountPattern)) {
      const value = Number(match[1].replace(",", "."));
      if (Number.isFinite(value) && value > 0) {
        candidates.push({ value, score, index });
      }
    }
  });

  if (!candidates.length) return null;
  const prioritized = candidates.filter((item) => item.score > 0);
  const pool = prioritized.length ? prioritized : candidates;
  pool.sort((a, b) => b.score - a.score || b.index - a.index || b.value - a.value);
  return pool[0].value;
}

function dateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const todayISOStr = localDateISO(today);
  const yISOStr = localDateISO(y);
  if (iso === todayISOStr) return "Today";
  if (iso === yISOStr) return "Yesterday";
  return d.toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function ExpenseTracker() {
  const [expenses, setExpenses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [chartRange, setChartRange] = useState("7"); // "7" or "30"
  const [rangeStart, setRangeStart] = useState(() => daysAgoISO(6));
  const [rangeEnd, setRangeEnd] = useState(todayISO);

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());

  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState(null);
  const fileInputRef = useRef(null);

  // ---- Load from browser storage -----------------------------------
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("expense-tracker-expenses");
      if (saved) setExpenses(JSON.parse(saved));
    } catch (e) {
      setError("Couldn't load saved entries in this browser.");
    } finally {
      setLoaded(true);
    }
  }, []);

  function persist(next) {
    setExpenses(next);
    try {
      window.localStorage.setItem("expense-tracker-expenses", JSON.stringify(next));
      setError(null);
    } catch (e) {
      setError("Couldn't save — please try again.");
    }
  }

  function resetForm() {
    setAmount("");
    setCategory("food");
    setNote("");
    setDate(todayISO());
    setScanNotice(null);
  }

  async function handleAdd(e) {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      amount: val,
      category,
      note: note.trim(),
      date,
      time: new Date().toISOString(),
    };
    persist([entry, ...expenses]);
    resetForm();
    setFormOpen(false);
  }

  async function handleDelete(id) {
    persist(expenses.filter((x) => x.id !== id));
  }

  // ---- Receipt photo capture + free on-device OCR -------------------
  async function handlePhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setFormOpen(true);
    setScanNotice({
      type: "success",
      text: "Reading receipt on this device… The first scan may take 20–40 seconds.",
    });
    try {
      const worker = await createWorker("eng");
      const result = await worker.recognize(file);
      await worker.terminate();
      const detected = extractReceiptAmount(result.data.text || "");
      if (detected) {
        setAmount(detected.toFixed(2));
        setScanNotice({
          type: "success",
          text: `Detected ${formatRM(detected)}. Check the amount and choose a category before saving.`,
        });
      } else {
        setScanNotice({
          type: "warn",
          text: "No clear total was found. Please enter the amount manually and choose a category.",
        });
      }
    } catch (err) {
      setScanNotice({
        type: "warn",
        text: "The receipt could not be read. Please enter the amount manually.",
      });
    } finally {
      setScanning(false);
    }
  }

  // ---- Derived data ----------------------------------------------------
  const filtered = useMemo(
    () =>
      filter === "all" ? expenses : expenses.filter((x) => x.category === filter),
    [expenses, filter]
  );

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((x) => {
      map[x.date] = map[x.date] || [];
      map[x.date].push(x);
    });
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const todayTotal = useMemo(
    () =>
      expenses
        .filter((x) => x.date === todayISO())
        .reduce((s, x) => s + x.amount, 0),
    [expenses]
  );

  const weekTotal = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    return expenses.filter((x) => x.date >= cutoffISO).reduce((s, x) => s + x.amount, 0);
  }, [expenses]);

  const chartData = useMemo(() => {
    const days = chartRange === "30" ? 29 : 6;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const totals = {};
    expenses
      .filter((x) => x.date >= cutoffISO)
      .forEach((x) => {
        totals[x.category] = (totals[x.category] || 0) + x.amount;
      });
    const list = Object.entries(totals)
      .map(([id, value]) => ({ id, value, ...catById(id) }))
      .sort((a, b) => b.value - a.value);
    const sum = list.reduce((s, x) => s + x.value, 0);
    return { list, sum };
  }, [expenses, chartRange]);

  const rangeData = useMemo(() => {
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    const selected = expenses.filter((x) => x.date >= start && x.date <= end);
    const totals = {};
    selected.forEach((x) => {
      totals[x.date] = (totals[x.date] || 0) + x.amount;
    });

    const daily = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cursor <= last && daily.length < 366) {
      const iso = cursor.toISOString().slice(0, 10);
      daily.push({
        date: iso,
        label: cursor.toLocaleDateString("en-MY", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }),
        amount: totals[iso] || 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      daily,
      total: selected.reduce((sum, item) => sum + item.amount, 0),
    };
  }, [expenses, rangeStart, rangeEnd]);

  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${bg} 0%, ${bgGradientEnd} 100%)`,
        fontFamily: "system-ui, sans-serif",
      }}
      className="min-h-screen flex justify-center"
    >
      <div style={{ maxWidth: 430, width: "100%" }} className="relative min-h-screen pb-28">
        {/* Header */}
        <header className="px-5 pt-8 pb-5">
          <div className="mb-6">
            <p
              style={{ color: accentCyan, letterSpacing: "0.14em" }}
              className="text-[11px] uppercase font-semibold"
            >
              Daily Ledger
            </p>
            <h1 style={{ color: ink }} className="text-2xl font-bold tracking-tight">
              My Expenses
            </h1>
          </div>

          <div
            style={{
              background: `linear-gradient(135deg, ${cardBgAlt} 0%, ${cardBg} 100%)`,
              border: `1px solid ${lineColor}`,
            }}
            className="rounded-2xl px-5 py-4"
          >
            <p
              style={{ color: inkDim, letterSpacing: "0.12em" }}
              className="text-[10px] uppercase font-semibold mb-1"
            >
              Spent today
            </p>
            <p
              style={{ color: ink, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
              className="text-4xl font-bold tabular-nums"
            >
              {formatRM(todayTotal)}
            </p>
            <div
              style={{ borderTop: `1px dashed ${lineColor}`, marginTop: 12, paddingTop: 10 }}
              className="flex justify-between text-sm"
            >
              <span style={{ color: inkDim }}>Last 7 days</span>
              <span
                style={{ color: ink, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                className="font-semibold tabular-nums"
              >
                {formatRM(weekTotal)}
              </span>
            </div>
          </div>
        </header>

        {/* Daily spending dashboard */}
        <section className="px-5 mb-5">
          <div
            style={{ background: cardBg, border: `1px solid ${lineColor}` }}
            className="rounded-2xl px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p
                  style={{ color: inkDim, letterSpacing: "0.1em" }}
                  className="text-[10px] uppercase font-semibold"
                >
                  Daily spending dashboard
                </p>
                <p
                  style={{ color: ink, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                  className="text-xl font-bold mt-1"
                >
                  {formatRM(rangeData.total)}
                </p>
                <p style={{ color: inkFaint }} className="text-[10px]">
                  selected period
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <label style={{ color: inkDim }} className="text-[10px] uppercase font-semibold">
                From
                <input
                  type="date"
                  value={rangeStart}
                  max={todayISO()}
                  onChange={(e) => setRangeStart(e.target.value)}
                  style={{ background: bg, border: `1px solid ${lineColor}`, color: ink }}
                  className="block w-full rounded-lg px-2 py-2 mt-1 text-xs outline-none"
                />
              </label>
              <label style={{ color: inkDim }} className="text-[10px] uppercase font-semibold">
                To
                <input
                  type="date"
                  value={rangeEnd}
                  max={todayISO()}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  style={{ background: bg, border: `1px solid ${lineColor}`, color: ink }}
                  className="block w-full rounded-lg px-2 py-2 mt-1 text-xs outline-none"
                />
              </label>
            </div>

            <div className="overflow-x-auto pb-1">
              <div style={{ width: Math.max(350, rangeData.daily.length * 38), height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rangeData.daily} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: inkFaint, fontSize: 9 }}
                      axisLine={{ stroke: lineColor }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: inkFaint, fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                    />
                    <Tooltip
                      formatter={(value) => [formatRM(Number(value)), "Spent"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""}
                      contentStyle={{ background: bg, border: `1px solid ${lineColor}`, borderRadius: 10 }}
                      labelStyle={{ color: inkDim }}
                    />
                    <Bar dataKey="amount" fill={accentCyan} radius={[5, 5, 0, 0]} minPointSize={2} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>

        {/* Category donut — by spending amount */}
        <section className="px-5 mb-2">
          <div
            style={{ background: cardBg, border: `1px solid ${lineColor}` }}
            className="rounded-2xl px-4 py-4"
          >
            <div className="flex items-center justify-between mb-3">
              <p
                style={{ color: inkDim, letterSpacing: "0.1em" }}
                className="text-[10px] uppercase font-semibold"
              >
                Spending by category
              </p>
              <div style={{ background: bg, border: `1px solid ${lineColor}` }} className="flex rounded-full p-0.5">
                {["7", "30"].map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    style={{
                      background: chartRange === r ? accentCyan : "transparent",
                      color: chartRange === r ? "#08201C" : inkDim,
                    }}
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors"
                  >
                    {r}d
                  </button>
                ))}
              </div>
            </div>

            {chartData.list.length === 0 ? (
              <p style={{ color: inkFaint }} className="text-xs text-center py-6">
                No expenses in this range yet.
              </p>
            ) : (
              <div className="flex items-center gap-4">
                <div style={{ width: 108, height: 108 }} className="relative shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData.list}
                        dataKey="value"
                        nameKey="id"
                        innerRadius={34}
                        outerRadius={52}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {chartData.list.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span
                      style={{ color: ink, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                      className="text-[13px] font-bold"
                    >
                      RM{Math.round(chartData.sum)}
                    </span>
                    <span style={{ color: inkFaint }} className="text-[9px]">
                      total
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {chartData.list.map((c) => {
                    const pct = chartData.sum ? Math.round((c.value / chartData.sum) * 100) : 0;
                    return (
                      <div key={c.id}>
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span style={{ background: c.color }} className="w-2 h-2 rounded-full shrink-0" />
                          <span style={{ color: ink }} className="flex-1 truncate">
                            {c.label}
                          </span>
                          <span
                            style={{ color: inkDim, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                          >
                            {formatRM(c.value)}
                          </span>
                          <span style={{ color: inkFaint, width: 30 }} className="text-right">
                            {pct}%
                          </span>
                        </div>
                        <div style={{ background: bg }} className="h-1 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${pct}%`, background: c.color }}
                            className="h-full rounded-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Category filter chips */}
        <section className="px-5 mt-4 mb-2">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              onClick={() => setFilter("all")}
              style={{
                background: filter === "all" ? accentCyan : cardBg,
                color: filter === "all" ? "#08201C" : ink,
                border: `1px solid ${filter === "all" ? accentCyan : lineColor}`,
              }}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
            >
              All
            </button>
            {CATEGORIES.map((c) => {
              const Icon = c.icon;
              const active = filter === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setFilter(active ? "all" : c.id)}
                  style={{
                    background: active ? c.color : cardBg,
                    color: active ? "#0D1826" : ink,
                    border: `1px solid ${active ? c.color : lineColor}`,
                  }}
                  className="shrink-0 rounded-full pl-2.5 pr-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Icon size={13} />
                  {c.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Expense list */}
        <section className="px-5 mt-3">
          {!loaded ? (
            <p style={{ color: inkDim }} className="text-sm text-center py-10">
              Loading your ledger…
            </p>
          ) : grouped.length === 0 ? (
            <div style={{ border: `1px dashed ${lineColor}` }} className="rounded-2xl py-10 px-4 text-center">
              <p style={{ color: ink }} className="font-semibold mb-1">
                No entries yet
              </p>
              <p style={{ color: inkDim }} className="text-sm">
                Tap + to add one, or scan a receipt photo.
              </p>
            </div>
          ) : (
            grouped.map(([dateISO, items]) => {
              const dayTotal = items.reduce((s, x) => s + x.amount, 0);
              return (
                <div key={dateISO} className="mb-5">
                  <div className="flex items-baseline justify-between mb-2 px-1">
                    <p
                      style={{ color: inkDim, letterSpacing: "0.08em" }}
                      className="text-[11px] uppercase font-semibold"
                    >
                      {dateLabel(dateISO)}
                    </p>
                    <p
                      style={{ color: inkDim, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                      className="text-xs"
                    >
                      {formatRM(dayTotal)}
                    </p>
                  </div>
                  <div style={{ background: cardBg, border: `1px solid ${lineColor}` }} className="rounded-2xl overflow-hidden">
                    {items.map((x, i) => {
                      const c = catById(x.category);
                      const Icon = c.icon;
                      return (
                        <div
                          key={x.id}
                          style={{ borderTop: i === 0 ? "none" : `1px dashed ${lineColor}` }}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <div
                            style={{
                              background: `${c.color}26`,
                              border: `1.5px dashed ${c.color}`,
                              color: c.color,
                              transform: "rotate(-4deg)",
                            }}
                            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center"
                          >
                            <Icon size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p style={{ color: ink }} className="text-sm font-semibold truncate">
                              {x.note || c.label}
                            </p>
                            <p style={{ color: inkDim }} className="text-xs">
                              {c.label}
                            </p>
                          </div>
                          <p
                            style={{ color: stampCoral, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
                            className="text-sm font-semibold tabular-nums"
                          >
                            {formatRM(x.amount)}
                          </p>
                          <button
                            onClick={() => handleDelete(x.id)}
                            aria-label="Delete entry"
                            style={{ color: inkFaint }}
                            className="opacity-70 hover:opacity-100 transition-opacity shrink-0"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          {error && (
            <p style={{ color: stampCoral }} className="text-xs text-center mt-2">
              {error}
            </p>
          )}
        </section>

        {/* Hidden camera input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          className="hidden"
        />

        {/* Floating action buttons */}
        <div className="fixed bottom-8 right-1/2 translate-x-[152px] flex flex-col items-end gap-3">
          <button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={scanning}
            style={{ background: cardBgAlt, border: `1px solid ${lineColor}`, color: accentCyan }}
            aria-label="Scan a receipt photo"
            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          >
            {scanning ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
          </button>
          <button
            onClick={() => setFormOpen(true)}
            style={{ background: accentCyan }}
            aria-label="Add expense"
            className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-[#08201C] active:scale-95 transition-transform"
          >
            <Plus size={26} />
          </button>
        </div>

        {/* Add expense bottom sheet */}
        {formOpen && (
          <div className="fixed inset-0 z-20 flex justify-center">
            <div
              onClick={() => setFormOpen(false)}
              className="absolute inset-0"
              style={{ background: "rgba(4,9,16,0.6)" }}
            />
            <div style={{ maxWidth: 430, width: "100%" }} className="relative self-end">
              <form
                onSubmit={handleAdd}
                style={{ background: bg, border: `1px solid ${lineColor}`, borderBottom: "none" }}
                className="rounded-t-3xl px-5 pt-4 pb-8 max-h-[85vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-4">
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    style={{ color: inkDim }}
                    className="flex items-center gap-1 text-sm font-medium"
                  >
                    <ChevronLeft size={16} /> Cancel
                  </button>
                  <p style={{ color: ink }} className="font-bold">
                    New Expense
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    disabled={scanning}
                    style={{ color: accentCyan }}
                    className="flex items-center gap-1 text-xs font-semibold"
                  >
                    {scanning ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                    Scan
                  </button>
                </div>

                {scanNotice && (
                  <div
                    style={{
                      background: scanNotice.type === "success" ? `${accentCyan}1A` : `${stampCoral}1A`,
                      border: `1px solid ${scanNotice.type === "success" ? accentCyan : stampCoral}`,
                      color: scanNotice.type === "success" ? accentCyan : stampCoral,
                    }}
                    className="rounded-xl px-3 py-2 text-xs mb-4 flex items-start gap-2"
                  >
                    <Sparkles size={13} className="shrink-0 mt-0.5" />
                    {scanNotice.text}
                  </div>
                )}

                <label style={{ color: inkDim, letterSpacing: "0.08em" }} className="text-[11px] uppercase font-semibold block mb-1.5">
                  Amount (RM)
                </label>
                <input
                  autoFocus
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{
                    background: cardBg,
                    border: `1px solid ${lineColor}`,
                    color: ink,
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                  }}
                  className="w-full rounded-xl px-4 py-3 text-2xl font-semibold mb-4 outline-none focus:ring-2"
                />

                <label style={{ color: inkDim, letterSpacing: "0.08em" }} className="text-[11px] uppercase font-semibold block mb-1.5">
                  Category
                </label>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    const active = category === c.id;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setCategory(c.id)}
                        style={{
                          background: active ? c.color : cardBg,
                          border: `1px solid ${active ? c.color : lineColor}`,
                          color: active ? "#0D1826" : ink,
                        }}
                        className="rounded-xl py-2.5 flex flex-col items-center gap-1 text-[10px] font-semibold"
                      >
                        <Icon size={16} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>

                <label style={{ color: inkDim, letterSpacing: "0.08em" }} className="text-[11px] uppercase font-semibold block mb-1.5">
                  Note (optional)
                </label>
                <input
                  placeholder="e.g. Nasi lemak with friends"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ background: cardBg, border: `1px solid ${lineColor}`, color: ink }}
                  className="w-full rounded-xl px-4 py-3 text-sm mb-4 outline-none focus:ring-2"
                />

                <label style={{ color: inkDim, letterSpacing: "0.08em" }} className="text-[11px] uppercase font-semibold block mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  max={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ background: cardBg, border: `1px solid ${lineColor}`, color: ink }}
                  className="w-full rounded-xl px-4 py-3 text-sm mb-6 outline-none focus:ring-2"
                />

                <button
                  type="submit"
                  style={{ background: accentCyan }}
                  className="w-full rounded-xl py-3.5 text-[#08201C] font-semibold active:scale-[0.99] transition-transform"
                >
                  Add Expense
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
