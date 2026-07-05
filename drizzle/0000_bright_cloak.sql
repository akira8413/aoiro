CREATE TABLE "aoiro_business_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"trade_name" text DEFAULT '' NOT NULL,
	"business_type" text DEFAULT '' NOT NULL,
	"deduction_type" text DEFAULT '65' NOT NULL,
	"inventory_start_yen" integer DEFAULT 0 NOT NULL,
	"inventory_end_yen" integer DEFAULT 0 NOT NULL,
	"pl_date_from" text DEFAULT '1' NOT NULL,
	"pl_date_to" text DEFAULT '12' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aoiro_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"social_insurance_yen" integer DEFAULT 0 NOT NULL,
	"life_insurance_yen" integer DEFAULT 0 NOT NULL,
	"earthquake_insurance_yen" integer DEFAULT 0 NOT NULL,
	"spouse_deduction_yen" integer DEFAULT 0 NOT NULL,
	"dependent_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aoiro_fixed_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"acquired_year" integer NOT NULL,
	"acquisition_cost_yen" integer NOT NULL,
	"useful_life" integer NOT NULL,
	"method" text NOT NULL,
	"business_ratio" integer NOT NULL,
	"book_value_start_yen" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aoiro_opening_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"account_type" text NOT NULL,
	"account" text NOT NULL,
	"start_amount_yen" integer DEFAULT 0 NOT NULL,
	"end_amount_yen" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aoiro_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"debit_account" text NOT NULL,
	"debit_amount" integer NOT NULL,
	"credit_account" text NOT NULL,
	"credit_amount" integer NOT NULL,
	"file_name" text,
	"file_data" text,
	"source" text,
	"source_id" text,
	"tax_category" text,
	"tax_rate" integer,
	"tax_style" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "aoiro_business_settings_year_idx" ON "aoiro_business_settings" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "aoiro_deductions_year_idx" ON "aoiro_deductions" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "aoiro_opening_balances_year_account_idx" ON "aoiro_opening_balances" USING btree ("year","account_type","account");--> statement-breakpoint
CREATE UNIQUE INDEX "aoiro_transactions_source_id_idx" ON "aoiro_transactions" USING btree ("source","source_id");