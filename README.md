# 株・指数の下落通知フロントエンド

登録した株・指数の監視状態と、LINEへ通知する共通の下落率を管理する単一管理者向けReactアプリです。

仕様の正本は[仕様書リポジトリ](https://github.com/hisho-123/stock_notification_docs)のOpenAPI・画面仕様です。[バックエンド](https://github.com/hisho-123/stock_notification_backend)のGo API `/api/v1`と接続します。画面は仕様書のHTML見本を踏襲しています。

## 構成

React 19・TypeScript・Vite・React Routerを使用します。依存関係は`package-lock.json`で固定し、Node.js 24 LTSとnpmで開発します。

| URL                       | 機能                                           |
| ------------------------- | ---------------------------------------------- |
| `/login`                  | セッション確認、管理者ログイン、試行制限の待機 |
| `/assets`                 | 監視対象の追加・検索・ソート・停止・再開・削除 |
| `/settings/notifications` | 共通通知率の編集・保存、未保存変更の破棄確認   |

`/`は一覧、`/settings`は通知設定へ遷移します。価格取得・通知判定・LINE送信はバックエンドの責務です。一覧更新・監視再開・設定保存で即時の価格取得やLINE送信は行いません。

| ディレクトリ                           | 内容                                        |
| -------------------------------------- | ------------------------------------------- |
| `src/pages/`                           | 3画面と画面テスト                           |
| `src/api.ts`・`src/types.ts`           | APIクライアント・OpenAPIに対応する型        |
| `src/auth.tsx`・`src/router.tsx`       | セッション・ルーティング・認証保護          |
| `src/components.tsx`・`src/styles.css` | 共通部品とHTML見本に基づくスタイル          |
| `tests/`                               | テストデータ・ブラウザテスト・専用APIスタブ |

## macOSの開発環境構築

Homebrew導入済みのmacOSを前提とします。以下はフロントエンドのリポジトリ直下で実行します。バックエンドとDBは既存環境を使用します。

### 1. Node.js 24 LTSとnpmを導入

```sh
brew install node@24
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
npm --version
```

新しいターミナルでも利用するには、`~/.zprofile`へ次の1行を追記し、ターミナルを開き直してください。既に同じ設定がある場合は追記不要です。

```sh
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

初回構築では、このMacにNode.js **24.21.0**・npm **11.19.0**を導入し、`~/.zprofile`のPATHも設定しました。`.node-version`と`.nvmrc`は24を指定しています。

### 2. 依存関係とローカル設定を用意

```sh
npm ci
cp -n .env.example .env
```

既存の`.env`は上書きせず、必要な設定だけ編集します。

| 環境変数           | 既定値                  | 用途                                         |
| ------------------ | ----------------------- | -------------------------------------------- |
| `API_PROXY_TARGET` | `http://127.0.0.1:8080` | 開発・プレビューサーバーからGo APIへの転送先 |

この値はViteサーバーだけが使用し、ブラウザには埋め込みません。フロントエンドにFMP・LINEのキー、管理者パスワードやDB接続情報を設定する必要はありません。`.env`の変更後は開発サーバーを再起動します。

### 3. 既存バックエンドのOriginを合わせる

ブラウザ上のURLは`https://localhost:5173`です。Go側の`PUBLIC_ORIGIN`も、ポート番号まで含めて同じ値にする必要があります。

```sh
PUBLIC_ORIGIN='https://localhost:5173'
```

既存Go APIの起動環境でこの値を設定してください。隣接バックエンドをホスト実行する場合、必要な環境変数を既存の手順で読み込んだうえで、例えば次のように起動できます。

```sh
# stock_notification_backend側で実行。DB・他の設定は既存環境を利用。
PUBLIC_ORIGIN='https://localhost:5173' ./bin/stock-notification serve
```

フロントエンドは`/api`を同一オリジンのHTTPSで受け、Goへ転送します。Cookie・Origin・CSRFヘッダーは維持します。Goのリクエスト期限90秒に対して、プロキシのタイムアウトは120秒です。

### 4. 開発サーバーを起動

```sh
npm run dev
```

[ログイン画面](https://localhost:5173/login)を開きます。自己署名証明書を自動生成するため、初回はブラウザの証明書警告でローカル開発サーバーへのアクセスを許可してください。証明書は`node_modules/.vite/`内に生成され、Gitには含まれません。開発用CAのOSへの登録は行いません。

管理者ID・パスワードは既存バックエンドの設定を使用します。バックエンドに接続できない場合はログイン状態の確認エラーを表示し、再試行できます。HTTPSが必要なのは、APIがSecure・HttpOnlyの`__Host-` Cookieを発行するためです。

待受先は`localhost`、ポートは5173に固定しています。`https://127.0.0.1:5173`等へ変えるとOriginが異なります。5173が使用中なら別ポートへの自動切替は行わず、起動を失敗させます。

停止はターミナルでCtrl+C。再開は`npm run dev`です。

## 検証

```sh
# 型チェック・lint・単体/コンポーネントテスト・本番ビルド
npm run check

# 初回のみブラウザを導入
npx playwright install chromium

# ビルド済みdistをHTTPSで配信し、専用APIスタブと接続して検証
npm run test:e2e
```

E2Eは`https://localhost:5173`と`http://127.0.0.1:18080`を使用します。実行前に開発サーバーをCtrl+Cで停止してください。既存プロセスはテストから停止・再利用しません。専用APIスタブはテスト時だけ起動し、実際のGo API・DB・FMP・LINEを使用しません。スタブのテスト用IDは`owner`、パスワードは`test-password`で、実サービスの認証情報ではありません。

| コマンド               | 内容                                    |
| ---------------------- | --------------------------------------- |
| `npm run typecheck`    | TypeScript型チェック                    |
| `npm run lint`         | ESLint                                  |
| `npm run format:check` | Prettierによる書式確認                  |
| `npm run format`       | ソース・設定・READMEの書式を統一        |
| `npm test`             | Vitest・Testing Library                 |
| `npm run test:watch`   | 単体テストの監視実行                    |
| `npm run build`        | 型チェックと`dist/`生成                 |
| `npm run preview`      | 生成済み`dist/`をHTTPS・5173で確認      |
| `npm run test:e2e`     | Playwright、1440×900・390×844のChromium |

単体テストでは入力境界、UTF-8バイト数、価格精度、JST変換、APIエラー、古い一覧応答の排除、設定保存失敗と未保存確認を検証します。ブラウザテストではSecure Cookie・Origin・CSRF、全画面の操作、401・403・404・409・422・429・502・503・504、通信断、履歴・再読み込み・Esc・フォーカス、ページ全体の横はみ出しを検証します。

画面キャプチャ・失敗時のトレースは`test-results/`、HTMLレポートは`playwright-report/`へ出力します。`npx playwright show-report`で参照できます。GitHub Actionsでも同じ検証を実行し、失敗時はレポートを7日間保存します。

2026-10-12の初回構築で、型チェック・lint・書式確認・単体/コンポーネントテスト14件・本番ビルド・ブラウザテスト18件が成功しました。HTTPS開発サーバーでも専用APIスタブを使い、ログイン、再読み込み後のセッション復元、設定画面、ログアウトと、ブラウザ実行時エラーがないことを確認しています。実際のFMP取得・LINE送信は実施していません。

## Goによる静的配信

```sh
npm run build
```

成果物は`dist/`です。バックエンドをホスト実行する場合は、既存のHTTPSリバースプロキシの背後で、Goの`STATIC_DIR`に成果物の絶対パスを指定してください。

```sh
# stock_notification_backend側で実行。必要な既存環境変数は設定済みとする。
STATIC_DIR="$(cd ../stock_notification_frontend/dist && pwd)" \
  ./bin/stock-notification serve
```

本番の`PUBLIC_ORIGIN`は実際の公開HTTPSオリジンに合わせます。Vite開発サーバー・プレビューサーバーは公開配信用ではありません。GoのDockerイメージへ組み込む場合は`dist/`の内容をバックエンドの`web/dist/`へ配置してから、バックエンド既存のビルド手順を使います。Go側は3画面の直接アクセスにも`index.html`を返します。

## データ・エラーの扱い

- IDと価格は十進数文字列のまま扱い、価格は桁区切りのみ追加します。下落率はAPIが返す小数2桁、日時は日本時間（JST）で表示します。
- セッション確認・ログイン応答のCSRFトークンはメモリにだけ保持します。認証CookieをJavaScriptから読まず、認証情報をlocalStorage・URL・ログに保存しません。
- 401では画面データを破棄してログインへ戻ります。変更要求の自動再送・自動ポーリングは行いません。
- 一覧の再取得失敗時は直前の結果を保持します。通信断等で変更の成否が不明なら一覧・設定を再取得し、結果確認を案内します。設定の編集内容は保持します。
- 未保存の設定は画面移動・履歴移動・ログアウトで破棄確認します。再読み込み・外部への離脱はブラウザ標準の確認を使います。ログアウトに失敗した場合も編集を保持します。
- 古い価格で登録された対象は停止状態と警告を併記します。手動再開だけでは警告を消さず、APIの状態を表示します。

## トラブル対応

- **`node` / `npm`が見つからない**：手順1のPATHを設定し、`exec zsh -l`でログインシェルを開き直します。
- **ログイン状態の確認に失敗する**：Go APIが起動済みか、`.env`の`API_PROXY_TARGET`が正しいか確認します。`curl -i http://127.0.0.1:8080/api/v1/auth/session`が未認証の401を返せばAPIには到達しています。
- **403になる**：Goの`PUBLIC_ORIGIN`が`https://localhost:5173`か、アクセスURLのホスト・ポートが一致するか確認します。CSRF不一致の場合はページを再読み込みしてセッションを再確認します。
- **ログイン直後にログイン画面へ戻る**：HTTPSで開いているか、証明書警告への対応が済んでいるか、ブラウザがCookieを許可しているか確認します。
- **5173/18080が使用中**：`lsof -nP -iTCP:5173 -iTCP:18080 -sTCP:LISTEN`で使用元を確認します。E2E時は自身の開発サーバーを停止します。既存サービスを勝手に終了しないでください。
- **銘柄を登録できない**：重複、取得不可、FMP側の拒否・障害・タイムアウトを画面に表示します。有効なFMP契約・APIキーの管理はバックエンド側で行います。

このリポジトリにはバックエンド・DBの構築、日次スケジューラ、公開環境へのデプロイは含みません。
