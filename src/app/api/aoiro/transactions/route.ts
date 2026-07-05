import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aoiroTransactions } from "@/lib/db/schema";
import { isKnownAccount, TAX_CATEGORIES, TAX_STYLES } from "@/lib/aoiro/accounts";
import { isAuthorized, unauthorizedJson } from "@/lib/aoiro/auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TransactionInput = {
  date: unknown;
  description?: unknown;
  debitAccount: unknown;
  debitAmount: unknown;
  creditAccount: unknown;
  creditAmount?: unknown;
  fileName?: unknown;
  fileData?: unknown;
  source?: unknown;
  sourceId?: unknown;
  taxCategory?: unknown;
  taxRate?: unknown;
  taxStyle?: unknown;
};

function positiveInteger(value: unknown, field: string) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${field} must be a positive integer yen amount`);
  }
  return n;
}

function nullableString(value: unknown, field: string) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function isRealDateString(value: string) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validate(input: TransactionInput) {
  if (typeof input.date !== "string" || !isRealDateString(input.date)) {
    throw new Error("date must be a real YYYY-MM-DD date");
  }
  if (!isKnownAccount(input.debitAccount)) {
    throw new Error(`unknown debitAccount: ${String(input.debitAccount)}`);
  }
  if (!isKnownAccount(input.creditAccount)) {
    throw new Error(`unknown creditAccount: ${String(input.creditAccount)}`);
  }

  const debitAmount = positiveInteger(input.debitAmount, "debitAmount");
  const creditAmount = input.creditAmount == null
    ? debitAmount
    : positiveInteger(input.creditAmount, "creditAmount");
  if (debitAmount !== creditAmount) {
    throw new Error("debitAmount and creditAmount must be equal");
  }

  const taxCategory = nullableString(input.taxCategory, "taxCategory");
  if (taxCategory && !TAX_CATEGORIES.includes(taxCategory as never)) {
    throw new Error(`taxCategory must be one of: ${TAX_CATEGORIES.join(", ")}`);
  }

  const taxStyle = nullableString(input.taxStyle, "taxStyle");
  if (taxStyle && !TAX_STYLES.includes(taxStyle as never)) {
    throw new Error(`taxStyle must be one of: ${TAX_STYLES.join(", ")}`);
  }

  const taxRate = input.taxRate == null ? null : Number(input.taxRate);
  if (taxRate != null && (!Number.isInteger(taxRate) || taxRate < 0)) {
    throw new Error("taxRate must be a non-negative integer");
  }

  return {
    date: input.date,
    description: typeof input.description === "string" ? input.description : "",
    debitAccount: input.debitAccount,
    debitAmount,
    creditAccount: input.creditAccount,
    creditAmount,
    fileName: nullableString(input.fileName, "fileName"),
    fileData: nullableString(input.fileData, "fileData"),
    source: nullableString(input.source, "source"),
    sourceId: nullableString(input.sourceId, "sourceId"),
    taxCategory,
    taxRate,
    taxStyle,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  const rows = await db.select().from(aoiroTransactions).orderBy(aoiroTransactions.date);
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const body = await req.json();
    const inputs = Array.isArray(body) ? body : [body];
    const values = inputs.map(validate);

    const inserted = await db.transaction(async (tx) => {
      const rows = [];
      for (const value of values) {
        if (value.source && value.sourceId) {
          const existing = await tx
            .select()
            .from(aoiroTransactions)
            .where(and(eq(aoiroTransactions.source, value.source), eq(aoiroTransactions.sourceId, value.sourceId)))
            .limit(1);
          if (existing[0]) {
            rows.push(existing[0]);
            continue;
          }
        }
        const row = await tx
          .insert(aoiroTransactions)
          .values(value)
          .onConflictDoNothing()
          .returning();
        if (row[0]) {
          rows.push(row[0]);
        } else if (value.source && value.sourceId) {
          const existing = await tx
            .select()
            .from(aoiroTransactions)
            .where(and(eq(aoiroTransactions.source, value.source), eq(aoiroTransactions.sourceId, value.sourceId)))
            .limit(1);
          if (existing[0]) rows.push(existing[0]);
        }
      }
      return rows;
    });

    return NextResponse.json(Array.isArray(body) ? inserted : inserted[0]);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const current = await db.select().from(aoiroTransactions).where(eq(aoiroTransactions.id, id)).limit(1);
    if (!current[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

    const merged = validate({
      ...current[0],
      ...body,
    });

    const updated = await db
      .update(aoiroTransactions)
      .set({
        ...merged,
        fileName: body.fileName === undefined ? current[0].fileName : merged.fileName,
        fileData: body.fileData === undefined ? current[0].fileData : merged.fileData,
      })
      .where(eq(aoiroTransactions.id, id))
      .returning();
    return NextResponse.json(updated[0]);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  const { id, source, sourceId } = await req.json();
  const numericId = Number(id);
  if (Number.isInteger(numericId) && numericId > 0) {
    await db.delete(aoiroTransactions).where(eq(aoiroTransactions.id, numericId));
  } else if (source && sourceId) {
    await db
      .delete(aoiroTransactions)
      .where(and(eq(aoiroTransactions.source, source), eq(aoiroTransactions.sourceId, sourceId)));
  } else {
    return NextResponse.json({ error: "missing id or source/sourceId" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
