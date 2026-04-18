# tikbuzz

Remotion と Aivis を使って、`トレンド収集 → 構成生成 → 素材取得 → 音声生成 → MP4 レンダリング` までを自動で流す TikTok 縦動画パイプラインです。

## 今あるもの

- 公開 RSS と公開ページから候補話題を収集する `discover`
- 無難で広くウケる話題を優先する `rank`
- 1本ぶんの `brief.json` を生成する `brief`
- 背景画像・動画を自動取得して `asset-log.json` に出典を残す `assets`
- Aivis のローカル HTTP API で wav を吐く `voice`
- Remotion で `final.mp4` を作る `render`
- 全段を一気に流す `run:auto-video`

## ローカル Node

このワークスペースには macOS arm64 用の Node.js を `.local/` 配下に同梱しています。システムの `node` を触らずに動かせます。

依存導入:

```bash
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm install
```

型検査:

```bash
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run typecheck
```

テスト:

```bash
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm test
```

## Aivis 設定

`.env.example` を `.env` にコピーして、Aivis のローカル API 情報を入れます。

```bash
cp .env.example .env
```

必要な値:

- `AIVIS_BASE_URL`
- `AIVIS_STYLE_ID`

話者確認:

```bash
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run aivis:list-speakers
```

## 実行コマンド

全自動:

```bash
./run-auto-video.command
```

段階実行:

```bash
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run discover
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run rank -- --run-dir /abs/path/to/run
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run brief -- --run-dir /abs/path/to/run
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run assets -- --run-dir /abs/path/to/run
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run voice -- --run-dir /abs/path/to/run
./scripts/with-local-node.sh env npm_config_cache="$PWD/.npm-cache" npm run render -- --run-dir /abs/path/to/run
```

Remotion Studio:

```bash
./dev.command
```

## 出力

各ジョブは `runs/<timestamp>/` にまとまります。

- `candidates.json`
- `ranked-topic.json`
- `source-log.json`
- `brief.json`
- `asset-log.json`
- `voice-log.json`
- `timeline.json`
- `render-props.json`
- `final.mp4`

## 制約

- 背景素材は公開 Web を広く見にいくため、ライセンスの厳密判定はまだしていません。
- Aivis が起動していないと `voice` 以降は失敗します。
- `render` は Remotion がブラウザとレンダリング環境を確保できることが前提です。
