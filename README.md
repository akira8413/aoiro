# aoiro

青色申告向けの複式簿記・帳簿アプリです。`realestate-analyzer` から切り出した独立アプリで、仕訳帳、PL/BS、固定資産、控除、期首残高、Notion請求取込を扱います。

## セットアップ

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

開発サーバーは `http://localhost:3100` です。

## 環境変数

| name | required | note |
|---|---|---|
| `DATABASE_URL` | yes | aoiro専用Postgres |
| `APP_SECRET` | yes | 画面とAPI共通の合言葉。未設定時は503で停止 |
| `NOTION_TOKEN` | Notion取込時 | cc-companyの月次工数記録DBを読む |

## 実装済み

- `/` に青色申告アプリを配置
- `APP_SECRET` による画面/API保護
- 仕訳CRUD、バッチPOST、勘定科目/金額/日付バリデーション
- `source` / `source_id` による冪等取込
- 税区分フィールドの器
- 固定資産、控除、期首/期末残高、事業設定の年度別保存
- Notionの発行済請求から売上仕訳、入金日から入金消し込み仕訳を取込

## 注意

本ツールは参考資料です。申告前に税理士または最新の国税庁資料を確認してください。e-Tax XML出力と消費税の本格計算は未実装です。
