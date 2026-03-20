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

ローカルから `git add / commit / push` まで含めて一発で流す場合は次を使います。

```bash
npm run publish:main -- "変更内容のメッセージ"
```

## Windows の簡単起動

`launch-3d-earth.bat` をダブルクリックすると、必要なら `npm install` を実行し、ローカルサーバーを起動してブラウザを自動で開きます。

GitHub への push と EC2 デプロイまでまとめて流す場合は `publish-and-deploy.bat` を使います。引数なしで実行すると commit message を聞き、push 完了後に Actions 画面を開きます。

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
- 右下パネル: PC時刻と画面中央地点の緯度・経度を表示

## 自動デプロイ

`main` への push を起点に、GitHub Actions から EC2 へ SSH 接続して更新・再起動する workflow を追加しています。

追加ファイル:

- `.github/workflows/deploy-ec2.yml`
- `scripts/deploy-on-ec2.sh`

### GitHub 側で設定するもの

Repository Variables:

- `DEPLOY_HOST`
  例: `13.230.179.38`
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
  EC2 の host key。例:
  `ssh-keyscan -H 13.230.179.38`

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
