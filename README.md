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

## Windows の簡単起動

`launch-3d-earth.bat` をダブルクリックすると、必要なら `npm install` を実行し、ローカルサーバーを起動してブラウザを自動で開きます。

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
