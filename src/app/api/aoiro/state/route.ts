import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aoiroBusinessSettings,
  aoiroDeductions,
  aoiroFixedAssets,
  aoiroOpeningBalances,
} from "@/lib/db/schema";
import { isAuthorized, unauthorizedJson } from "@/lib/aoiro/auth";

const yenToMan = (yen: number | null | undefined) => Math.round(((yen ?? 0) / 10000) * 10) / 10;
const manToYen = (man: unknown) => Math.round((Number(man) || 0) * 10000);

function parseYear(url: string) {
  const year = Number(new URL(url).searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("year must be a valid integer");
  }
  return year;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const year = parseYear(req.url);
    const [settings] = await db.select().from(aoiroBusinessSettings).where(eq(aoiroBusinessSettings.year, year));
    const [deductions] = await db.select().from(aoiroDeductions).where(eq(aoiroDeductions.year, year));
    const fixedAssets = await db.select().from(aoiroFixedAssets).where(eq(aoiroFixedAssets.year, year));
    const balances = await db.select().from(aoiroOpeningBalances).where(eq(aoiroOpeningBalances.year, year));

    return NextResponse.json({
      businessSettings: settings
        ? {
            tradeName: settings.tradeName,
            businessType: settings.businessType,
            deductionType: settings.deductionType,
            inventoryStart: yenToMan(settings.inventoryStartYen),
            inventoryEnd: yenToMan(settings.inventoryEndYen),
            plDateFrom: settings.plDateFrom,
            plDateTo: settings.plDateTo,
          }
        : null,
      deductions: deductions
        ? {
            社会保険料控除: yenToMan(deductions.socialInsuranceYen),
            生命保険料控除: yenToMan(deductions.lifeInsuranceYen),
            地震保険料控除: yenToMan(deductions.earthquakeInsuranceYen),
            配偶者控除: yenToMan(deductions.spouseDeductionYen),
            扶養控除人数: deductions.dependentCount,
          }
        : null,
      fixedAssets: fixedAssets.map((a) => ({
        id: String(a.id),
        name: a.name,
        acquiredYear: a.acquiredYear,
        acquisitionCost: yenToMan(a.acquisitionCostYen),
        usefulLife: a.usefulLife,
        method: a.method,
        businessRatio: a.businessRatio,
        bookValueStart: yenToMan(a.bookValueStartYen),
      })),
      openingBalances: balances.map((b) => ({
        accountType: b.accountType,
        account: b.account,
        start: yenToMan(b.startAmountYen),
        end: yenToMan(b.endAmountYen),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) return unauthorizedJson();
  try {
    const year = parseYear(req.url);
    const body = await req.json();
    const settings = body.businessSettings || {};
    const deductions = body.deductions || {};
    const fixedAssets = Array.isArray(body.fixedAssets) ? body.fixedAssets : [];
    const balances = Array.isArray(body.openingBalances) ? body.openingBalances : [];

    await db.transaction(async (tx) => {
      await tx
        .insert(aoiroBusinessSettings)
        .values({
          year,
          tradeName: String(settings.tradeName || ""),
          businessType: String(settings.businessType || ""),
          deductionType: String(settings.deductionType || "65"),
          inventoryStartYen: manToYen(settings.inventoryStart),
          inventoryEndYen: manToYen(settings.inventoryEnd),
          plDateFrom: String(settings.plDateFrom || "1"),
          plDateTo: String(settings.plDateTo || "12"),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aoiroBusinessSettings.year,
          set: {
            tradeName: String(settings.tradeName || ""),
            businessType: String(settings.businessType || ""),
            deductionType: String(settings.deductionType || "65"),
            inventoryStartYen: manToYen(settings.inventoryStart),
            inventoryEndYen: manToYen(settings.inventoryEnd),
            plDateFrom: String(settings.plDateFrom || "1"),
            plDateTo: String(settings.plDateTo || "12"),
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(aoiroDeductions)
        .values({
          year,
          socialInsuranceYen: manToYen(deductions.社会保険料控除),
          lifeInsuranceYen: manToYen(deductions.生命保険料控除),
          earthquakeInsuranceYen: manToYen(deductions.地震保険料控除),
          spouseDeductionYen: manToYen(deductions.配偶者控除),
          dependentCount: Number(deductions.扶養控除人数) || 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: aoiroDeductions.year,
          set: {
            socialInsuranceYen: manToYen(deductions.社会保険料控除),
            lifeInsuranceYen: manToYen(deductions.生命保険料控除),
            earthquakeInsuranceYen: manToYen(deductions.地震保険料控除),
            spouseDeductionYen: manToYen(deductions.配偶者控除),
            dependentCount: Number(deductions.扶養控除人数) || 0,
            updatedAt: new Date(),
          },
        });

      await tx.delete(aoiroFixedAssets).where(eq(aoiroFixedAssets.year, year));
      if (fixedAssets.length) {
        await tx.insert(aoiroFixedAssets).values(
          fixedAssets.map((a: Record<string, unknown>) => ({
            year,
            name: String(a.name || ""),
            acquiredYear: Number(a.acquiredYear) || year,
            acquisitionCostYen: manToYen(a.acquisitionCost),
            usefulLife: Number(a.usefulLife) || 1,
            method: String(a.method || "定額法"),
            businessRatio: Number(a.businessRatio) || 100,
            bookValueStartYen: manToYen(a.bookValueStart),
          })),
        );
      }

      await tx.delete(aoiroOpeningBalances).where(eq(aoiroOpeningBalances.year, year));
      if (balances.length) {
        await tx.insert(aoiroOpeningBalances).values(
          balances.map((b: Record<string, unknown>) => ({
            year,
            accountType: String(b.accountType || ""),
            account: String(b.account || ""),
            startAmountYen: manToYen(b.start),
            endAmountYen: manToYen(b.end),
            updatedAt: new Date(),
          })),
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid request" }, { status: 400 });
  }
}
