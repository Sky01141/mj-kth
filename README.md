# 雀華 オンライン麻雀

サーバー権威型の4人打ちオンライン対戦。牌山・配牌・和了判定はすべて `server.js` が行い、各プレイヤーには自分の手牌だけを送ります。

## 構成
- `server.js` … Node.js + ws。静的配信(`public/`)とWebSocket(`/ws`)を兼ねる
- `public/index.html` … 3D描画・演出・UI（CPU対戦もここで動作）
- `public/online.js` … オンライン対戦の通信レイヤー
- `public/config.js` … GitHub Pages用のサーバーURL設定

## ローカル起動
    npm install && npm start   # http://localhost:3000

## Renderにデプロイ
1. このフォルダをGitHubリポジトリにpush
2. Render → New → Blueprint（または Web Service）でリポジトリを選択。`render.yaml` が使われます
3. 発行されたURL（例 `https://jansou-mahjong.onrender.com`）を開けば、そのまま遊べます
   - 無料プランは放置すると停止し、初回接続に約1分かかります

## GitHub Pagesで公開（クライアントのみ）
1. `public/config.js` の `MAHJONG_WS` を `wss://（RenderのURL）/ws` にしてpush
2. リポジトリ Settings → Pages → Source を「GitHub Actions」にする
3. 必要なら Render の環境変数 `ALLOWED_ORIGINS` に `https://ユーザー名.github.io` を設定（空なら全許可）

## 遊び方
オンライン対戦 → ルーム作成 → 表示された4文字のコードを友達に共有 → ホストが開始。空席はCPUが入ります。
切断してもトークンで同じ席に再接続でき、盤面が復元されます（再接続中はツモ切りで進行）。持ち時間は25秒（超過でツモ切り）。

## 現在の制限
役は立直・ツモ・断么九・七対子・ドラのみ。点数計算、チー・ポン・カン、フリテン、半荘進行は未実装です。CPUは牌をランダムに切り、ツモ和了だけ行います。
