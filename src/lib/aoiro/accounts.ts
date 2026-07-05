export const ACCOUNTS = {
  資産: ["現金", "普通預金", "売掛金", "棚卸資産", "固定資産", "事業主貸"],
  負債: ["買掛金", "借入金", "未払金", "事業主借"],
  資本: ["元入金"],
  収益: ["売上"],
  費用: [
    "仕入",
    "給料賃金",
    "外注工賃",
    "減価償却費",
    "地代家賃",
    "水道光熱費",
    "通信費",
    "旅費交通費",
    "広告宣伝費",
    "接待交際費",
    "消耗品費",
    "租税公課",
    "損害保険料",
    "修繕費",
    "荷造運賃",
    "利子割引料",
    "福利厚生費",
    "貸倒金",
    "雑費",
    "その他経費",
  ],
} as const;

export const ALL_ACCOUNTS = Object.values(ACCOUNTS).flat();

export function isKnownAccount(account: unknown): account is string {
  return typeof account === "string" && (ALL_ACCOUNTS as readonly string[]).includes(account);
}

export type TaxCategory = "課税" | "非課税" | "対象外";
export type TaxStyle = "税抜" | "内税";

export const TAX_CATEGORIES: TaxCategory[] = ["課税", "非課税", "対象外"];
export const TAX_STYLES: TaxStyle[] = ["税抜", "内税"];
