# Blender Asset Workflow

このプロジェクトでは、Web 表示用の最終投入形式は `glTF 2.0 / .glb` を基本とします。  
ただし、元データが `FBX` の場合は、先に `Blender` で内容確認を行ってから `glTF` へ変換する前提です。

## Shared References

- Blender: [/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/blender-reference.md](/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/blender-reference.md)
- FBX checklist: [/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/fbx-integration-checklist.md](/mnt/c/Users/nazok/OneDrive/ドキュメント/OpenAiCodex/shared-docs/fbx-integration-checklist.md)

## Recommended Intake Flow

1. `FBX` または元モデルを `Blender` で開く
2. ボーン、メッシュ、マテリアル、モーフ、左右基準を確認する
3. 必要なら `fbx-integration-checklist.md` の記録欄を埋める
4. Web 用に `glTF 2.0 (.glb)` で書き出す
5. `assets/models/` に配置する
6. `src/blender/manifest.js` に登録する
7. 地球上へ固定する場合は `anchor: "surface"` と `latitude / longitude` を設定する

## Why This Flow

- `Three.js` では `glTF / GLB` が最も扱いやすい
- `FBX` のまま直接扱うより、Blender で事前確認した方が破綻点を見つけやすい
- 将来、スキニングやモーフを使うモデルを載せる場合も、元モデルの構造メモが残る

## Model Notes

モデルごとにメモを残す場合は、次のようなファイルを `docs/model-notes/` 配下に作る運用を推奨します。

- `docs/model-notes/<model-name>.md`

最低限、次を残しておくと後で助かります。

- 元形式 (`FBX` / `BLEND` / `GLB`)
- モデル名と版
- エクスポート元ファイル
- スケール調整の有無
- 地球上への配置座標
- ボーンやモーフの有無
- 左右の向きと正面基準

## Current Runtime Assumptions

現在のローダーは以下を前提にしています。

- 静的な `glTF / GLB` を読み込める
- 地表固定配置またはシーン常駐配置に対応する
- メッシュ、スキニング、モーフの有無をサマリとして保持する

アニメーション再生やボーン駆動は、必要になった段階で別レイヤーとして追加する想定です。
