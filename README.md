# 3D Earth Explorer

Three.js で作った、操作可能な 3D 地球ビューアです。

## 起動

```bash
npm install
npm start
```

ブラウザで `http://localhost:4173` を開いてください。
`index.html` を直接開くのではなく、必ずサーバー経由で開いてください。
もし `4173` が既に使われている場合は、ターミナルに表示された別の URL を開いてください。

外部公開用に全インターフェースで待ち受ける場合は次を使います。

```bash
npm run start:public
```

船舶 AIS 表示も使う場合は、サーバー側に `.env.local` または `.env.production` を置いて `AISSTREAM_API_KEY` を設定してください。サンプルは [/.env.example](/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/3DEarth/.env.example) にあります。

ローカルから `git add / commit / push` まで含めて一発で流す場合は次を使います。

```bash
npm run publish:main -- "変更内容のメッセージ"
```

## Windows の簡単起動

`launch-3d-earth.bat` をダブルクリックすると、必要なら `npm install` を実行し、ローカルサーバーを起動してブラウザを自動で開きます。

GitHub への push と EC2 デプロイまでまとめて流す場合は `publish-and-deploy.bat` を使います。引数なしで実行すると commit message を聞き、push 完了後に Actions 画面を開きます。

## EC2 起動と Discord 通知

PC 再起動後に EC2 を起動し、アプリを再デプロイして、公開 URL を Discord DM で通知する場合は次を使います。

```bat
start-remote-3d-earth.bat
```

事前確認だけなら:

```bat
start-remote-3d-earth.bat -ValidateOnly
```

`-ValidateOnly` はコマンドの存在だけでなく、AWS 認証状態も確認します。`NoCredentials` が出る場合は、Windows 側で先に `aws login` を実行してください。

`gh` が利用可能な場合、`start-remote-3d-earth.bat` は current public IP を見て GitHub の `DEPLOY_HOST` / `DEPLOY_PATH` / `DEPLOY_PORT` / `DEPLOY_USER` / `DEPLOY_KNOWN_HOSTS` を自動同期し、その後 `Deploy To EC2` workflow を `workflow_dispatch` で起動して待機します。これにより `AISSTREAM_API_KEY` など GitHub Secrets 経由の設定も自動デプロイへ反映されます。

Cloudflare quick tunnel を使わず、EC2 の public host をそのまま使う場合は:

```bat
start-remote-3d-earth.bat -SkipTunnel
```

### ローカル PC 側の前提

- `aws` CLI が Windows の PATH に入っている
- `aws login` などで、Windows 側の AWS CLI から EC2 を操作できる認証状態になっている
- GitHub Actions の `DEPLOY_HOST` / `DEPLOY_KNOWN_HOSTS` を自動同期する場合は `gh` CLI が使え、`gh auth login` 済み
- GitHub Actions 経由で再デプロイする場合は、対象 repo への `gh` 書き込み権限がある
- `ssh` が使える
- Discord DM 通知を安定させる場合は、WSL と `../DiscorcCon/.venv` の `discord.py` が使える状態になっている
- Discord 通知を使う場合は bot token と owner user id の環境変数が入っている

### EC2 側の前提

- リポジトリが `THREE_D_EARTH_DEPLOY_PATH` に clone 済み
- `bash ./scripts/deploy-on-ec2.sh` が通る
- Cloudflare URL を毎回取りたい場合は、EC2 に `cloudflared` がインストール済み

### 必要な環境変数

必須:

- `THREE_D_EARTH_AWS_INSTANCE_ID`
- `THREE_D_EARTH_DEPLOY_USER`
- `THREE_D_EARTH_DEPLOY_PATH`

任意:

- `THREE_D_EARTH_AWS_REGION`
- `THREE_D_EARTH_DEPLOY_PORT`
- `THREE_D_EARTH_APP_PORT`
- `THREE_D_EARTH_GITHUB_REPO`
- `THREE_D_EARTH_SSH_KEY_PATH`
- `THREE_D_EARTH_DISCORD_BOT_TOKEN`
- `THREE_D_EARTH_DISCORD_OWNER_USER_ID`

Discord の値は、未指定なら既存の bridge 用 env を自動で見ます。

- `CODEX_BRIDGE_DISCORD_TOKEN`
- `CODEX_BRIDGE_DISCORD_OWNER_USER_ID`

`THREE_D_EARTH_GITHUB_REPO` は `owner/repo` 形式です。省略時はローカル repo の `origin` から自動推定します。`start-remote-3d-earth.bat` は EC2 起動後に current public IP を見て、GitHub の `DEPLOY_HOST` / `DEPLOY_PATH` / `DEPLOY_PORT` / `DEPLOY_USER` / `DEPLOY_KNOWN_HOSTS` を自動更新します。同期だけ止めたい場合は `-SkipGitHubDeploySync` を付けてください。

ローカル `main` が `origin/main` より先行している場合、workflow dispatch では remote 側の `main` が使われます。未 push の変更も含めたい場合は、先に `publish-and-deploy.bat` などで push してください。

Cloudflare quick tunnel の URL 取得は EC2 上の `scripts/start-cloudflare-quick-tunnel.sh` が担当します。`trycloudflare.com` の一時 URL を起動ごとに取得し、その値を通知します。

`THREE_D_EARTH_SSH_KEY_PATH` を省略した場合は、Windows 側で次の順に既定鍵を自動探索します。

- `C:\Users\<user>\.ssh\3d-earth-actions-ec2`
- `C:\Users\<user>\.ssh\id_ed25519`
- `C:\Users\<user>\.ssh\id_rsa`

## Shared References

- Blender: [/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/blender-reference.md](/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/blender-reference.md)
- FBX checklist: [/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/fbx-integration-checklist.md](/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/fbx-integration-checklist.md)

## 構成

- `src/main.js`: アプリ全体の初期化と各機能の連携
- `src/config/app-config.js`: カメラ、描画、航空機、地域高精細表示の調整値
- `src/render/scene-factories.js`: 地球、雲、大気、星空の描画マテリアル
- `src/blender/manifest.js`: Blender から書き出した glTF/GLB 資産の登録場所
- `src/blender/load-blender-assets.js`: 登録済み Blender 資産の読込と配置
- `docs/rearchitecture.md`: 見直し内容と今後の分離方針
- `docs/blender-asset-workflow.md`: Blender / FBX を使ったモデル投入手順

## Blender 資産の追加

1. Blender から `glTF 2.0 (.glb)` で書き出します
2. `assets/models/` に配置します
3. `src/blender/manifest.js` にエントリを追加します

地球上の緯度・経度に固定したい場合は `anchor: "surface"` を使ってください。例は `assets/models/README.md` にあります。
元データが `FBX` の場合は、先に `shared-docs` の Blender / FBX メモを見ながら Blender 上で構造確認してから `glTF 2.0 (.glb)` へ変換するのを推奨します。

## 操作

- ドラッグ: 地球を回転
- ホイール: ズーム
- ボタン: 時刻同期の停止・再開 / 雲表示切替 / 視点リセット
- 右下パネル: PC時刻、航空機/船舶表示状態、画面中央地点の緯度・経度を表示
- 場所検索: 地域名・建物名・座標を入力すると候補を検索し、その地点へ移動
- 交通情報: 航空機 / 船舶の情報表示は `詳細` と `簡易` を切り替え可能。スマホのドラッグ中は簡易表示に落ちます

## 船舶表示

船舶表示は `/api/ships` を経由して AISStream のストリームを短時間だけ購読し、その時点で受信できた船舶を一度だけ表示します。ブラウザへ API キーは出さず、サーバー側の環境変数から読みます。

1. AISStream で API キーを取得します
2. ローカル開発なら `.env.local`、EC2 なら `.env.production` を作ります
3. `AISSTREAM_API_KEY=...` を設定してサーバーを起動します

サーバー側の例:

```bash
cp .env.example .env.production
```

そのあと `AISSTREAM_API_KEY` の値を実キーへ置き換えてください。

## 場所検索

場所検索は `/api/geocode` を経由して Nominatim へ問い合わせます。地名検索は Enter / 「移動」ボタンを押した時だけ実行し、サーバー側でキャッシュと間引きを行います。

- 日本語入力で海外の地域名や建物名を検索可能
- `35.681236, 139.767125` のような座標直入力にも対応
- 候補は最大 5 件表示し、1 件目へ自動移動したあとで選び直し可能

## 自動デプロイ

`main` への push を起点に、GitHub Actions から EC2 へ SSH 接続して更新・再起動する workflow を追加しています。

追加ファイル:

- `.github/workflows/deploy-ec2.yml`
- `scripts/deploy-on-ec2.sh`

### GitHub 側で設定するもの

Repository Variables:

- `DEPLOY_HOST`
  初回設定後は `start-remote-3d-earth.bat` が current public IP へ自動更新
- `DEPLOY_USER`
  例: `ubuntu`
- `DEPLOY_PATH`
  例: `/home/ubuntu/my-app`
- `DEPLOY_PORT`
  省略可。通常は `22`

Repository Secrets:

- `DEPLOY_SSH_PRIVATE_KEY`
  GitHub Actions が EC2 へ SSH するための秘密鍵
- `DEPLOY_KNOWN_HOSTS`
  EC2 の host key。初回設定後は `start-remote-3d-earth.bat` が current host key へ自動更新
- `AISSTREAM_API_KEY`
  船舶表示に使う AISStream キー。`start-remote-3d-earth.bat` が起動する workflow から参照される

### EC2 側の前提

- リポジトリが `DEPLOY_PATH` に clone 済み
- `npm ci` と `npm run start:public` が通る
- GitHub から `git pull origin main` できる

サーバー側の GitHub 認証は、個人アカウントの鍵ではなく、リポジトリ単位の deploy key を使う構成を推奨します。

### 初回反映の流れ

1. EC2 にこのリポジトリを配置する
2. EC2 から GitHub へ pull できる状態にする
3. GitHub の Variables / Secrets を設定する
4. `main` に push する

workflow は次を実行します。

1. GitHub Actions runner から EC2 に SSH
2. EC2 上で、旧運用の `package.json` 差分が残っていれば stash 退避
3. EC2 上で `git pull --ff-only origin main`
4. `scripts/deploy-on-ec2.sh` を実行
5. `npm ci`
6. 旧プロセス停止
7. `npm run start:public` で再起動
8. `http://127.0.0.1:4173/` のヘルスチェック

`start-remote-3d-earth.bat` から起動する場合は、次の順になります。

1. AWS から current public IP を取得
2. GitHub Variables / Secrets の deploy 関連設定を current 値へ同期
3. `Deploy To EC2` workflow を `workflow_dispatch` で起動
4. 完了を待機
5. 必要なら Cloudflare quick tunnel を起動
6. 必要なら Discord DM で URL を通知
