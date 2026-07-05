"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp, FileText, Calculator, BookOpen, TrendingUp, AlertCircle, Plus, Trash2, RefreshCw, Printer, Pencil, Check, X } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type DeductionType = "65" | "55" | "10";

interface ExpenseState {
  給料賃金: number;
  外注工賃: number;
  減価償却費: number;
  貸倒金: number;
  地代家賃: number;
  利子割引料: number;
  租税公課: number;
  荷造運賃: number;
  水道光熱費: number;
  旅費交通費: number;
  通信費: number;
  広告宣伝費: number;
  接待交際費: number;
  損害保険料: number;
  修繕費: number;
  消耗品費: number;
  福利厚生費: number;
  雑費: number;
  その他経費: number;
}

interface BalanceSheetAccount {
  start: number;
  end: number;
}

interface AssetState {
  現金: BalanceSheetAccount;
  預金: BalanceSheetAccount;
  売掛金: BalanceSheetAccount;
  棚卸資産: BalanceSheetAccount;
  固定資産: BalanceSheetAccount;
  事業主貸: BalanceSheetAccount;
  その他資産: BalanceSheetAccount;
}

interface LiabilityState {
  買掛金: BalanceSheetAccount;
  借入金: BalanceSheetAccount;
  その他負債: BalanceSheetAccount;
  元入金: BalanceSheetAccount;
  事業主借: BalanceSheetAccount;
}

interface DeductionState {
  社会保険料控除: number;
  生命保険料控除: number;
  地震保険料控除: number;
  配偶者控除: number;
  扶養控除人数: number;
}

// ─── 仕訳帳 Types ────────────────────────────────────────────────────────────

const ACCOUNTS = {
  資産: ["現金", "普通預金", "売掛金", "棚卸資産", "固定資産", "事業主貸"],
  負債: ["買掛金", "借入金", "未払金", "事業主借"],
  資本: ["元入金"],
  収益: ["売上"],
  費用: ["仕入", "給料賃金", "外注工賃", "減価償却費", "地代家賃", "水道光熱費",
         "通信費", "旅費交通費", "広告宣伝費", "接待交際費", "消耗品費", "租税公課",
         "損害保険料", "修繕費", "荷造運賃", "利子割引料", "福利厚生費", "貸倒金", "雑費", "その他経費"],
} as const;

const ALL_ACCOUNTS = Object.values(ACCOUNTS).flat();
const EXPENSE_ACCOUNTS = ACCOUNTS.費用;
const REVENUE_ACCOUNTS = ACCOUNTS.収益;

interface JournalEntry {
  id: string;
  date: string;
  description: string;
  debitAccount: string;
  debitAmount: number;   // 円
  creditAccount: string;
  creditAmount: number;  // 円
  fileName?: string;
  fileData?: string;
  source?: string;
  sourceId?: string;
}

interface NotionImportPreview {
  entries: JournalEntry[];
  skipped: number;
  saleCount: number;
  paidCount: number;
  saleTotal: number;
  paidTotal: number;
  imported?: number;
}

// ─── Fixed Asset Types ───────────────────────────────────────────────────────

type DepreciationMethod = "定額法" | "定率法";

interface FixedAsset {
  id: string;
  name: string;
  acquiredYear: number;
  acquisitionCost: number; // 万円
  usefulLife: number;       // 年
  method: DepreciationMethod;
  businessRatio: number;    // % 0-100
  bookValueStart: number;   // 期首帳簿価額（万円）
}

/** 定額法償却率（1/耐用年数、小数点3桁） */
function straightLineRate(life: number): number {
  return Math.round((1 / life) * 1000) / 1000;
}

/** 定率法償却率（200%定率法、2012年以降取得） */
function decliningRate(life: number): number {
  return Math.round((2 / life) * 1000) / 1000;
}

/** 当期の経費算入額（万円） */
function calcDepreciation(asset: FixedAsset, currentYear: number): {
  rate: number; annualDep: number; deductible: number; bookValueEnd: number;
} {
  const yearsHeld = currentYear - asset.acquiredYear;
  if (yearsHeld < 0) return { rate: 0, annualDep: 0, deductible: 0, bookValueEnd: asset.bookValueStart };

  if (asset.method === "定額法") {
    const rate = straightLineRate(asset.usefulLife);
    const annualDep = Math.round(asset.acquisitionCost * rate * 10) / 10;
    // 期末帳簿価額は1円（0.000001万円）を下限とする
    const actualDep = Math.min(annualDep, Math.max(0, asset.bookValueStart - 0.000001));
    const deductible = Math.round(actualDep * (asset.businessRatio / 100) * 10) / 10;
    return { rate, annualDep: actualDep, deductible, bookValueEnd: Math.max(0.000001, asset.bookValueStart - actualDep) };
  } else {
    // 定率法（200%）
    const rate = decliningRate(asset.usefulLife);
    const slRate = straightLineRate(asset.usefulLife);
    const annualDep = Math.round(asset.bookValueStart * rate * 10) / 10;
    // 償却保証額 = 取得価額 × 保証率（簡易計算: 定額法と比較）
    const slDep = Math.round(asset.acquisitionCost * slRate * 10) / 10;
    const actualDep = Math.min(Math.max(annualDep, slDep), Math.max(0, asset.bookValueStart - 0.000001));
    const deductible = Math.round(actualDep * (asset.businessRatio / 100) * 10) / 10;
    return { rate, annualDep: actualDep, deductible, bookValueEnd: Math.max(0.000001, asset.bookValueStart - actualDep) };
  }
}

// ─── Tax Rate Table ─────────────────────────────────────────────────────────

const TAX_BRACKETS: { limit: number; rate: number; deduction: number }[] = [
  { limit: 195,    rate: 0.05,  deduction: 0 },
  { limit: 330,    rate: 0.10,  deduction: 9.75 },
  { limit: 695,    rate: 0.20,  deduction: 42.75 },
  { limit: 900,    rate: 0.23,  deduction: 63.6 },
  { limit: 1800,   rate: 0.33,  deduction: 153.6 },
  { limit: 4000,   rate: 0.40,  deduction: 279.6 },
  { limit: Infinity, rate: 0.45, deduction: 479.6 },
];

function calcIncomeTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  const bracket = TAX_BRACKETS.find((b) => taxableIncome <= b.limit);
  if (!bracket) return 0;
  return Math.max(0, taxableIncome * bracket.rate - bracket.deduction);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number) => `${n.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}万円`;

function NumInput({
  value,
  onChange,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      step="0.1"
      min="0"
      value={value === 0 ? "" : value}
      placeholder="0"
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={`w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
    />
  );
}

// 公式フォーム参照バッジ
const FORM_BADGE_COLORS: Record<string, string> = {
  "FA3000": "bg-emerald-700 text-white",
  "FA3025": "bg-teal-600 text-white",
  "FA3050": "bg-cyan-700 text-white",
  "FA3075": "bg-blue-700 text-white",
};

function FormBadge({ code, label }: { code: string; label: string }) {
  const color = FORM_BADGE_COLORS[code] ?? "bg-gray-600 text-white";
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{code}</span>
      <span className="text-[11px] text-muted-foreground font-normal hidden sm:inline">{label}</span>
    </span>
  );
}

function SectionHeader({
  title,
  icon,
  open,
  onToggle,
  formRef,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  formRef?: { code: string; label: string };
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/40 transition-colors rounded-t-lg"
    >
      <div className="flex items-center gap-2 font-semibold text-base">
        {icon}
        {title}
      </div>
      <div className="flex items-center gap-2">
        {formRef && <FormBadge code={formRef.code} label={formRef.label} />}
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-2 mt-3">
      <BookOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
      <span>{children}</span>
    </div>
  );
}

function Row({ label, value, color = "" }: { label: string; value: string; color?: string }) {
  return (
    <div className={`flex justify-between items-center py-1.5 px-3 rounded ${color}`}>
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm font-medium">{value}</span>
    </div>
  );
}

// ─── Initial States ──────────────────────────────────────────────────────────

const initExpenses = (): ExpenseState => ({
  給料賃金: 0, 外注工賃: 0, 減価償却費: 0, 貸倒金: 0, 地代家賃: 0,
  利子割引料: 0, 租税公課: 0, 荷造運賃: 0, 水道光熱費: 0, 旅費交通費: 0,
  通信費: 0, 広告宣伝費: 0, 接待交際費: 0, 損害保険料: 0, 修繕費: 0,
  消耗品費: 0, 福利厚生費: 0, 雑費: 0, その他経費: 0,
});

const initBsAccount = (): BalanceSheetAccount => ({ start: 0, end: 0 });

const initAssets = (): AssetState => ({
  現金: initBsAccount(), 預金: initBsAccount(), 売掛金: initBsAccount(),
  棚卸資産: initBsAccount(), 固定資産: initBsAccount(),
  事業主貸: initBsAccount(), その他資産: initBsAccount(),
});

const initLiabilities = (): LiabilityState => ({
  買掛金: initBsAccount(), 借入金: initBsAccount(), その他負債: initBsAccount(),
  元入金: initBsAccount(), 事業主借: initBsAccount(),
});

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AoiroPage() {
  const stateLoadedRef = useRef(false);
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Section open/close
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({
    0: true, 1: true, 2: false, 3: false, 35: false, 4: true, 5: false, 6: false,
  });
  const toggle = (s: number) => setOpenSections((prev) => ({ ...prev, [s]: !prev[s] }));

  // Section 1
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [tradeName, setTradeName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [deductionType, setDeductionType] = useState<DeductionType>("65");

  // 仕訳帳
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [txDesc, setTxDesc] = useState("");
  const [txDebit, setTxDebit] = useState("普通預金");
  const [txCredit, setTxCredit] = useState("売上");
  const [txAmount, setTxAmount] = useState<number>(0);
  const [txFile, setTxFile] = useState<{ name: string; data: string } | null>(null);
  const [stateMsg, setStateMsg] = useState("");
  const [notionPreview, setNotionPreview] = useState<NotionImportPreview | null>(null);
  const [notionMsg, setNotionMsg] = useState("");

  useEffect(() => {
    fetch("/api/aoiro/transactions")
      .then((r) => r.json())
      .then((rows: {id: number; date: string; description: string; debitAccount: string; debitAmount: number; creditAccount: string; creditAmount: number; fileName?: string; fileData?: string; source?: string; sourceId?: string}[]) =>
        setEntries(rows.map((r) => ({
          id: String(r.id), date: r.date, description: r.description,
          debitAccount: r.debitAccount, debitAmount: r.debitAmount,
          creditAccount: r.creditAccount, creditAmount: r.creditAmount,
          fileName: r.fileName ?? undefined, fileData: r.fileData ?? undefined,
          source: r.source ?? undefined, sourceId: r.sourceId ?? undefined,
        })))
      )
      .catch(() => setStateMsg("仕訳の読込に失敗しました"));
  }, []);

  async function addEntry() {
    if (!txDate || txAmount <= 0) return;
    const res = await fetch("/api/aoiro/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: txDate, description: txDesc,
        debitAccount: txDebit, debitAmount: txAmount,
        creditAccount: txCredit, creditAmount: txAmount,
        fileName: txFile?.name ?? null, fileData: txFile?.data ?? null,
      }),
    });
    const row = await res.json();
    setEntries((prev) => [...prev, {
      id: String(row.id), date: row.date, description: row.description,
      debitAccount: row.debitAccount, debitAmount: row.debitAmount,
      creditAccount: row.creditAccount, creditAmount: row.creditAmount,
      fileName: row.fileName ?? undefined, fileData: row.fileData ?? undefined,
      source: row.source ?? undefined, sourceId: row.sourceId ?? undefined,
    }]);
    setTxDesc("");
    setTxAmount(0);
    setTxFile(null);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTxFile({ name: file.name, data: reader.result as string });
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function viewFile(fileData: string, fileName: string) {
    const a = document.createElement("a");
    a.href = fileData;
    a.download = fileName;
    a.click();
  }

  async function deleteEntry(id: string) {
    await fetch("/api/aoiro/transactions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: parseInt(id) }),
    });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  // 行編集
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<JournalEntry> & { newFile?: { name: string; data: string } | null }>({});

  function startEdit(e: JournalEntry) {
    setEditingId(e.id);
    setEditDraft({ date: e.date, description: e.description, debitAccount: e.debitAccount, debitAmount: e.debitAmount, creditAccount: e.creditAccount, creditAmount: e.creditAmount });
  }

  function cancelEdit() { setEditingId(null); setEditDraft({}); }

  async function saveEdit(e: JournalEntry) {
    const payload: Record<string, unknown> = { id: parseInt(e.id), ...editDraft };
    if (editDraft.newFile !== undefined) {
      payload.fileName = editDraft.newFile?.name ?? null;
      payload.fileData = editDraft.newFile?.data ?? null;
    }
    delete payload.newFile;
    const res = await fetch("/api/aoiro/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const row = await res.json();
    setEntries((prev) => prev.map((en) => en.id === e.id ? {
      ...en,
      date: row.date, description: row.description,
      debitAccount: row.debitAccount, debitAmount: row.debitAmount,
      creditAccount: row.creditAccount, creditAmount: row.creditAmount,
      fileName: row.fileName ?? undefined, fileData: row.fileData ?? undefined,
      source: row.source ?? undefined, sourceId: row.sourceId ?? undefined,
    } : en));
    setEditingId(null);
    setEditDraft({});
  }

  const [applyMsg, setApplyMsg] = useState("");

  // 仕訳科目 → B/S資産科目 のマッピング
  const BS_ASSET_MAP: Partial<Record<string, keyof AssetState>> = {
    "現金": "現金",
    "普通預金": "預金",
    "売掛金": "売掛金",
    "棚卸資産": "棚卸資産",
    "固定資産": "固定資産",
    "事業主貸": "事業主貸",
  };
  // 仕訳科目 → B/S負債科目 のマッピング
  const BS_LIAB_MAP: Partial<Record<string, keyof LiabilityState>> = {
    "買掛金": "買掛金",
    "借入金": "借入金",
    "未払金": "その他負債",
    "元入金": "元入金",
    "事業主借": "事業主借",
  };

  function applyEntries() {
    const newRevenue = Array(12).fill(0);
    const newPurchase = Array(12).fill(0);
    const newExp = initExpenses();
    // B/S 期末残高の増減（仕訳から計算）
    const assetDelta: Record<keyof AssetState, number> = {
      現金: 0, 預金: 0, 売掛金: 0, 棚卸資産: 0, 固定資産: 0, 事業主貸: 0, その他資産: 0,
    };
    const liabDelta: Record<keyof LiabilityState, number> = {
      買掛金: 0, 借入金: 0, その他負債: 0, 元入金: 0, 事業主借: 0,
    };

    let count = 0;
    for (const e of entries) {
      if (e.date.slice(0, 4) !== String(year)) continue;
      count++;
      const month = parseInt(e.date.slice(5, 7)) - 1;
      // 損益
      if ((REVENUE_ACCOUNTS as readonly string[]).includes(e.creditAccount)) {
        newRevenue[month] += e.creditAmount / 10000;
      }
      if ((EXPENSE_ACCOUNTS as readonly string[]).includes(e.debitAccount)) {
        if (e.debitAccount === "仕入") {
          newPurchase[month] += e.debitAmount / 10000;
        } else if (e.debitAccount in newExp) {
          (newExp as unknown as Record<string, number>)[e.debitAccount] += e.debitAmount / 10000;
        }
      }
      // B/S: 借方 → 資産増 / 負債減
      const dAsset = BS_ASSET_MAP[e.debitAccount];
      if (dAsset) assetDelta[dAsset] += e.debitAmount / 10000;
      const dLiab = BS_LIAB_MAP[e.debitAccount];
      if (dLiab) liabDelta[dLiab] -= e.debitAmount / 10000;
      // B/S: 貸方 → 資産減 / 負債増
      const cAsset = BS_ASSET_MAP[e.creditAccount];
      if (cAsset) assetDelta[cAsset] -= e.creditAmount / 10000;
      const cLiab = BS_LIAB_MAP[e.creditAccount];
      if (cLiab) liabDelta[cLiab] += e.creditAmount / 10000;
    }

    // 減価償却費を経費に自動加算
    newExp.減価償却費 = Math.round(totalDepreciation * 10) / 10;
    setMonthlyRevenue(newRevenue.map((v) => Math.round(v * 10) / 10));
    setMonthlyPurchase(newPurchase.map((v) => Math.round(v * 10) / 10));
    setExpenses(newExp);
    // B/S 期末残高 = 期首残高 + 仕訳の増減
    setAssets((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(assetDelta) as (keyof AssetState)[]) {
        next[key] = { ...prev[key], end: Math.round((prev[key].start + assetDelta[key]) * 10) / 10 };
      }
      return next;
    });
    setLiabilities((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(liabDelta) as (keyof LiabilityState)[]) {
        next[key] = { ...prev[key], end: Math.round((prev[key].start + liabDelta[key]) * 10) / 10 };
      }
      return next;
    });
    setOpenSections((prev) => ({ ...prev, 2: true, 3: true, 4: true, 5: true }));
    setApplyMsg(count > 0 ? `✓ ${year}年分 ${count}件を損益・貸借に反映しました` : `⚠ ${year}年の仕訳が0件です。日付を確認してください`);
    setTimeout(() => setApplyMsg(""), 4000);
  }

  // Section 2
  const [monthlyRevenue, setMonthlyRevenue] = useState<number[]>(Array(12).fill(0));
  const [monthlyPurchase, setMonthlyPurchase] = useState<number[]>(Array(12).fill(0));

  // Section 4: 損益計算書 追加フィールド
  const [inventoryStart, setInventoryStart] = useState(0);
  const [inventoryEnd, setInventoryEnd] = useState(0);
  const [plDateFrom, setPlDateFrom] = useState("1");
  const [plDateTo, setPlDateTo] = useState("12");

  // Section 3
  const [expenses, setExpenses] = useState<ExpenseState>(initExpenses());

  // Section 3.5: 減価償却
  const [fixedAssets, setFixedAssets] = useState<FixedAsset[]>([]);
  const [faName, setFaName] = useState("");
  const [faAcquiredYear, setFaAcquiredYear] = useState(new Date().getFullYear());
  const [faMethod, setFaMethod] = useState<DepreciationMethod>("定額法");
  const [faCost, setFaCost] = useState(0);
  const [faLife, setFaLife] = useState(5);
  const [faRatio, setFaRatio] = useState(100);
  const [faBookStart, setFaBookStart] = useState(0);

  function addFixedAsset() {
    if (!faName || faCost <= 0) return;
    const bookStart = faBookStart > 0 ? faBookStart : faCost;
    setFixedAssets((prev) => [...prev, {
      id: crypto.randomUUID(), name: faName, acquiredYear: faAcquiredYear,
      acquisitionCost: faCost, usefulLife: faLife, method: faMethod,
      businessRatio: faRatio, bookValueStart: bookStart,
    }]);
    setFaName(""); setFaCost(0); setFaBookStart(0);
  }

  const depCalcs = useMemo(() =>
    fixedAssets.map((a) => ({ ...a, ...calcDepreciation(a, year) })),
    [fixedAssets, year]
  );

  const totalDepreciation = depCalcs.reduce((s, a) => s + a.deductible, 0);

  // Section 5
  const [assets, setAssets] = useState<AssetState>(initAssets());
  const [liabilities, setLiabilities] = useState<LiabilityState>(initLiabilities());

  // Section 6
  const [deductions, setDeductions] = useState<DeductionState>({
    社会保険料控除: 0, 生命保険料控除: 0, 地震保険料控除: 0, 配偶者控除: 0, 扶養控除人数: 0,
  });

  useEffect(() => {
    stateLoadedRef.current = false;
    fetch(`/api/aoiro/state?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((data) => {
        setMonthlyRevenue(Array(12).fill(0));
        setMonthlyPurchase(Array(12).fill(0));
        setExpenses(initExpenses());
        if (data.businessSettings) {
          setTradeName(data.businessSettings.tradeName || "");
          setBusinessType(data.businessSettings.businessType || "");
          setDeductionType((data.businessSettings.deductionType || "65") as DeductionType);
          setInventoryStart(data.businessSettings.inventoryStart || 0);
          setInventoryEnd(data.businessSettings.inventoryEnd || 0);
          setPlDateFrom(data.businessSettings.plDateFrom || "1");
          setPlDateTo(data.businessSettings.plDateTo || "12");
        } else {
          setTradeName("");
          setBusinessType("");
          setDeductionType("65");
          setInventoryStart(0);
          setInventoryEnd(0);
          setPlDateFrom("1");
          setPlDateTo("12");
        }

        setDeductions(data.deductions || {
          社会保険料控除: 0, 生命保険料控除: 0, 地震保険料控除: 0, 配偶者控除: 0, 扶養控除人数: 0,
        });
        setFixedAssets((data.fixedAssets || []).map((a: FixedAsset) => ({
          ...a,
          id: String(a.id),
          method: a.method as DepreciationMethod,
        })));

        const nextAssets = initAssets();
        const nextLiabilities = initLiabilities();
        for (const b of data.openingBalances || []) {
          if (b.accountType === "asset" && b.account in nextAssets) {
            nextAssets[b.account as keyof AssetState] = { start: b.start || 0, end: b.end || 0 };
          }
          if (b.accountType === "liability" && b.account in nextLiabilities) {
            nextLiabilities[b.account as keyof LiabilityState] = { start: b.start || 0, end: b.end || 0 };
          }
        }
        setAssets(nextAssets);
        setLiabilities(nextLiabilities);
        setStateMsg("年度データを読み込みました");
      })
      .catch(() => setStateMsg("年度データの読込に失敗しました"))
      .finally(() => {
        stateLoadedRef.current = true;
        setTimeout(() => setStateMsg(""), 2500);
      });
  }, [year]);

  useEffect(() => {
    if (!stateLoadedRef.current) return;
    if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    stateSaveTimerRef.current = setTimeout(() => {
      const openingBalances = [
        ...Object.entries(assets).map(([account, value]) => ({ accountType: "asset", account, ...value })),
        ...Object.entries(liabilities).map(([account, value]) => ({ accountType: "liability", account, ...value })),
      ];
      fetch(`/api/aoiro/state?year=${year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessSettings: {
            tradeName,
            businessType,
            deductionType,
            inventoryStart,
            inventoryEnd,
            plDateFrom,
            plDateTo,
          },
          deductions,
          fixedAssets,
          openingBalances,
        }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("save failed");
          setStateMsg("保存しました");
          setTimeout(() => setStateMsg(""), 1500);
        })
        .catch(() => setStateMsg("保存に失敗しました"));
    }, 600);
  }, [
    year, tradeName, businessType, deductionType, inventoryStart, inventoryEnd, plDateFrom, plDateTo,
    deductions, fixedAssets, assets, liabilities,
  ]);

  async function previewNotionImport() {
    setNotionMsg("Notionを確認中...");
    setNotionPreview(null);
    const res = await fetch(`/api/aoiro/notion?year=${year}`);
    const data = await res.json();
    if (!res.ok) {
      setNotionMsg(data.error || "Notion取込プレビューに失敗しました");
      return;
    }
    setNotionPreview(data);
    setNotionMsg(`売上${data.saleCount}件 / 入金${data.paidCount}件を取込可能です`);
  }

  async function importNotionEntries() {
    setNotionMsg("取込中...");
    const res = await fetch("/api/aoiro/notion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotionMsg(data.error || "Notion取込に失敗しました");
      return;
    }
    setNotionPreview(data);
    const rows = await fetch("/api/aoiro/transactions").then((r) => r.json());
    setEntries(rows.map((r: {id: number; date: string; description: string; debitAccount: string; debitAmount: number; creditAccount: string; creditAmount: number; fileName?: string; fileData?: string; source?: string; sourceId?: string}) => ({
      id: String(r.id), date: r.date, description: r.description,
      debitAccount: r.debitAccount, debitAmount: r.debitAmount,
      creditAccount: r.creditAccount, creditAmount: r.creditAmount,
      fileName: r.fileName ?? undefined, fileData: r.fileData ?? undefined,
      source: r.source ?? undefined, sourceId: r.sourceId ?? undefined,
    })));
    setNotionMsg(`${data.imported}件を取り込みました（二重取込はスキップ）`);
  }

  // ── Calculations ──────────────────────────────────────────────────────────

  const calc = useMemo(() => {
    const totalRevenue = monthlyRevenue.reduce((a, b) => a + b, 0);
    const totalPurchase = monthlyPurchase.reduce((a, b) => a + b, 0);
    const grossProfit = totalRevenue - totalPurchase;

    const totalExpenses = (Object.values(expenses) as number[]).reduce((a, b) => a + b, 0);

    const incomeBeforeDeduction = grossProfit - totalExpenses;

    const aoiroDeductionMax = deductionType === "65" ? 65 : deductionType === "55" ? 55 : 10;
    // 控除は所得を下回る場合は所得額が上限（マイナスにはならない）
    const appliedAoiroDeduction = Math.min(aoiroDeductionMax, Math.max(0, incomeBeforeDeduction));
    const businessIncome = Math.max(0, incomeBeforeDeduction - appliedAoiroDeduction);

    const socialInsurance = deductions.社会保険料控除;
    const lifeInsurance = deductions.生命保険料控除;
    const earthquakeInsurance = deductions.地震保険料控除;
    const spouseDeduction = deductions.配偶者控除;
    const dependentDeduction = deductions.扶養控除人数 * 38;
    const basicDeduction = 48;
    const totalPersonalDeductions =
      socialInsurance + lifeInsurance + earthquakeInsurance + spouseDeduction + dependentDeduction + basicDeduction;

    const taxableIncome = Math.max(0, businessIncome - totalPersonalDeductions);
    const incomeTax = calcIncomeTax(taxableIncome);
    const reconstructionTax = incomeTax * 0.021;
    const residentTax = taxableIncome * 0.10;
    const totalTax = incomeTax + reconstructionTax + residentTax;

    return {
      totalRevenue, totalPurchase, grossProfit, totalExpenses,
      incomeBeforeDeduction, aoiroDeductionMax, appliedAoiroDeduction, businessIncome,
      totalPersonalDeductions, basicDeduction, taxableIncome,
      incomeTax, reconstructionTax, residentTax, totalTax,
    };
  }, [monthlyRevenue, monthlyPurchase, expenses, deductionType, deductions]);

  const bsCalc = useMemo(() => {
    const assetTotal = (Object.values(assets) as BalanceSheetAccount[]).reduce(
      (acc, a) => ({ start: acc.start + a.start, end: acc.end + a.end }), { start: 0, end: 0 }
    );
    const liabTotal = (Object.values(liabilities) as BalanceSheetAccount[]).reduce(
      (acc, a) => ({ start: acc.start + a.start, end: acc.end + a.end }), { start: 0, end: 0 }
    );
    const diff = {
      start: assetTotal.start - liabTotal.start,
      end: assetTotal.end - liabTotal.end,
    };
    return { assetTotal, liabTotal, diff };
  }, [assets, liabilities]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const setMonthVal = (
    arr: number[], setArr: (v: number[]) => void, idx: number, val: number
  ) => {
    const next = [...arr];
    next[idx] = val;
    setArr(next);
  };

  const setExpense = (key: keyof ExpenseState, val: number) =>
    setExpenses((prev) => ({ ...prev, [key]: val }));

  const setAsset = (key: keyof AssetState, field: keyof BalanceSheetAccount, val: number) =>
    setAssets((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));

  const setLiability = (key: keyof LiabilityState, field: keyof BalanceSheetAccount, val: number) =>
    setLiabilities((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));

  // ── 書類印刷 ────────────────────────────────────────────────────────────────

  function printPL() {
    const G = "#1a6632";
    const inv4 = inventoryStart + calc.totalPurchase;
    const inv6 = inv4 - inventoryEnd;
    const item7 = calc.totalRevenue - inv6;
    const expSum = calc.totalExpenses;
    const item_chisa = item7 - expSum;
    const e = expenses;
    const n = (v: number) => v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const cell = (num: string, label: string, val: string, green = false) =>
      `<tr style="background:${green ? "#edf7ed" : "#fafdf8"}">
        <td style="padding:2px 4px;border-bottom:1px solid #ccc;font-size:11px;white-space:nowrap">
          <span style="color:${G};font-weight:bold;margin-right:2px">${num}</span>${label}
        </td>
        <td style="padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px;white-space:nowrap">${val}</td>
      </tr>`;
    const empty = (num: string, label = "") =>
      `<tr style="background:#f9f9f9">
        <td style="padding:2px 4px;border-bottom:1px solid #ddd;font-size:11px;color:#aaa">
          <span style="color:#aaa;margin-right:2px">${num}</span>${label}
        </td>
        <td style="padding:2px 6px;border-bottom:1px solid #ddd;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px;color:#ccc">0.0</td>
      </tr>`;

    const colStyle = "width:33%;vertical-align:top;border-right:2px solid " + G;
    const thStyle = `padding:3px 4px;background:${G};color:white;font-size:11px;text-align:center;border-right:1px solid rgba(255,255,255,0.3)`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>損益計算書 ${year}年分</title>
<style>
  body{font-family:'Hiragino Sans',YuGothic,sans-serif;font-size:12px;margin:16px;background:#fff}
  table{border-collapse:collapse;width:100%}
  .form-outer{border:2.5px solid ${G};background:#fafdf8}
  .form-header{background:${G};color:white;text-align:center;padding:6px 12px;font-weight:bold;font-size:14px;letter-spacing:8px;display:flex;justify-content:space-between;align-items:center}
  .form-header .sub{font-size:11px;letter-spacing:2px}
  @media print{body{margin:8px}.form-outer{page-break-inside:avoid}}
</style></head>
<body>
<p style="font-size:11px;color:#666;margin:0 0 6px">
  令和${year - 2018}年分（${year}年分）　屋号：${tradeName || "—"}　事業種目：${businessType || "—"}
</p>
<div class="form-outer">
  <div class="form-header">
    <span>損　益　計　算　書</span>
    <span class="sub">自 ${plDateFrom}月 至 ${plDateTo}月　（単位：万円）</span>
  </div>
  <table>
    <thead>
      <tr>
        <th colspan="2" style="${thStyle};border-right:2px solid ${G}">左列　科　目　／　金　額</th>
        <th colspan="2" style="${thStyle};border-right:2px solid ${G}">中列　科　目　／　金　額</th>
        <th colspan="2" style="${thStyle}">右列　科　目　／　金　額</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="${colStyle}"><table style="width:100%">
          ${cell("①", "売上(収入)金額", n(calc.totalRevenue), true)}
          ${cell("②", "期首商品棚卸高", n(inventoryStart))}
          ${cell("③", "仕入金額", n(calc.totalPurchase), true)}
          ${cell("④", "小　計（②＋③）", n(inv4), true)}
          ${cell("⑤", "期末商品棚卸高", n(inventoryEnd))}
          ${cell("⑥", "差引原価（④－⑤）", n(inv6), true)}
          ${cell("⑦", "差引金額（①－⑥）", n(item7), true)}
          ${cell("⑧", "租税公課", n(e.租税公課))}
          ${cell("⑨", "荷造運賃", n(e.荷造運賃))}
          ${cell("⑩", "水道光熱費", n(e.水道光熱費))}
          ${cell("⑪", "旅費交通費", n(e.旅費交通費))}
          ${cell("⑫", "通信費", n(e.通信費))}
          ${cell("⑬", "広告宣伝費", n(e.広告宣伝費))}
          ${cell("⑭", "接待交際費", n(e.接待交際費))}
          ${cell("⑮", "損害保険料", n(e.損害保険料))}
          ${cell("⑯", "修繕費", n(e.修繕費))}
        </table></td>
        <td style="${colStyle}"><table style="width:100%">
          ${cell("⑰", "消耗品費", n(e.消耗品費))}
          ${cell("⑱", "減価償却費", n(e.減価償却費))}
          ${cell("⑲", "福利厚生費", n(e.福利厚生費))}
          ${cell("⑳", "給料賃金", n(e.給料賃金))}
          ${cell("㉑", "外注工賃", n(e.外注工賃))}
          ${cell("㉒", "利子割引料", n(e.利子割引料))}
          ${cell("㉓", "地代家賃", n(e.地代家賃))}
          ${cell("㉔", "貸倒金", n(e.貸倒金))}
          ${cell("㉕", "その他経費", n(e.その他経費))}
          ${empty("㉖")}${empty("㉗")}${empty("㉘")}${empty("㉙")}${empty("㉚")}
          ${cell("㉛", "雑　費", n(e.雑費))}
          ${cell("㉜", "計", n(expSum), true)}
          ${cell("㉝", "差引金額（⑦－㉜）", n(item_chisa), true)}
        </table></td>
        <td style="width:33%;vertical-align:top"><table style="width:100%">
          ${empty("㊳", "専従者給与（計）")}
          ${empty("", "貸倒引当金繰入額")}
          ${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}${empty("")}
          ${cell("⑬", "青色申告控除前の所得金額", n(calc.incomeBeforeDeduction), true)}
          ${cell("⑭", `青色申告特別控除額（${deductionType}万）`, n(calc.appliedAoiroDeduction), true)}
          ${`<tr style="background:#d4edda"><td style="padding:3px 4px;border-bottom:1px solid ${G};font-size:12px;font-weight:bold;white-space:nowrap"><span style="color:${G};font-weight:bold;margin-right:2px">⑮</span>所得金額（⑬－⑭）</td><td style="padding:3px 6px;border-left:1px solid ${G};text-align:right;font-family:monospace;font-size:13px;font-weight:bold;color:${G}">${n(calc.businessIncome)}</td></tr>`}
        </table></td>
      </tr>
    </tbody>
  </table>
</div>
<p style="margin-top:10px;font-size:10px;color:#999">本書類は参考資料です。実際の申告は税理士または最新の国税庁資料をご確認ください。</p>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  }

  function printBS() {
    const G = "#1a6632";
    const n = (v: number) => v.toFixed(1);
    const bsCell = (label: string, start: number, end: number, bold = false) =>
      `<tr style="background:${bold ? "#edf7ed" : "#fafdf8"}">
        <td style="padding:2px 6px;border-bottom:1px solid #ccc;font-size:11px;${bold ? "font-weight:bold" : ""}">${label}</td>
        <td style="padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px">${n(start)}</td>
        <td style="padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px;${bold ? "font-weight:bold;color:" + G : ""}">${n(end)}</td>
      </tr>`;
    const thStyle = `padding:4px 6px;background:${G};color:white;font-size:11px;text-align:center;border-right:1px solid rgba(255,255,255,0.3)`;
    const sectionHead = (label: string) =>
      `<tr><td colspan="3" style="padding:3px 6px;background:${G}22;color:${G};font-weight:bold;font-size:11px;border-bottom:1px solid ${G}">${label}</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>貸借対照表 ${year}年分</title>
<style>
  body{font-family:'Hiragino Sans',YuGothic,sans-serif;font-size:12px;margin:16px;background:#fff}
  table{border-collapse:collapse;width:100%}
  .outer{border:2.5px solid ${G};background:#fafdf8}
  .header{background:${G};color:white;text-align:center;padding:6px 12px;font-weight:bold;font-size:14px;letter-spacing:8px;display:flex;justify-content:space-between;align-items:center}
  .cols{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid ${G}}
  .col{border-right:2px solid ${G}}
  .col:last-child{border-right:none}
  @media print{body{margin:8px}.outer{page-break-inside:avoid}}
</style></head>
<body>
<p style="font-size:11px;color:#666;margin:0 0 6px">令和${year - 2018}年分（${year}年分）　屋号：${tradeName || "—"}　事業種目：${businessType || "—"}</p>
<div class="outer">
  <div class="header">
    <span>貸　借　対　照　表</span>
    <span style="font-size:11px;letter-spacing:2px">（資産負債調）　単位：万円</span>
  </div>
  <div class="cols">
    <div class="col">
      <table>
        <thead><tr>
          <th style="${thStyle}">科　目</th>
          <th style="${thStyle}">期首残高</th>
          <th style="${thStyle}">期末残高</th>
        </tr></thead>
        <tbody>
          ${sectionHead("資　産　の　部")}
          ${sectionHead("【流動資産】")}
          ${bsCell("現金", assets.現金.start, assets.現金.end)}
          ${bsCell("預金（普通預金等）", assets.預金.start, assets.預金.end)}
          ${bsCell("売掛金", assets.売掛金.start, assets.売掛金.end)}
          ${bsCell("棚卸資産", assets.棚卸資産.start, assets.棚卸資産.end)}
          ${sectionHead("【固定資産】")}
          ${bsCell("固定資産", assets.固定資産.start, assets.固定資産.end)}
          ${sectionHead("【その他】")}
          ${bsCell("事業主貸", assets.事業主貸.start, assets.事業主貸.end)}
          ${bsCell("その他資産", assets.その他資産.start, assets.その他資産.end)}
          ${bsCell("資　産　合　計", bsCalc.assetTotal.start, bsCalc.assetTotal.end, true)}
        </tbody>
      </table>
    </div>
    <div class="col">
      <table>
        <thead><tr>
          <th style="${thStyle}">科　目</th>
          <th style="${thStyle}">期首残高</th>
          <th style="${thStyle}">期末残高</th>
        </tr></thead>
        <tbody>
          ${sectionHead("負　債　の　部")}
          ${bsCell("買掛金", liabilities.買掛金.start, liabilities.買掛金.end)}
          ${bsCell("借入金", liabilities.借入金.start, liabilities.借入金.end)}
          ${bsCell("その他負債", liabilities.その他負債.start, liabilities.その他負債.end)}
          ${sectionHead("資　本　の　部")}
          ${bsCell("元入金", liabilities.元入金.start, liabilities.元入金.end)}
          ${bsCell("事業主借", liabilities.事業主借.start, liabilities.事業主借.end)}
          ${`<tr style="background:#fffde7"><td style="padding:2px 6px;border-bottom:1px solid #ccc;font-size:11px;color:#888;font-style:italic">（当期純利益 → 元入金へ加算）</td>
             <td style="padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px;color:#aaa">—</td>
             <td style="padding:2px 6px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;text-align:right;font-family:monospace;font-size:11px;color:#e67e22">${n(calc.incomeBeforeDeduction)}</td></tr>`}
          ${bsCell("負債・資本合計", bsCalc.liabTotal.start, bsCalc.liabTotal.end, true)}
          <tr style="background:${Math.abs(bsCalc.diff.end) < 0.05 ? "#d4edda" : "#fde8e8"}">
            <td colspan="2" style="padding:4px 8px;font-size:11px;font-weight:bold;color:${Math.abs(bsCalc.diff.end) < 0.05 ? G : "#c0392b"}">
              ${Math.abs(bsCalc.diff.end) < 0.05 ? "✓ 貸借バランス" : "⚠ 差額あり（元入金を調整してください）"}
            </td>
            <td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:bold;font-size:11px;color:${Math.abs(bsCalc.diff.end) < 0.05 ? G : "#c0392b"}">${n(bsCalc.diff.end)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
<p style="margin-top:10px;font-size:10px;color:#999">本書類は参考資料です。実際の申告は税理士または最新の国税庁資料をご確認ください。</p>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  }

  const MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  const EXPENSE_COLS: (keyof ExpenseState)[][] = [
    ["給料賃金","外注工賃","減価償却費","貸倒金","地代家賃"],
    ["利子割引料","租税公課","荷造運賃","水道光熱費","旅費交通費"],
    ["通信費","広告宣伝費","接待交際費","損害保険料","修繕費"],
    ["消耗品費","福利厚生費","雑費","その他経費"],
  ];

  const ASSET_KEYS = Object.keys(assets) as (keyof AssetState)[];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto px-4 py-6 space-y-4 max-w-7xl">
      {/* Title */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">青色申告 作成サポート</h1>
            <p className="text-sm text-muted-foreground">個人事業主向け　{year}年分（令和{year - 2018}年分）青色申告決算書・損益計算書・貸借対照表</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {stateMsg && <span className="self-center text-xs text-muted-foreground">{stateMsg}</span>}
          <button onClick={printPL}
            className="flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 text-blue-700 px-3 py-1.5 text-sm font-medium hover:bg-blue-100 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300">
            <Printer className="h-4 w-4" />損益計算書
          </button>
          <button onClick={printBS}
            className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-300">
            <Printer className="h-4 w-4" />貸借対照表
          </button>
        </div>
      </div>

      {/* ── Notion 請求取込 ── */}
      <Card className="border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/10">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Notion 月次工数記録DBから売上・入金仕訳を取込</h2>
              <p className="text-xs text-muted-foreground">
                発行済請求は 売掛金 / 売上、入金日は 普通預金 / 売掛金 として取り込みます。
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={previewNotionImport}
                className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
                プレビュー
              </button>
              <button onClick={importNotionEntries} disabled={!notionPreview || notionPreview.entries.length === 0}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                確定取込
              </button>
            </div>
          </div>
          {notionMsg && <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">{notionMsg}</p>}
          {notionPreview && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className="rounded border bg-white/70 p-2"><div className="text-muted-foreground">売上件数</div><div className="font-semibold">{notionPreview.saleCount}件</div></div>
              <div className="rounded border bg-white/70 p-2"><div className="text-muted-foreground">売上合計</div><div className="font-semibold">¥{notionPreview.saleTotal.toLocaleString("ja-JP")}</div></div>
              <div className="rounded border bg-white/70 p-2"><div className="text-muted-foreground">入金件数</div><div className="font-semibold">{notionPreview.paidCount}件</div></div>
              <div className="rounded border bg-white/70 p-2"><div className="text-muted-foreground">入金合計</div><div className="font-semibold">¥{notionPreview.paidTotal.toLocaleString("ja-JP")}</div></div>
              <div className="rounded border bg-white/70 p-2"><div className="text-muted-foreground">既存スキップ</div><div className="font-semibold">{notionPreview.skipped}件</div></div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 公式フォーム対応マップ ── */}
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 p-3">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 mb-2">このページの入力 → 青色申告決算書（公式フォーム）の対応表</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            { code: "FA3000", page: "1ページ目", items: ["基本情報（表紙）", "月別売上・仕入", "経費明細", "損益計算書（差引金額欄）"] },
            { code: "FA3025", page: "2ページ目", items: ["仕訳帳（売上内訳・給料賃金内訳の元データ）"] },
            { code: "FA3050", page: "3ページ目", items: ["減価償却費の計算"] },
            { code: "FA3075", page: "4ページ目", items: ["貸借対照表"] },
          ].map(({ code, page, items }) => (
            <div key={code} className="flex-1 min-w-[180px] bg-white dark:bg-emerald-900/20 rounded border border-emerald-200 dark:border-emerald-700 p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${FORM_BADGE_COLORS[code]}`}>{code}</span>
                <span className="font-medium text-emerald-800 dark:text-emerald-300">{page}</span>
              </div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item} className="text-muted-foreground flex items-start gap-1">
                    <span className="text-emerald-500 mt-0.5">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── 青色申告とは？学習セクション ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 青色 vs 白色 比較 */}
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-500" />
              青色申告 vs 白色申告
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 text-muted-foreground font-medium">項目</th>
                  <th className="text-center py-1.5 text-blue-600 font-semibold">青色申告</th>
                  <th className="text-center py-1.5 text-muted-foreground font-medium">白色申告</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["特別控除", "最大65万円", "なし"],
                  ["簿記", "複式簿記（65万）", "単式でOK"],
                  ["赤字の繰越", "3年間OK", "不可"],
                  ["家族への給与", "全額経費OK", "上限あり"],
                  ["30万未満の資産", "一括経費化", "原則不可"],
                  ["事前申請", "必要（開業2ヶ月以内）", "不要"],
                ].map(([item, blue, white]) => (
                  <tr key={item}>
                    <td className="py-1.5 text-muted-foreground">{item}</td>
                    <td className="py-1.5 text-center font-medium text-blue-600">{blue}</td>
                    <td className="py-1.5 text-center text-muted-foreground">{white}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* 65万控除のインパクト */}
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              65万円控除でどのくらい得？
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-xs text-muted-foreground">経費とは別に、所得から最大65万円が引かれます。</p>
            <div className="bg-muted/50 rounded p-3 text-xs space-y-1 font-mono">
              <div>売上 - 経費 = 事業所得</div>
              <div className="text-blue-600">事業所得 - <strong>65万円控除</strong> = 課税所得</div>
              <div>課税所得 × 税率 = 所得税</div>
            </div>
            <div className="space-y-2">
              {[
                { income: 100, rate: 0.05, label: "所得100万円（税率5%）" },
                { income: 300, rate: 0.10, label: "所得300万円（税率10%）" },
                { income: 500, rate: 0.20, label: "所得500万円（税率20%）" },
              ].map(({ income, rate, label }) => (
                <div key={income} className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold text-emerald-600">
                    約{Math.round(65 * rate * 10) / 10}万円節税
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-2 text-xs">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              <span>65万円控除には<strong>e-Tax（電子申告）＋複式簿記</strong>が必要。紙申告は55万円。</span>
            </div>
          </CardContent>
        </Card>

        {/* 開業届と手続きTODO */}
        <Card className="border-orange-200 dark:border-orange-800 md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              青色申告を始めるには？ 手続きTODO
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  step: "1",
                  title: "開業届を提出",
                  deadline: "開業日から1ヶ月以内",
                  detail: "「個人事業の開業・廃業等届出書」を税務署へ。freee開業またはe-Taxで提出。",
                  note: "freee開業で作成 → e-Tax送信がおすすめ",
                  color: "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800",
                  noteColor: "text-orange-600 dark:text-orange-400",
                },
                {
                  step: "2",
                  title: "青色申告承認申請書を提出",
                  deadline: "開業日から2ヶ月以内",
                  detail: "「所得税の青色申告承認申請書」を同じ税務署へ。STEP1と同時提出が便利。",
                  note: "freee開業でSTEP1と一緒に作成できる",
                  color: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
                  noteColor: "text-blue-600 dark:text-blue-400",
                },
                {
                  step: "3",
                  title: "インボイス登録申請",
                  deadline: "いつでもOK（早めが◎）",
                  detail: "クライアントが法人の場合は登録推奨。「適格請求書発行事業者の登録申請書」をe-Taxで提出。登録番号（T+13桁）が発行される。",
                  note: "2026年分は2割特例あり → 消費税の80%は免除",
                  color: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800",
                  noteColor: "text-purple-600 dark:text-purple-400",
                },
                {
                  step: "4",
                  title: "複式簿記で記帳＋e-Tax申告",
                  deadline: "翌年2/16〜3/15",
                  detail: "freee会計・マネーフォワード等で記帳。e-Taxで電子申告すれば65万円控除が使える。",
                  note: "このページで損益計算書・貸借対照表を作成できる",
                  color: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800",
                  noteColor: "text-emerald-600 dark:text-emerald-400",
                },
              ].map(({ step, title, deadline, detail, note, color, noteColor }) => (
                <div key={step} className={`rounded-lg border p-3 ${color}`}>
                  <div className="text-lg font-bold text-muted-foreground mb-1">STEP {step}</div>
                  <div className="font-semibold text-sm mb-1">{title}</div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">{deadline}</div>
                  <div className="text-xs text-muted-foreground mb-2">{detail}</div>
                  <div className={`text-xs font-medium ${noteColor}`}>▶ {note}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-2 bg-muted/50 rounded p-2 text-xs">
              <BookOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <strong>会社員の副業の場合：</strong>
                副業収入が年間20万円以下なら確定申告不要（所得税）。ただし住民税の申告は1円から必要。
                副業を会社に知られたくない場合は住民税を<strong>「普通徴収」</strong>に設定すること。
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sticky Summary Bar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border rounded-lg px-4 py-3 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "事業所得", value: fmt(calc.businessIncome), color: "text-emerald-600" },
            { label: "青色申告特別控除", value: fmt(calc.appliedAoiroDeduction), color: "text-blue-600" },
            { label: "課税所得", value: fmt(calc.taxableIncome), color: "text-orange-600" },
            { label: "所得税目安", value: fmt(calc.incomeTax), color: "text-red-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className={`text-lg font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 1: 基本情報 ── */}
      <Card>
        <SectionHeader title="1. 基本情報" icon={<FileText className="h-4 w-4" />} open={openSections[1]} onToggle={() => toggle(1)} formRef={{ code: "FA3000", label: "決算書 表紙" }} />
        {openSections[1] && (
          <CardContent className="pt-0 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">年分</label>
                <select
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {[2023, 2024, 2025, 2026].map((y) => (
                    <option key={y} value={y}>{y}年分（令和{y - 2018}年分）</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">屋号</label>
                <input
                  type="text"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  placeholder="例: 山田商店"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">事業種目</label>
                <input
                  type="text"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="例: 小売業"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">青色申告特別控除の区分</label>
              <div className="flex flex-wrap gap-4">
                {([
                  { value: "65", label: "65万円（複式簿記 + e-Tax）" },
                  { value: "55", label: "55万円（複式簿記 + 紙申告）" },
                  { value: "10", label: "10万円（簡易簿記）" },
                ] as const).map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deductionType"
                      value={value}
                      checked={deductionType === value}
                      onChange={() => setDeductionType(value)}
                      className="accent-primary"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Note>複式簿記で記帳し、貸借対照表を添付するとe-Taxで65万円控除が受けられます。2020年分以降、電子申告（e-Tax）要件が追加されました。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── 仕訳帳 ── */}
      <Card className="border-primary/30">
        <SectionHeader title="仕訳帳（日々の記帳）" icon={<BookOpen className="h-4 w-4 text-primary" />} open={openSections[0]} onToggle={() => toggle(0)} formRef={{ code: "FA3025", label: "売上内訳・給料賃金内訳の元データ" }} />
        {openSections[0] && (
          <CardContent className="pt-0 space-y-3">
            {/* 仕訳入力フォーム */}
            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">日付</label>
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">摘要</label>
                  <input type="text" value={txDesc} onChange={(e) => setTxDesc(e.target.value)}
                    placeholder="例: A社 開発案件 入金"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">金額（円）</label>
                  <input type="number" min="0" step="1" value={txAmount === 0 ? "" : txAmount} placeholder="0"
                    onChange={(e) => setTxAmount(parseInt(e.target.value) || 0)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-blue-600 mb-1 block">借方（デビット）</label>
                    <select value={txDebit} onChange={(e) => setTxDebit(e.target.value)}
                      className="w-full rounded-md border border-blue-200 bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {Object.entries(ACCOUNTS).map(([group, accounts]) => (
                        <optgroup key={group} label={group}>
                          {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="text-muted-foreground font-bold text-lg pt-5">/</div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-red-600 mb-1 block">貸方（クレジット）</label>
                    <select value={txCredit} onChange={(e) => setTxCredit(e.target.value)}
                      className="w-full rounded-md border border-red-200 bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400">
                      {Object.entries(ACCOUNTS).map(([group, accounts]) => (
                        <optgroup key={group} label={group}>
                          {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer rounded-md border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 flex-1">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{txFile ? txFile.name : "証憑添付（任意）"}</span>
                    <input type="file" accept="image/*,application/pdf" onChange={handleFileSelect} className="hidden" />
                  </label>
                  {txFile && <button onClick={() => setTxFile(null)} className="text-xs text-red-500">✕</button>}
                  <button onClick={addEntry}
                    className="shrink-0 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 flex items-center gap-1">
                    <Plus className="h-3.5 w-3.5" />仕訳追加
                  </button>
                </div>
              </div>
              {/* クイック入力ヒント */}
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: "売上入金", d: "普通預金", c: "売上" },
                  { label: "売掛計上", d: "売掛金", c: "売上" },
                  { label: "売掛回収", d: "普通預金", c: "売掛金" },
                  { label: "経費支払", d: "通信費", c: "普通預金" },
                  { label: "現金引出", d: "事業主貸", c: "普通預金" },
                ].map(({ label, d, c }) => (
                  <button key={label} onClick={() => { setTxDebit(d); setTxCredit(c); }}
                    className="text-xs px-2 py-0.5 rounded-full border hover:bg-muted/50 text-muted-foreground">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 仕訳一覧 */}
            {entries.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6 border border-dashed rounded-lg">
                仕訳がまだありません。上のフォームから追加してください。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-2 py-1.5 border font-medium w-24">日付</th>
                      <th className="text-left px-2 py-1.5 border font-medium">摘要</th>
                      <th className="text-center px-2 py-1.5 border font-medium text-blue-600">借方</th>
                      <th className="text-right px-2 py-1.5 border font-medium">借方金額</th>
                      <th className="text-center px-2 py-1.5 border font-medium text-red-600">貸方</th>
                      <th className="text-right px-2 py-1.5 border font-medium">貸方金額</th>
                      <th className="px-2 py-1.5 border w-8 text-center">証憑</th>
                      <th className="px-2 py-1.5 border w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
                      const isEditing = editingId === e.id;
                      if (isEditing) {
                        const d = editDraft;
                        return (
                          <tr key={e.id} className="bg-yellow-50 dark:bg-yellow-950/20">
                            <td className="px-1 py-1 border">
                              <input type="date" value={d.date ?? e.date} onChange={(ev) => setEditDraft((p) => ({ ...p, date: ev.target.value }))}
                                className="w-full rounded border border-input bg-background px-1 py-0.5 text-xs focus:outline-none" />
                            </td>
                            <td className="px-1 py-1 border">
                              <input type="text" value={d.description ?? e.description} onChange={(ev) => setEditDraft((p) => ({ ...p, description: ev.target.value }))}
                                className="w-full rounded border border-input bg-background px-1 py-0.5 text-xs focus:outline-none" />
                            </td>
                            <td className="px-1 py-1 border">
                              <select value={d.debitAccount ?? e.debitAccount} onChange={(ev) => setEditDraft((p) => ({ ...p, debitAccount: ev.target.value }))}
                                className="w-full rounded border border-blue-200 bg-background px-1 py-0.5 text-xs focus:outline-none">
                                {ALL_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </td>
                            <td className="px-1 py-1 border">
                              <input type="number" min="0" step="1" value={d.debitAmount ?? e.debitAmount} onChange={(ev) => setEditDraft((p) => ({ ...p, debitAmount: parseInt(ev.target.value) || 0 }))}
                                className="w-full rounded border border-input bg-background px-1 py-0.5 text-xs text-right focus:outline-none" />
                            </td>
                            <td className="px-1 py-1 border">
                              <select value={d.creditAccount ?? e.creditAccount} onChange={(ev) => setEditDraft((p) => ({ ...p, creditAccount: ev.target.value }))}
                                className="w-full rounded border border-red-200 bg-background px-1 py-0.5 text-xs focus:outline-none">
                                {ALL_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </td>
                            <td className="px-1 py-1 border">
                              <input type="number" min="0" step="1" value={d.creditAmount ?? e.creditAmount} onChange={(ev) => setEditDraft((p) => ({ ...p, creditAmount: parseInt(ev.target.value) || 0 }))}
                                className="w-full rounded border border-input bg-background px-1 py-0.5 text-xs text-right focus:outline-none" />
                            </td>
                            <td className="px-1 py-1 border text-center">
                              <div className="flex flex-col items-center gap-1">
                                {/* 現在の証憑 */}
                                {(d.newFile !== undefined ? d.newFile : (e.fileData ? { name: e.fileName ?? "", data: e.fileData } : null)) !== null &&
                                  (d.newFile !== undefined ? d.newFile : (e.fileData ? { name: e.fileName ?? "", data: e.fileData } : null)) ?
                                  <div className="flex items-center gap-1">
                                    <FileText className="h-3 w-3 text-blue-500" />
                                    <span className="text-xs truncate max-w-[60px]">{(d.newFile ?? { name: e.fileName ?? "" }).name}</span>
                                    <button onClick={() => setEditDraft((p) => ({ ...p, newFile: null }))} className="text-red-400 hover:text-red-600" title="証憑削除"><X className="h-3 w-3" /></button>
                                  </div>
                                  : null
                                }
                                <label className="cursor-pointer text-xs text-blue-600 hover:underline">
                                  {(d.newFile !== undefined ? d.newFile : e.fileData) ? "変更" : "添付"}
                                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(ev) => {
                                    const file = ev.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => setEditDraft((p) => ({ ...p, newFile: { name: file.name, data: reader.result as string } }));
                                    reader.readAsDataURL(file);
                                    ev.target.value = "";
                                  }} />
                                </label>
                              </div>
                            </td>
                            <td className="px-1 py-1 border text-center">
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => saveEdit(e)} className="text-emerald-600 hover:text-emerald-700" title="保存"><Check className="h-3.5 w-3.5" /></button>
                                <button onClick={cancelEdit} className="text-muted-foreground hover:text-red-500" title="キャンセル"><X className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={e.id} className="hover:bg-muted/20">
                          <td className="px-2 py-1 border font-mono">{e.date}</td>
                          <td className="px-2 py-1 border">{e.description || "—"}</td>
                          <td className="px-2 py-1 border text-center">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-medium">{e.debitAccount}</span>
                          </td>
                          <td className="px-2 py-1 border text-right font-mono">{e.debitAmount.toLocaleString("ja-JP")}</td>
                          <td className="px-2 py-1 border text-center">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 font-medium">{e.creditAccount}</span>
                          </td>
                          <td className="px-2 py-1 border text-right font-mono">{e.creditAmount.toLocaleString("ja-JP")}</td>
                          <td className="px-2 py-1 border text-center">
                            {e.fileData && e.fileName
                              ? <button onClick={() => viewFile(e.fileData!, e.fileName!)} title={e.fileName} className="flex items-center gap-1 text-blue-500 hover:text-blue-700 text-xs">
                                  <FileText className="h-3.5 w-3.5" /><span className="truncate max-w-[60px]">{e.fileName}</span>
                                </button>
                              : <span className="text-muted-foreground/30 text-xs">なし</span>}
                          </td>
                          <td className="px-2 py-1 border text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => startEdit(e)} className="text-muted-foreground hover:text-blue-500" title="編集">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteEntry(e.id)} className="text-muted-foreground hover:text-red-500" title="削除">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold text-xs">
                      <td colSpan={3} className="px-2 py-1.5 border text-right">借方合計</td>
                      <td className="px-2 py-1 border text-right font-mono">{entries.reduce((s, e) => s + e.debitAmount, 0).toLocaleString("ja-JP")}</td>
                      <td className="px-2 py-1 border text-right">貸方合計</td>
                      <td className="px-2 py-1 border text-right font-mono">{entries.reduce((s, e) => s + e.creditAmount, 0).toLocaleString("ja-JP")}</td>
                      <td colSpan={2} className="border"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* 反映ボタン */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <button onClick={applyEntries}
                className="flex items-center gap-2 rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700">
                <RefreshCw className="h-4 w-4" />損益計算書に反映する
              </button>
              {applyMsg
                ? <span className={`text-xs font-medium ${applyMsg.startsWith("✓") ? "text-emerald-600" : "text-orange-500"}`}>{applyMsg}</span>
                : <span className="text-xs text-muted-foreground">仕訳から売上・経費を自動集計して転記します（{year}年分のみ）</span>}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Section 2: 月別売上・仕入 ── */}
      <Card>
        <SectionHeader title="2. 月別売上・仕入" icon={<TrendingUp className="h-4 w-4" />} open={openSections[2]} onToggle={() => toggle(2)} formRef={{ code: "FA3000", label: "1ページ目 ①〜⑬欄（月別売上・仕入）" }} />
        {openSections[2] && (
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-2 py-1.5 font-medium border w-20">科目</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="px-1 py-1.5 font-medium border text-center w-16">{m}</th>
                    ))}
                    <th className="px-2 py-1.5 font-medium border text-center w-20">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: "売上高", arr: monthlyRevenue, setArr: setMonthlyRevenue, total: calc.totalRevenue, bg: "bg-emerald-50/50" },
                    { label: "売上原価", arr: monthlyPurchase, setArr: setMonthlyPurchase, total: calc.totalPurchase, bg: "" },
                  ] as const).map(({ label, arr, setArr, total, bg }) => (
                    <tr key={label} className={bg}>
                      <td className="px-2 py-1 border font-medium text-xs">{label}</td>
                      {arr.map((v, i) => (
                        <td key={i} className="border p-0.5">
                          <NumInput value={v} onChange={(val) => setMonthVal(arr, setArr as (v: number[]) => void, i, val)} />
                        </td>
                      ))}
                      <td className="border px-2 py-1 text-right font-semibold font-mono">{total.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50/60">
                    <td className="px-2 py-1 border font-medium text-xs">差引</td>
                    {Array.from({ length: 12 }, (_, i) => (
                      <td key={i} className="border px-1 py-1 text-right font-mono text-xs">
                        {(monthlyRevenue[i] - monthlyPurchase[i]).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </td>
                    ))}
                    <td className="border px-2 py-1 text-right font-semibold font-mono">{calc.grossProfit.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Note>仕入れた金額ではなく「売れた分の原価」を記入します（棚卸調整後）。期首・期末棚卸の差額は損益計算書の売上原価に含まれます。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── Section 3: 経費明細 ── */}
      <Card>
        <SectionHeader title="3. 経費明細" icon={<Calculator className="h-4 w-4" />} open={openSections[3]} onToggle={() => toggle(3)} formRef={{ code: "FA3000", label: "1ページ目 ⑭〜㉙欄（各経費科目）" }} />
        {openSections[3] && (
          <CardContent className="pt-0 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {EXPENSE_COLS.map((col, ci) => (
                <div key={ci} className="space-y-2">
                  {col.map((key) => (
                    <div key={key}>
                      <label className="text-xs text-muted-foreground block mb-0.5">{key}</label>
                      <NumInput value={expenses[key]} onChange={(v) => setExpense(key, v)} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-end items-center gap-3 pt-2 border-t">
              <span className="text-sm font-medium text-muted-foreground">経費合計</span>
              <span className="text-lg font-bold text-red-600">{fmt(calc.totalExpenses)}</span>
            </div>
            <Note>家事按分（自宅兼事務所など）がある場合は業務使用割合分のみ計上します。按分根拠（面積比・時間比など）を帳簿に記録しておきましょう。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── Section 3.5: 減価償却費 ── */}
      <Card>
        <SectionHeader title="3.5. 減価償却費の計算" icon={<Calculator className="h-4 w-4" />} open={openSections[35]} onToggle={() => toggle(35)} formRef={{ code: "FA3050", label: "3ページ目（減価償却費の計算）" }} />
        {openSections[35] && (
          <CardContent className="pt-0 space-y-4">
            {/* 入力フォーム */}
            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">資産名称</label>
                  <input type="text" value={faName} onChange={(e) => setFaName(e.target.value)}
                    placeholder="例: MacBook Pro、業務用車両"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">取得年</label>
                  <input type="number" min="2000" max={year} value={faAcquiredYear} onChange={(e) => setFaAcquiredYear(parseInt(e.target.value) || year)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">償却方法</label>
                  <select value={faMethod} onChange={(e) => setFaMethod(e.target.value as DepreciationMethod)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="定額法">定額法（個人は原則）</option>
                    <option value="定率法">定率法（届出要）</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">取得価額（万円）</label>
                  <NumInput value={faCost} onChange={setFaCost} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">耐用年数（年）</label>
                  <input type="number" min="1" max="100" value={faLife} onChange={(e) => setFaLife(parseInt(e.target.value) || 1)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">期首帳簿価額（万円）</label>
                  <NumInput value={faBookStart} onChange={setFaBookStart} />
                  <span className="text-xs text-muted-foreground">0なら取得価額を使用</span>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">事業専用割合（%）</label>
                  <input type="number" min="1" max="100" value={faRatio} onChange={(e) => setFaRatio(parseInt(e.target.value) || 100)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={addFixedAsset}
                  className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90">
                  <Plus className="h-3.5 w-3.5" />資産を追加
                </button>
              </div>
            </div>

            {/* 耐用年数早見表 */}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">主な耐用年数早見表</summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
                {[
                  ["パソコン", "4年"], ["サーバー", "5年"], ["スマートフォン", "4年"],
                  ["業務用車両（普通）", "6年"], ["軽自動車", "4年"], ["自転車", "2年"],
                  ["机・椅子", "8年"], ["カメラ", "5年"], ["エアコン", "6年"],
                  ["木造建物", "22年"], ["RC建物", "47年"], ["ソフトウェア", "5年"],
                ].map(([name, life]) => (
                  <div key={name} className="flex justify-between bg-muted/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-medium">{life}</span>
                  </div>
                ))}
              </div>
            </details>

            {/* 計算一覧 */}
            {depCalcs.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4 border border-dashed rounded-lg">
                固定資産がまだありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-2 py-1.5 border">資産名称</th>
                      <th className="text-center px-2 py-1.5 border">方法</th>
                      <th className="text-right px-2 py-1.5 border">取得価額</th>
                      <th className="text-center px-2 py-1.5 border">耐用年数</th>
                      <th className="text-right px-2 py-1.5 border">期首帳簿価額</th>
                      <th className="text-right px-2 py-1.5 border">償却率</th>
                      <th className="text-right px-2 py-1.5 border">当期償却額</th>
                      <th className="text-center px-2 py-1.5 border">専用割合</th>
                      <th className="text-right px-2 py-1.5 border font-semibold text-emerald-700">経費算入額</th>
                      <th className="text-right px-2 py-1.5 border">期末帳簿価額</th>
                      <th className="px-2 py-1.5 border w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {depCalcs.map((a) => (
                      <tr key={a.id} className="hover:bg-muted/20">
                        <td className="px-2 py-1 border">{a.name}</td>
                        <td className="px-2 py-1 border text-center">{a.method}</td>
                        <td className="px-2 py-1 border text-right font-mono">{a.acquisitionCost.toFixed(1)}</td>
                        <td className="px-2 py-1 border text-center">{a.usefulLife}年</td>
                        <td className="px-2 py-1 border text-right font-mono">{a.bookValueStart.toFixed(1)}</td>
                        <td className="px-2 py-1 border text-right font-mono">{a.rate.toFixed(3)}</td>
                        <td className="px-2 py-1 border text-right font-mono">{a.annualDep.toFixed(1)}</td>
                        <td className="px-2 py-1 border text-center">{a.businessRatio}%</td>
                        <td className="px-2 py-1 border text-right font-mono font-semibold text-emerald-700">{a.deductible.toFixed(1)}</td>
                        <td className="px-2 py-1 border text-right font-mono">{a.bookValueEnd.toFixed(1)}</td>
                        <td className="px-2 py-1 border text-center">
                          <button onClick={() => setFixedAssets((prev) => prev.filter((fa) => fa.id !== a.id))}
                            className="text-muted-foreground hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold text-xs">
                      <td colSpan={8} className="px-2 py-1.5 border text-right">減価償却費合計（経費算入額）</td>
                      <td className="px-2 py-1.5 border text-right font-mono text-emerald-700">{totalDepreciation.toFixed(1)}万円</td>
                      <td colSpan={2} className="border"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <Note>「損益計算書に反映する」を押すと、この減価償却費合計（{totalDepreciation.toFixed(1)}万円）が経費の「減価償却費」欄に自動入力されます。個人事業主は定額法が原則（定率法は税務署への届出が必要）。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── Section 4: 損益計算書 ── */}
      <Card>
        <SectionHeader title="4. 損益計算書" icon={<TrendingUp className="h-4 w-4" />} open={openSections[4]} onToggle={() => toggle(4)} formRef={{ code: "FA3000", label: "1ページ目 ㉚〜㊴欄（差引金額・所得金額）" }} />
        {openSections[4] && (
          <CardContent className="pt-0 pb-3">
            {/* FA3000 官式フォームレイアウト */}
            {(() => {
              // 中間計算
              const inv4 = inventoryStart + calc.totalPurchase;            // ④ 小計
              const inv6 = inv4 - inventoryEnd;                            // ⑥ 差引原価
              const item7 = calc.totalRevenue - inv6;                      // ⑦ 差引金額
              const expSum = calc.totalExpenses;                           // ㉜ 経費計
              const item_chisa = item7 - expSum;                           // ㉝ 差引金額

              // 各経費
              const e = expenses;

              type PlRow = { num: string; label: string; value: number | null; editable?: boolean; onEdit?: (v: number) => void; isAutoGreen?: boolean; isHeader?: boolean; isEmpty?: boolean };

              const leftRows: PlRow[] = [
                { num: "①", label: "売上(収入)金額", value: calc.totalRevenue, isAutoGreen: true },
                { num: "②", label: "期首商品棚卸高", value: inventoryStart, editable: true, onEdit: setInventoryStart },
                { num: "③", label: "仕入金額", value: calc.totalPurchase, isAutoGreen: true },
                { num: "④", label: "小　計（②＋③）", value: inv4, isAutoGreen: true },
                { num: "⑤", label: "期末商品棚卸高", value: inventoryEnd, editable: true, onEdit: setInventoryEnd },
                { num: "⑥", label: "差引原価（④－⑤）", value: inv6, isAutoGreen: true },
                { num: "⑦", label: "差引金額（①－⑥）", value: item7, isAutoGreen: true },
                { num: "⑧", label: "租税公課", value: e.租税公課, editable: true, onEdit: (v) => setExpense("租税公課", v) },
                { num: "⑨", label: "荷造運賃", value: e.荷造運賃, editable: true, onEdit: (v) => setExpense("荷造運賃", v) },
                { num: "⑩", label: "水道光熱費", value: e.水道光熱費, editable: true, onEdit: (v) => setExpense("水道光熱費", v) },
                { num: "⑪", label: "旅費交通費", value: e.旅費交通費, editable: true, onEdit: (v) => setExpense("旅費交通費", v) },
                { num: "⑫", label: "通信費", value: e.通信費, editable: true, onEdit: (v) => setExpense("通信費", v) },
                { num: "⑬", label: "広告宣伝費", value: e.広告宣伝費, editable: true, onEdit: (v) => setExpense("広告宣伝費", v) },
                { num: "⑭", label: "接待交際費", value: e.接待交際費, editable: true, onEdit: (v) => setExpense("接待交際費", v) },
                { num: "⑮", label: "損害保険料", value: e.損害保険料, editable: true, onEdit: (v) => setExpense("損害保険料", v) },
                { num: "⑯", label: "修繕費", value: e.修繕費, editable: true, onEdit: (v) => setExpense("修繕費", v) },
              ];

              const midRows: PlRow[] = [
                { num: "⑰", label: "消耗品費", value: e.消耗品費, editable: true, onEdit: (v) => setExpense("消耗品費", v) },
                { num: "⑱", label: "減価償却費", value: e.減価償却費, editable: true, onEdit: (v) => setExpense("減価償却費", v) },
                { num: "⑲", label: "福利厚生費", value: e.福利厚生費, editable: true, onEdit: (v) => setExpense("福利厚生費", v) },
                { num: "⑳", label: "給料賃金", value: e.給料賃金, editable: true, onEdit: (v) => setExpense("給料賃金", v) },
                { num: "㉑", label: "外注工賃", value: e.外注工賃, editable: true, onEdit: (v) => setExpense("外注工賃", v) },
                { num: "㉒", label: "利子割引料", value: e.利子割引料, editable: true, onEdit: (v) => setExpense("利子割引料", v) },
                { num: "㉓", label: "地代家賃", value: e.地代家賃, editable: true, onEdit: (v) => setExpense("地代家賃", v) },
                { num: "㉔", label: "貸倒金", value: e.貸倒金, editable: true, onEdit: (v) => setExpense("貸倒金", v) },
                { num: "㉕", label: "その他", value: e.その他経費, editable: true, onEdit: (v) => setExpense("その他経費", v) },
                { num: "㉖", label: "（空欄）", value: 0, isEmpty: true },
                { num: "㉗", label: "（空欄）", value: 0, isEmpty: true },
                { num: "㉘", label: "（空欄）", value: 0, isEmpty: true },
                { num: "㉙", label: "（空欄）", value: 0, isEmpty: true },
                { num: "㉚", label: "（空欄）", value: 0, isEmpty: true },
                { num: "㉛", label: "雑　費", value: e.雑費, editable: true, onEdit: (v) => setExpense("雑費", v) },
                { num: "㉜", label: "計", value: expSum, isAutoGreen: true },
                { num: "㉝", label: "差引金額（⑦－㉜）", value: item_chisa, isAutoGreen: true },
              ];

              const rightRows: PlRow[] = [
                { num: "㊳", label: "専従者給与（計）", value: 0, isEmpty: true },
                { num: "", label: "（該当なし）", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "貸倒引当金繰入額", value: null, isEmpty: true },
                { num: "", label: "（該当なし）", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "", label: "", value: null, isEmpty: true },
                { num: "⑬", label: "青色申告控除前の所得金額", value: calc.incomeBeforeDeduction, isAutoGreen: true },
                { num: "⑭", label: `青色申告特別控除額（${deductionType}万）`, value: calc.appliedAoiroDeduction, isAutoGreen: true },
                { num: "⑮", label: "所得金額（⑬－⑭）", value: calc.businessIncome, isAutoGreen: true },
              ];

              const fmtVal = (v: number) => v === 0 ? "0.0" : v.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

              const renderRows = (rows: PlRow[], isRight = false) => rows.map((row, i) => {
                const isGreen = row.isAutoGreen;
                const rowClass = `grid border-b border-[#1a6632]/30 min-h-[22px] ${isGreen ? "bg-[#edf7ed] dark:bg-[#0f2b14]" : row.isEmpty ? "bg-[#f5f5f5] dark:bg-[#111]" : "bg-[#fafdf8] dark:bg-[#0a1a0f]"}`;
                if (isRight && row.value === null && !row.label && !row.num) {
                  return <div key={i} className={rowClass} style={{ gridTemplateColumns: "1fr 90px" }}><div className="px-1 py-0.5" /><div className="border-l border-[#1a6632]/30" /></div>;
                }
                return (
                  <div key={i} className={rowClass} style={{ gridTemplateColumns: "1fr 90px" }}>
                    <div className="px-1 py-0.5 flex items-center gap-0.5 overflow-hidden">
                      {row.num && <span className="text-[#1a6632] font-bold shrink-0 text-[10px]">{row.num}</span>}
                      <span className={`truncate text-[10px] ${row.isEmpty ? "text-gray-400 italic" : ""} ${isGreen ? "font-semibold" : ""}`}>{row.label}</span>
                    </div>
                    <div className="border-l border-[#1a6632]/30 px-1 py-0.5 flex items-center justify-end">
                      {row.value === null ? (
                        <span className="text-gray-300 text-[9px]">―</span>
                      ) : row.editable ? (
                        <input
                          type="number"
                          step="0.1"
                          value={row.value === 0 ? "" : row.value}
                          placeholder="0"
                          onChange={(ev) => row.onEdit && row.onEdit(parseFloat(ev.target.value) || 0)}
                          className="w-full text-right bg-transparent border-none outline-none font-mono text-[10px] text-foreground"
                        />
                      ) : row.isEmpty ? (
                        <span className="text-gray-300 text-[9px]">0</span>
                      ) : (
                        <span className={`font-mono text-[10px] font-semibold ${isRight && row.num === "⑮" ? "text-[#1a6632] text-xs" : ""}`}>{fmtVal(row.value)}</span>
                      )}
                    </div>
                  </div>
                );
              });

              return (
                <div className="border-2 border-[#1a6632] bg-[#fafdf8] dark:bg-[#0a1a0f] rounded overflow-hidden text-xs">
                  {/* Header */}
                  <div className="bg-[#1a6632] text-white flex items-center justify-between px-3 py-1.5">
                    <span className="font-bold tracking-widest text-sm">損　益　計　算　書</span>
                    <div className="flex items-center gap-1 text-[10px] text-white/80">
                      <span>自</span>
                      <select value={plDateFrom} onChange={(e) => setPlDateFrom(e.target.value)}
                        className="bg-[#1a6632] border border-white/40 rounded px-1 text-white text-[10px]">
                        {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={String(m)}>{m}</option>)}
                      </select>
                      <span>月　至</span>
                      <select value={plDateTo} onChange={(e) => setPlDateTo(e.target.value)}
                        className="bg-[#1a6632] border border-white/40 rounded px-1 text-white text-[10px]">
                        {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={String(m)}>{m}</option>)}
                      </select>
                      <span>月　（単位：万円）</span>
                    </div>
                  </div>

                  {/* Column headers */}
                  <div className="grid grid-cols-3 border-b-2 border-[#1a6632]" style={{ borderTop: "1px solid #1a6632" }}>
                    {["左列（①〜⑯）", "中列（⑰〜㉝）", "右列（控除・所得）"].map((label) => (
                      <div key={label} className="grid border-r border-[#1a6632]/60 last:border-r-0" style={{ gridTemplateColumns: "1fr 90px" }}>
                        <div className="bg-[#1a6632]/10 px-2 py-1 text-center font-semibold text-[10px] text-[#1a6632]">科　目</div>
                        <div className="bg-[#1a6632]/10 px-2 py-1 text-center font-semibold text-[10px] text-[#1a6632] border-l border-[#1a6632]/30">金　額（円）</div>
                      </div>
                    ))}
                  </div>

                  {/* 3-column body */}
                  <div className="grid grid-cols-3 divide-x-2 divide-[#1a6632]">
                    <div>{renderRows(leftRows)}</div>
                    <div>{renderRows(midRows)}</div>
                    <div>{renderRows(rightRows, true)}</div>
                  </div>

                  {/* Footer note */}
                  <div className="border-t border-[#1a6632]/40 bg-[#1a6632]/5 px-3 py-1.5 text-[10px] text-muted-foreground flex gap-4">
                    <span>緑背景 = 自動計算</span>
                    <span>白背景 = 入力値（万円単位）</span>
                    <span className="font-semibold text-[#1a6632]">所得金額: {fmt(calc.businessIncome)}</span>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        )}
      </Card>

      {/* ── Section 5: 貸借対照表 ── */}
      <Card>
        <SectionHeader title="5. 貸借対照表" icon={<BookOpen className="h-4 w-4" />} open={openSections[5]} onToggle={() => toggle(5)} formRef={{ code: "FA3075", label: "4ページ目（貸借対照表）" }} />
        {openSections[5] && (
          <CardContent className="pt-0 pb-3">
            {/* FA3075 官式フォームレイアウト */}
            <div className="border-2 border-[#1a6632] bg-[#fafdf8] dark:bg-[#0a1a0f] rounded overflow-hidden text-xs">
              {/* Header */}
              <div className="bg-[#1a6632] text-white flex items-center justify-between px-3 py-1.5">
                <span className="font-bold tracking-widest text-sm">貸　借　対　照　表</span>
                <span className="text-[10px] text-white/80">（資産負債調）　単位：万円</span>
              </div>
              {/* 2-column form */}
              <div className="grid grid-cols-2 divide-x-2 divide-[#1a6632]">
                {/* 資産の部 */}
                <div>
                  <div className="grid border-b border-[#1a6632]/60" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="bg-[#1a6632]/10 px-2 py-1 text-center font-semibold text-[10px] text-[#1a6632]">科　目</div>
                    <div className="bg-[#1a6632]/10 px-1 py-1 text-center font-semibold text-[10px] text-[#1a6632] border-l border-[#1a6632]/30">期首残高</div>
                    <div className="bg-[#1a6632]/10 px-1 py-1 text-center font-semibold text-[10px] text-[#1a6632] border-l border-[#1a6632]/30">期末残高</div>
                  </div>
                  {/* 資産の部 ヘッダー行 */}
                  <div className="bg-[#1a6632]/8 px-2 py-0.5 text-[10px] font-semibold text-[#1a6632] border-b border-[#1a6632]/20">資　産　の　部</div>
                  {ASSET_KEYS.map((key) => (
                    <div key={key} className="grid border-b border-[#1a6632]/20 hover:bg-[#f0faf0] dark:hover:bg-[#0f2b14]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                      <div className="px-2 py-1 text-[11px]">{key}</div>
                      <div className="border-l border-[#1a6632]/30 p-0.5">
                        <input type="number" step="0.1" min="0" value={assets[key].start === 0 ? "" : assets[key].start} placeholder="0"
                          onChange={(e) => setAsset(key, "start", parseFloat(e.target.value) || 0)}
                          className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                      </div>
                      <div className="border-l border-[#1a6632]/30 p-0.5">
                        <input type="number" step="0.1" min="0" value={assets[key].end === 0 ? "" : assets[key].end} placeholder="0"
                          onChange={(e) => setAsset(key, "end", parseFloat(e.target.value) || 0)}
                          className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                      </div>
                    </div>
                  ))}
                  {/* 資産合計 */}
                  <div className="grid bg-[#edf7ed] dark:bg-[#0f2b14] border-t border-[#1a6632]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="px-2 py-1.5 font-bold text-[11px] text-[#1a6632]">資　産　合　計</div>
                    <div className="border-l border-[#1a6632]/40 px-2 py-1.5 text-right font-mono font-semibold text-[11px]">{bsCalc.assetTotal.start.toFixed(1)}</div>
                    <div className="border-l border-[#1a6632]/40 px-2 py-1.5 text-right font-mono font-bold text-[11px] text-[#1a6632]">{bsCalc.assetTotal.end.toFixed(1)}</div>
                  </div>
                </div>
                {/* 負債・資本の部 */}
                <div>
                  <div className="grid border-b border-[#1a6632]/60" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="bg-[#1a6632]/10 px-2 py-1 text-center font-semibold text-[10px] text-[#1a6632]">科　目</div>
                    <div className="bg-[#1a6632]/10 px-1 py-1 text-center font-semibold text-[10px] text-[#1a6632] border-l border-[#1a6632]/30">期首残高</div>
                    <div className="bg-[#1a6632]/10 px-1 py-1 text-center font-semibold text-[10px] text-[#1a6632] border-l border-[#1a6632]/30">期末残高</div>
                  </div>
                  <div className="bg-[#1a6632]/8 px-2 py-0.5 text-[10px] font-semibold text-[#1a6632] border-b border-[#1a6632]/20">負　債　の　部</div>
                  {(["買掛金", "借入金", "その他負債"] as const).map((key) => (
                    <div key={key} className="grid border-b border-[#1a6632]/20 hover:bg-[#f0faf0] dark:hover:bg-[#0f2b14]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                      <div className="px-2 py-1 text-[11px]">{key}</div>
                      <div className="border-l border-[#1a6632]/30 p-0.5">
                        <input type="number" step="0.1" min="0" value={liabilities[key].start === 0 ? "" : liabilities[key].start} placeholder="0"
                          onChange={(e) => setLiability(key, "start", parseFloat(e.target.value) || 0)}
                          className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                      </div>
                      <div className="border-l border-[#1a6632]/30 p-0.5">
                        <input type="number" step="0.1" min="0" value={liabilities[key].end === 0 ? "" : liabilities[key].end} placeholder="0"
                          onChange={(e) => setLiability(key, "end", parseFloat(e.target.value) || 0)}
                          className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                      </div>
                    </div>
                  ))}
                  <div className="bg-[#1a6632]/8 px-2 py-0.5 text-[10px] font-semibold text-[#1a6632] border-b border-[#1a6632]/20">資　本　の　部</div>
                  {/* 元入金（ツールチップ付き） */}
                  <div className="grid border-b border-[#1a6632]/20 hover:bg-[#f0faf0] dark:hover:bg-[#0f2b14]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="px-2 py-1 text-[11px] flex items-center gap-1 group relative">
                      元入金
                      <span className="text-[#1a6632]/50 text-[9px] cursor-help">?</span>
                      <span className="absolute left-0 top-5 z-10 hidden group-hover:block w-56 rounded-md border border-[#1a6632]/30 bg-white dark:bg-gray-900 p-2 text-[10px] shadow-lg leading-relaxed">
                        <strong>元入金 ＝ 資本金 ＋ 繰越利益剰余金</strong>（個人事業主版）<br />
                        期末 ＝ 期首 ＋ 事業主借 − 事業主貸 ＋ 当期純利益
                      </span>
                    </div>
                    <div className="border-l border-[#1a6632]/30 p-0.5">
                      <input type="number" step="0.1" min="0" value={liabilities.元入金.start === 0 ? "" : liabilities.元入金.start} placeholder="0"
                        onChange={(e) => setLiability("元入金", "start", parseFloat(e.target.value) || 0)}
                        className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                    </div>
                    <div className="border-l border-[#1a6632]/30 p-0.5">
                      <input type="number" step="0.1" min="0" value={liabilities.元入金.end === 0 ? "" : liabilities.元入金.end} placeholder="0"
                        onChange={(e) => setLiability("元入金", "end", parseFloat(e.target.value) || 0)}
                        className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                    </div>
                  </div>
                  {/* 事業主借 */}
                  <div className="grid border-b border-[#1a6632]/20 hover:bg-[#f0faf0] dark:hover:bg-[#0f2b14]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="px-2 py-1 text-[11px]">事業主借</div>
                    <div className="border-l border-[#1a6632]/30 p-0.5">
                      <input type="number" step="0.1" min="0" value={liabilities.事業主借.start === 0 ? "" : liabilities.事業主借.start} placeholder="0"
                        onChange={(e) => setLiability("事業主借", "start", parseFloat(e.target.value) || 0)}
                        className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                    </div>
                    <div className="border-l border-[#1a6632]/30 p-0.5">
                      <input type="number" step="0.1" min="0" value={liabilities.事業主借.end === 0 ? "" : liabilities.事業主借.end} placeholder="0"
                        onChange={(e) => setLiability("事業主借", "end", parseFloat(e.target.value) || 0)}
                        className="w-full text-right bg-transparent border-none outline-none font-mono text-[11px]" />
                    </div>
                  </div>
                  {/* 負債・資本合計 */}
                  <div className="grid bg-[#edf7ed] dark:bg-[#0f2b14] border-t border-[#1a6632]" style={{ gridTemplateColumns: "1fr 80px 80px" }}>
                    <div className="px-2 py-1.5 font-bold text-[11px] text-[#1a6632]">負債・資本合計</div>
                    <div className="border-l border-[#1a6632]/40 px-2 py-1.5 text-right font-mono font-semibold text-[11px]">{bsCalc.liabTotal.start.toFixed(1)}</div>
                    <div className="border-l border-[#1a6632]/40 px-2 py-1.5 text-right font-mono font-bold text-[11px] text-[#1a6632]">{bsCalc.liabTotal.end.toFixed(1)}</div>
                  </div>
                </div>
              </div>
              {/* Balance check bar */}
              <div className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-t-2 border-[#1a6632] ${Math.abs(bsCalc.diff.end) < 0.05 ? "bg-[#edf7ed] text-[#1a6632]" : "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"}`}>
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>期末　貸借差額：<strong>{bsCalc.diff.end.toFixed(1)}万円</strong></span>
                {Math.abs(bsCalc.diff.end) < 0.05
                  ? <span>　✓ バランスが取れています</span>
                  : <span>　→ 元入金期末に当期純利益（<strong>{fmt(calc.incomeBeforeDeduction)}</strong>）を加算してください</span>}
              </div>
            </div>
            <Note>個人事業主のB/Sには「元入金」「事業主借」「事業主貸」という特殊科目があります。元入金は会社の資本金に相当し、事業主借は個人から事業への資金注入、事業主貸は事業から個人への資金引出しです。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── Section 6: 所得控除・税額目安 ── */}
      <Card>
        <SectionHeader title="6. 所得控除・税額目安" icon={<Calculator className="h-4 w-4" />} open={openSections[6]} onToggle={() => toggle(6)} formRef={{ code: "FA3000", label: "確定申告書B 第一表（所得控除欄）へ転記" }} />
        {openSections[6] && (
          <CardContent className="pt-0 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {([
                { key: "社会保険料控除", label: "社会保険料控除（国保＋国民年金）", hint: "実際に支払った額" },
                { key: "生命保険料控除", label: "生命保険料控除", hint: "最大12万円" },
                { key: "地震保険料控除", label: "地震保険料控除", hint: "最大5万円" },
                { key: "配偶者控除", label: "配偶者控除", hint: "0または38万円" },
              ] as const).map(({ key, label, hint }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground mb-0.5 block">{label}</label>
                  <NumInput value={deductions[key]} onChange={(v) => setDeductions((p) => ({ ...p, [key]: v }))} />
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground mb-0.5 block">扶養控除（人数）</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  value={deductions.扶養控除人数 === 0 ? "" : deductions.扶養控除人数}
                  placeholder="0"
                  onChange={(e) => setDeductions((p) => ({ ...p, 扶養控除人数: parseInt(e.target.value) || 0 }))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-xs text-muted-foreground">1人につき38万円控除</span>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-0.5 block">基礎控除</label>
                <div className="w-full rounded-md border border-muted bg-muted/30 px-2 py-1 text-sm text-right text-muted-foreground">
                  48万円（固定）
                </div>
              </div>
            </div>

            {/* Tax computation */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 font-semibold text-sm">税額計算</div>
              <div className="p-3 space-y-1">
                <Row label="事業所得" value={fmt(calc.businessIncome)} color="bg-emerald-50/60" />
                <Row label="－ 所得控除合計" value={fmt(calc.totalPersonalDeductions)} color="bg-red-50/60" />
                <Row label="　うち 基礎控除" value={fmt(calc.basicDeduction)} color="" />
                <Row label="＝ 課税所得" value={fmt(calc.taxableIncome)} color="bg-gray-100 border border-gray-200 font-semibold" />
                <div className="border-t mt-2 pt-2 space-y-1">
                  <Row label="所得税（超過累進税率）" value={fmt(calc.incomeTax)} color="bg-orange-50/60" />
                  <Row label="復興特別所得税（× 2.1%）" value={fmt(calc.reconstructionTax)} color="" />
                  <Row label="住民税（10%）" value={fmt(calc.residentTax)} color="" />
                  <div className="mt-2 p-3 border-2 border-orange-400 rounded-lg bg-orange-50">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-orange-800">合計税額目安</span>
                      <span className="text-2xl font-bold text-orange-700">{fmt(calc.totalTax)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tax rate reference */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">所得税速算表（参考）</p>
              <div className="grid grid-cols-3 md:grid-cols-7 gap-1">
                {[
                  { range: "〜195万", rate: "5%" },
                  { range: "〜330万", rate: "10%" },
                  { range: "〜695万", rate: "20%" },
                  { range: "〜900万", rate: "23%" },
                  { range: "〜1800万", rate: "33%" },
                  { range: "〜4000万", rate: "40%" },
                  { range: "4000万超", rate: "45%" },
                ].map(({ range, rate }) => (
                  <div key={range} className={`text-center rounded p-1.5 text-xs border ${calc.taxableIncome > 0 && TAX_BRACKETS.find((b) => calc.taxableIncome <= b.limit)?.rate === TAX_BRACKETS.find((b) => range.includes(b.limit.toString()) || (b.limit === Infinity && range.includes("超")))?.rate ? "bg-orange-100 border-orange-300 font-semibold" : "bg-muted/30"}`}>
                    <div className="text-muted-foreground">{range}</div>
                    <div className="font-bold">{rate}</div>
                  </div>
                ))}
              </div>
            </div>

            <Note>これは目安です。実際の納税額は他の所得・控除によって変わります。また、予定納税・源泉徴収なども考慮が必要です。正確な税額は税理士にご確認ください。</Note>
          </CardContent>
        )}
      </Card>

      {/* ── 書類出力・提出 ── */}
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="h-5 w-5 text-primary" />
            書類出力・提出手順
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* ステップ */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {[
              {
                step: "1",
                title: "仕訳を反映",
                desc: "仕訳帳セクションの「損益計算書に反映する」ボタンを押す",
                color: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
              },
              {
                step: "2",
                title: "元入金を確定",
                desc: `貸借対照表の元入金期末に当期純利益（${fmt(calc.incomeBeforeDeduction)}）を加算して差額をゼロにする`,
                color: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
              },
              {
                step: "3",
                title: "書類をPDF保存",
                desc: "下のボタンで損益計算書・貸借対照表を印刷（PDFに保存）",
                color: "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800",
              },
              {
                step: "4",
                title: "e-Taxで申告",
                desc: "国税庁「確定申告書等作成コーナー」でPDFの数値を入力しe-Tax送信",
                color: "bg-purple-50 border-purple-200 dark:bg-purple-950/20 dark:border-purple-800",
              },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className={`rounded-lg border p-3 ${color}`}>
                <div className="text-lg font-bold text-muted-foreground mb-1">STEP {step}</div>
                <div className="font-semibold text-sm mb-1">{title}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            ))}
          </div>

          {/* 出力ボタン */}
          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <button onClick={printPL}
              className="flex items-center gap-2 rounded-md bg-blue-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-blue-700 shadow-sm">
              <Printer className="h-4 w-4" />損益計算書を印刷／PDF保存
            </button>
            <button onClick={printBS}
              className="flex items-center gap-2 rounded-md bg-emerald-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-700 shadow-sm">
              <Printer className="h-4 w-4" />貸借対照表を印刷／PDF保存
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>e-Taxへの直接送信は非対応です。PDFの数値を確定申告書等作成コーナーへ手入力してください。</span>
            </div>
          </div>

          {/* 貸借チェック */}
          {Math.abs(bsCalc.diff.end) >= 0.05 && (
            <div className="flex items-center gap-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-2 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              貸借対照表の差額が {fmt(Math.abs(bsCalc.diff.end))} あります。出力前に元入金期末を調整してバランスさせてください。
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer disclaimer */}
      <div className="text-xs text-muted-foreground text-center py-4 border-t">
        本ツールは参考情報の提供を目的としており、税務申告の正確性を保証するものではありません。
        実際の申告は税理士または最新の国税庁資料をご確認ください。　{year}年分（令和{year - 2018}年分）| 青色申告対応
      </div>
    </div>
  );
}
