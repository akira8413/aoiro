import { integer, serial, text, timestamp, uniqueIndex, pgTable } from "drizzle-orm/pg-core";

export const aoiroTransactions = pgTable(
  "aoiro_transactions",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),
    description: text("description").notNull().default(""),
    debitAccount: text("debit_account").notNull(),
    debitAmount: integer("debit_amount").notNull(),
    creditAccount: text("credit_account").notNull(),
    creditAmount: integer("credit_amount").notNull(),
    fileName: text("file_name"),
    fileData: text("file_data"),
    source: text("source"),
    sourceId: text("source_id"),
    taxCategory: text("tax_category"),
    taxRate: integer("tax_rate"),
    taxStyle: text("tax_style"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("aoiro_transactions_source_id_idx").on(table.source, table.sourceId)],
);

export const aoiroFixedAssets = pgTable("aoiro_fixed_assets", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  name: text("name").notNull(),
  acquiredYear: integer("acquired_year").notNull(),
  acquisitionCostYen: integer("acquisition_cost_yen").notNull(),
  usefulLife: integer("useful_life").notNull(),
  method: text("method").notNull(),
  businessRatio: integer("business_ratio").notNull(),
  bookValueStartYen: integer("book_value_start_yen").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aoiroDeductions = pgTable(
  "aoiro_deductions",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    socialInsuranceYen: integer("social_insurance_yen").notNull().default(0),
    lifeInsuranceYen: integer("life_insurance_yen").notNull().default(0),
    earthquakeInsuranceYen: integer("earthquake_insurance_yen").notNull().default(0),
    spouseDeductionYen: integer("spouse_deduction_yen").notNull().default(0),
    dependentCount: integer("dependent_count").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("aoiro_deductions_year_idx").on(table.year)],
);

export const aoiroOpeningBalances = pgTable(
  "aoiro_opening_balances",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    accountType: text("account_type").notNull(),
    account: text("account").notNull(),
    startAmountYen: integer("start_amount_yen").notNull().default(0),
    endAmountYen: integer("end_amount_yen").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("aoiro_opening_balances_year_account_idx").on(table.year, table.accountType, table.account)],
);

export const aoiroBusinessSettings = pgTable(
  "aoiro_business_settings",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    tradeName: text("trade_name").notNull().default(""),
    businessType: text("business_type").notNull().default(""),
    deductionType: text("deduction_type").notNull().default("65"),
    inventoryStartYen: integer("inventory_start_yen").notNull().default(0),
    inventoryEndYen: integer("inventory_end_yen").notNull().default(0),
    plDateFrom: text("pl_date_from").notNull().default("1"),
    plDateTo: text("pl_date_to").notNull().default("12"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("aoiro_business_settings_year_idx").on(table.year)],
);
