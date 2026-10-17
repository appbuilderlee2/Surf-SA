# Surf SA v2.1.0
南澳浪況 PWA，純靜態網頁，不需要後端或 API key。

網站：https://appbuilderlee2.github.io/Surf-SA/

## 功能
- 淺色海洋風手機介面，中英術語並列。
- 今日／10 日預報、逐小時浪況、日照時段推薦。
- 13 個浪點、地圖、新手／附近篩選、收藏及設定。
- 所有日期以 Australia/Adelaide 計算。
- 預報快取 15 分鐘；斷線顯示有時間標記的舊資料。
- 新手模式採用浪點難度，不將進階點推薦為適合新手。

## 資料及限制
Open-Meteo Marine / Weather 提供模型資料；有效波高不等於岸邊破浪高度。
地圖使用 Leaflet 和 OpenStreetMap，需連網。Cam 以外部連結開啟。
`tides_bom.json` 舊檔的 PDF 解析結果有異常，v2 不讀取、不快取、不顯示此資料，改提供官方 BoM 潮汐表連結。舊檔保留供追查，勿作現場判斷。
收藏、偏好、預報快取儲存在此瀏覽器，沒有帳戶同步。

## 開發與測試
```sh
python3 -m http.server 8088
node --test tests/forecast.test.cjs
```
Pages 使用 main 分支根目錄。更新時同步 index.html 資產版本、sw.js 快取名稱及預先快取 URL。

## v2.1.0
重新設計 UI、加入中英術語、收藏及設定，修正預設載入錯誤、10 日摘要日期錯配、裝置時區依賴、錯誤信心分數及 PWA 資產快取不匹配。

## v2.1.0 — 現場因素
- 加入模型海平面 MSL、趨勢及湧浪週期／方向，模型海平面不等於官方潮表基準。
- 加入浪點獨立的使用者現場記錄：潮汐／進出水位、離岸流、破浪高度、救生員／封灘警告。有效期 30 分鐘且只適用目前小時，不能套用到未來日期。
- 警告／離岸流或較大現場破浪覆蓋模型為 Caution；不利潮位為 Check；未知現場因素不給 Milder。
- Best window 改為「模型候選時段」，只代表風浪模型條件；不保證現場安全。當前危險或不利潮位停止推薦。
- 沒有自動離岸流偵測或即時救生員警告 feed。不得將手動記錄標成官方即時資料。數值門檻屬 App 保守篩選規則，並非經驗證的安全模型。
- 來源：https://open-meteo.com/en/docs/marine-weather-api 、https://beachsafe.org.au/surf-safety/ripcurrents
