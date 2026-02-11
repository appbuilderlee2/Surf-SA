# SA Surf PWA (MVP)

簡潔 PWA：給南澳（Australia/Adelaide 時區）滑浪新手快速判斷「今日/未來幾日幾點有冇浪、值唔值得落水」。

## Data sources (no API key)
- Open-Meteo Marine API (wave height / period / direction)
- Open-Meteo Weather API (wind speed / direction)

> 注意：Open-Meteo 潮汐/洋流解析度約 0.08°（~8km），貼岸位準確度有限；只作參考，唔可代替當地實況。

## Run locally
在任何靜態 server（例如 `python3 -m http.server`）開：
```bash
cd surf-sa-pwa
python3 -m http.server 8088
```
然後打開 `http://127.0.0.1:8088/`。

## Deploy
可放任何 static hosting（Nginx / GitHub Pages / Cloudflare Pages）。

## Configure spots
修改 `spots.json`（lat/lon）。

## Webcam
本 MVP 先做「可插入」模式：在 `spots.json` 可選填 `camUrl`（必須係可嵌入/可公開連結）。
