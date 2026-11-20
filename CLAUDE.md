# スプラッシュ・アイル（splash-isle）

水を噴射して島を掃除する、ブラウザで遊べる 3D アクション。Three.js + Vite + TypeScript、配信と API は Cloudflare Workers + D1、ログインは Google。

## 守ること

- **他社の権利物を持ち込まない。** 任天堂などのキャラクター・名称・デザイン・音楽・素材は使わない。まねるのは遊びの仕組みと構造だけで、名前や見た目は必ずオリジナルにする。
- **素材はすべてコードで生成する。** 画像・3D モデル・音声のファイルを追加しない（地形・建物・キャラクター・効果音・BGM まで手続き的に作っている）。
- **解像度の下限を下げない。** `src/engine/renderer.ts` の `MIN_PIXELS`（1280×720 相当）はどの品質設定でも保つ。
- **高性能な GPU がなくても動くこと。** 追加した表現は「低」設定で切れるようにし、ドローコールと三角形数を増やしすぎない（町の初期視点で 高 約 126 万 / 中 約 85 万 / 低 約 57 万 三角形、ドローコール約 290 が現状の目安）。
- **秘密の値をコミットしない。** `.dev.vars` と `.secrets.env` は Git 管理外。`GOOGLE_CLIENT_ID` と D1 の `database_id` は公開してよい値。
- 物理エンジンは入れない。当たり判定は `src/world/colliders.ts` の自前実装。

## コマンド

```bash
npm run dev            # ゲームだけ（API なし・ゲスト）http://localhost:5173
npm run preview        # ビルドして Worker + D1 ごと起動 http://localhost:8787
npm run build          # 型チェック（ゲーム・Worker）+ Vite ビルド
npm run types          # wrangler.jsonc を変えたら worker-configuration.d.ts を作り直す
npm run test:worker    # API と Google ログインの結合テスト（Miniflare、Google だけ偽物）
npm run test:game      # 全 14 個のヒカリ石を取りきる通しテスト（要 Chrome、先に vite preview --port 4173）
npm run test:reach     # 全エリアの足場・間欠泉・橋が通れるかの検証（同上）
```

変更したら `npm run build` と、触った範囲のテストを必ず通す。ステージの地形や足場を変えたら `test:reach` を、進行やセーブを変えたら `test:game` を、`worker/` を変えたら `test:worker` を回す。
見た目の変更は `node scripts/shot.mjs` でスクリーンショットを撮って目で確かめる（`?debug` を付けると `window.__splash` から状態を操作できる）。

## 構成

- `src/main.ts` … 起動、進行（エリア移動・ミッション・セーブ）、メインループ
- `src/engine/` … renderer（品質 3 段階と動的解像度）, input, audio, noise
- `src/world/` … terrain（`TerrainDef` で地形を差し替え）, water, sky, goop（スミ）, colliders, `area.ts`（エリア共通の部品）, `areas/town.ts`（町）, `areas/stages.ts`（3 エリア × 3 ステージ）
- `src/game/` … player, camera, particles, collectibles, enemies, npc, portals, hud, state（セーブの形）
- `worker/` … index（ルーティング）, auth（Google OAuth + PKCE）, session, save（検証）, http
- `migrations/` … D1 のスキーマ（変更は新しい連番ファイルを足す。既存ファイルは書き換えない）

## セーブを変えるとき

`src/game/state.ts` の `SaveData` と `worker/save.ts` の `parseSave` は対になっている。片方だけ変えるとサーバーが保存を拒否する。ヒカリ石の ID は 町 0–4 / ゆけむり山 5–7 / サンゴ入り江 8–10 / そよかぜ台地 11–13（増やすときは `GEM_COUNT`・`ALL_GEMS`・`GEMS_ALL` をそろえる）。

## Issue の進め方

- `epic` ラベル … Claude Code でまとめて実装する単位。1 つの Epic は 1 本以上の PR に分けてよい。
- `manual` ラベル … 管理画面の操作や実機確認など、人が行う作業。Claude Code からは実行しない。
