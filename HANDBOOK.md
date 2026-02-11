# Surf-SA Handbook（Repo 手冊）

## 目標
- 呢個 repo 係一個靜態 PWA（SA Surf PWA）。
- 目的：用 GitHub Pages 發佈，令你唔喺本機都可以打開：
  - https://appbuilderlee2.github.io/Surf-SA/

## 結構
- `index.html`：入口
- `app.js`：主要邏輯（包含 service worker register）
- `sw.js`：Service Worker（快取/離線）
- `manifest.webmanifest`：PWA manifest
- `icons/`：PWA icons
- `spots.json`：surf spots（lat/lon + 可選 camUrl）
- `tides_bom.json`：BoM 潮汐（離線 JSON）

## 本地開發/預覽
用任何靜態 server：
```bash
python3 -m http.server 8088
# open http://127.0.0.1:8088/
```

## 發佈（GitHub Pages）
目前設定：
- Pages source：`main` branch
- Path：`/`（repo root）

如要重新設定：Repo → Settings → Pages → Deploy from a branch → `main` / `/ (root)`。

## 更新流程（改完就出街）
1) 修改檔案（通常 `app.js`, `spots.json`, `styles.css`）
2) commit + push
3) 等 Pages build 完（通常幾十秒）

## 備註
- Service Worker 只會喺 HTTPS/localhost 生效；GitHub Pages 係 HTTPS。
- iOS Safari 可能需要重新安裝/刷新先更新 SW（已用 `sw.js?v=...` cache-bust 方式）。
