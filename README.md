# yt-filler — YouTube 概要欄フィラー

指定フォーマットの `.txt` を読み込み、**YouTube Studio** のアップロード/編集画面でタイトル・概要欄・タグを自動入力する Tampermonkey ユーザースクリプトです。チャンネル非依存の汎用ツール。

## インストール

Tampermonkey を入れた状態で、次のリンクを開くとインストール画面が出ます：

**▶ [yt-filler.user.js をインストール](https://raw.githubusercontent.com/hwiiza/yt-filler/main/yt-filler.user.js)**

> 更新は Tampermonkey が `@updateURL` を見て自動チェックします（手動なら Tampermonkey ダッシュボード →「ユーティリティ」/各スクリプトの「更新を確認」）。

## 使い方

1. YouTube Studio で動画の **アップロード**ダイアログ、または **詳細編集**画面を開く
2. 右下に出る赤いパネル **「🔴 yt-filler」** で：
   - **① txtを読込** … 下記フォーマットの `.txt` を選択
   - **② サムネ画像(任意)** … サムネに使う画像を選択（ディスクのパスは指定できないため、ここで画像を選ぶ＝ブラウザの仕様上の制約回避）
   - **タイトル / 概要欄 / タグ / サムネ / 子供向けでない / 全部設定** … 各項目を自動入力
3. タグは「すべて表示」を押してタグ欄を表示してから実行し、反映を目視確認してください
4. 「子供向けでない」＝対象視聴者の「いいえ、子ども向けではありません」を選択。「サムネ」＝②で選んだ画像をサムネ欄へ流し込み
5. **全部設定** はタイトル→概要欄→タグ→子供向けでない→（②があれば）サムネ を順に実行

読み込んだ内容は保存され（GM storage）、次回パネル起動時に復元されます。

## 入力する .txt のフォーマット

`====` で囲んだ見出しでセクションを区切ります。`TITLE` / `DESCRIPTION` / `TAGS` を使用（`CHANNEL NAME` / `NOTES` 等は無視）。

```
==================== TITLE ====================
Deep House Mix 2026 | Raven & Midnight Wings (Hypnotic Groove)

==================== DESCRIPTION ====================
（概要欄の本文。改行・トラックリスト・ハッシュタグ等そのまま）

==================== TAGS (comma-separated, 10) ====================
tag one, tag two, tag three, ...
```

- 文字コードは **UTF-8**（BOM は自動除去）。
- `TAGS` はカンマ区切り。

## 技術メモ

- タイトル/概要欄は contenteditable へ `execCommand('insertText')` で投入（Polymer の `input` を発火）。
- **YouTube Studio は Trusted Types を強制**するため、UI は `innerHTML` を使わず `createElement` で構築している（`innerHTML` 代入は例外になる）。
- SPA 対策として冪等な `init()` を `setInterval` で再注入。

## ライセンス

MIT © hwiiza
