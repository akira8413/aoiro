# aoiro API

`APP_SECRET` を設定している場合、API は共通の合言葉で保護されます。

```bash
Authorization: Bearer <APP_SECRET>
```

## 仕訳一覧

```bash
curl -H "Authorization: Bearer $APP_SECRET" https://example.com/api/aoiro/transactions
```

## 仕訳追加

単発:

```bash
curl -X POST https://example.com/api/aoiro/transactions \
  -H "Authorization: Bearer $APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-07-05",
    "description": "サーバー代",
    "debitAccount": "通信費",
    "debitAmount": 3300,
    "creditAccount": "普通預金",
    "creditAmount": 3300,
    "taxCategory": "課税",
    "taxRate": 10,
    "taxStyle": "内税"
  }'
```

バッチ:

```bash
curl -X POST https://example.com/api/aoiro/transactions \
  -H "Authorization: Bearer $APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "date": "2026-07-05",
      "description": "クラウド利用料",
      "debitAccount": "通信費",
      "debitAmount": 2200,
      "creditAccount": "普通預金",
      "creditAmount": 2200
    },
    {
      "date": "2026-07-05",
      "description": "書籍",
      "debitAccount": "消耗品費",
      "debitAmount": 1980,
      "creditAccount": "普通預金",
      "creditAmount": 1980
    }
  ]'
```

## 必須フィールド

| field | type | note |
|---|---|---|
| `date` | string | `YYYY-MM-DD` |
| `description` | string | 摘要 |
| `debitAccount` | string | 借方勘定科目 |
| `debitAmount` | integer | 円。正の整数 |
| `creditAccount` | string | 貸方勘定科目 |
| `creditAmount` | integer | 円。正の整数。省略時は借方金額と同額 |

借方金額と貸方金額が一致しない場合は 400 で弾きます。

## 任意フィールド

| field | type | note |
|---|---|---|
| `fileName` | string | 証憑ファイル名 |
| `fileData` | string | base64/data URL |
| `source` | string | 外部連携元。Notion取込は `notion` |
| `sourceId` | string | 冪等キー。`source + sourceId` は一意 |
| `taxCategory` | string | `課税` / `非課税` / `対象外` |
| `taxRate` | integer | 例: `10` |
| `taxStyle` | string | `税抜` / `内税` |

## 勘定科目

資産: `現金`, `普通預金`, `売掛金`, `棚卸資産`, `固定資産`, `事業主貸`

負債: `買掛金`, `借入金`, `未払金`, `事業主借`

資本: `元入金`

収益: `売上`

費用: `仕入`, `給料賃金`, `外注工賃`, `減価償却費`, `地代家賃`, `水道光熱費`, `通信費`, `旅費交通費`, `広告宣伝費`, `接待交際費`, `消耗品費`, `租税公課`, `損害保険料`, `修繕費`, `荷造運賃`, `利子割引料`, `福利厚生費`, `貸倒金`, `雑費`, `その他経費`

## Notion 請求取込

プレビュー:

```bash
curl -H "Authorization: Bearer $APP_SECRET" \
  "https://example.com/api/aoiro/notion?year=2026"
```

確定取込:

```bash
curl -X POST https://example.com/api/aoiro/notion \
  -H "Authorization: Bearer $APP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"year":2026}'
```

売上計上は `売掛金 / 売上`、入金消し込みは `普通預金 / 売掛金` で作成されます。
