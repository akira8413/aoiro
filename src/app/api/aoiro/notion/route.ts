import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aoiroTransactions } from "@/lib/db/schema";
import { isAuthorized, unauthorizedJson } from "@/lib/aoiro/auth";

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const DATA_SOURCE_ID = "3535c098-e329-8013-a635-000b7c298a62";

type PlannedEntry = {
  source: "notion";
  sourceId: string;
  date: string;
  description: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  kind: "sale" | "paid";
};

function richText(prop: { rich_text?: { plain_text?: string }[] } | undefined) {
  return (prop?.rich_text || []).map((t) => t.plain_text || "").join("");
}

function selectName(prop: { select?: { name?: string } } | undefined) {
  return prop?.select?.name || "";
}

type NotionProperty = {
  date?: { start?: string };
  rich_text?: { plain_text?: string }[];
  title?: { plain_text?: string }[];
  select?: { name?: string };
  status?: { name?: string };
  number?: number;
};

type NotionPage = {
  id: string;
  properties: Record<string, NotionProperty>;
};

function dateStart(prop: { date?: { start?: string } } | undefined) {
  return prop?.date?.start || "";
}

function titleText(prop: { title?: { plain_text?: string }[] } | undefined) {
  return (prop?.title || []).map((t) => t.plain_text || "").join("");
}

function ymFromPeriod(prop: { date?: { start?: string } } | undefined) {
  const start = prop?.date?.start;
  return start ? start.slice(0, 7) : "";
}

async function fetchNotionRecords(year: number) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
  const filter = {
    or: [
      {
        and: [
          { property: "発行日", date: { on_or_after: `${year}-01-01` } },
          { property: "発行日", date: { on_or_before: `${year}-12-31` } },
        ],
      },
      {
        and: [
          { property: "入金日", date: { on_or_after: `${year}-01-01` } },
          { property: "入金日", date: { on_or_before: `${year}-12-31` } },
        ],
      },
    ],
  };

  const results: NotionPage[] = [];
  let startCursor: string | undefined;
  do {
    const res = await fetch(`${NOTION}/data_sources/${DATA_SOURCE_ID}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        page_size: 100,
        filter,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion query failed (${res.status})`);
    const json = await res.json();
    results.push(...(json.results as NotionPage[]));
    startCursor = json.has_more ? json.next_cursor : undefined;
  } while (startCursor);

  return results;
}

async function planEntries(year: number) {
  const rows = await fetchNotionRecords(year);
  const plans: PlannedEntry[] = [];

  for (const page of rows) {
    const props = page.properties;
    const status = props["ステータス"]?.status?.name || "";
    if (!["発行済", "入金済", "アーカイブ済"].includes(status)) continue;

    const issuedAt = dateStart(props["発行日"]);
    const paidAt = dateStart(props["入金日"]);
    const amount = Number(props["請求金額"]?.number || 0);
    if (!issuedAt || amount <= 0) continue;

    const client = selectName(props["クライアント"]) || titleText(props["Name"]) || "取引先";
    const period = ymFromPeriod(props["対象期間"]);
    const project = richText(props["案件"]);
    const suffix = [period && `${period} 請求`, project].filter(Boolean).join(" / ");

    if (issuedAt.slice(0, 4) === String(year)) {
      plans.push({
        source: "notion",
        sourceId: `${page.id}:sale`,
        kind: "sale",
        date: issuedAt,
        description: `${client} ${suffix}`.trim(),
        debitAccount: "売掛金",
        debitAmount: amount,
        creditAccount: "売上",
        creditAmount: amount,
      });
    }

    if (paidAt && paidAt.slice(0, 4) === String(year)) {
      plans.push({
        source: "notion",
        sourceId: `${page.id}:paid`,
        kind: "paid",
        date: paidAt,
        description: `${client} 入金`.trim(),
        debitAccount: "普通預金",
        debitAmount: amount,
        creditAccount: "売掛金",
        creditAmount: amount,
      });
    }
  }

  const fresh: PlannedEntry[] = [];
  for (const plan of plans) {
    const existing = await db
      .select({ id: aoiroTransactions.id })
      .from(aoiroTransactions)
      .where(and(eq(aoiroTransactions.source, plan.source), eq(aoiroTransactions.sourceId, plan.sourceId)))
      .limit(1);
    if (!existing.length) fresh.push(plan);
  }

  return {
    entries: fresh,
    skipped: plans.length - fresh.length,
    saleCount: fresh.filter((e) => e.kind === "sale").length,
    paidCount: fresh.filter((e) => e.kind === "paid").length,
    saleTotal: fresh.filter((e) => e.kind === "sale").reduce((sum, e) => sum + e.debitAmount, 0),
    paidTotal: fresh.filter((e) => e.kind === "paid").reduce((sum, e) => sum + e.debitAmount, 0),
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();
    const result = await planEntries(year);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const body = await req.json().catch(() => ({}));
    const year = Number(body.year) || new Date().getFullYear();
    const result = await planEntries(year);
    if (result.entries.length) {
      await db.insert(aoiroTransactions).values(result.entries).onConflictDoNothing();
    }
    return NextResponse.json({ ...result, imported: result.entries.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}
