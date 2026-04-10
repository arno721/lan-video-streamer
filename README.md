# 內網媒體串流器（SQLite 永久化）

已改為資料庫驅動，索引與設定都存到 SQLite，不會因重啟丟失。

## 一鍵啟動

- 雙擊：`start-media-streamer.bat`
- 或 PowerShell：`./start-media-streamer.ps1`

## 開機啟動（Windows）

- 啟用（並立即啟動一次）：雙擊 `install-autostart.bat`
- 取消：雙擊 `uninstall-autostart.bat`

說明：
- 會建立工作排程 `LANMediaStreamer_Autostart`
- 在你登入 Windows 後自動以隱藏視窗啟動伺服器
- 若系統拒絕建立工作排程，會自動改用 `Startup` 資料夾啟動器（同樣可自啟）

## 入口頁面

- 桌面觀看（全寬無留白）：`/desktop.html`
- 手機觀看（純觀看）：`/mobile.html`
- 管理端（多掃描路徑 / 多排除路徑）：`/admin.html`

根路由 `/` 會依裝置自動導向：手機到 `mobile.html`，電腦到 `desktop.html`。

## 永久化內容（SQLite）

資料庫檔案：`.cache/streamer.db`

永久保存：
- 多掃描路徑
- 多排除路徑
- 媒體索引資料

## 主要能力

- 多掃描路徑 + 多排除路徑
- 層級分類樹
- 影片/圖片/音訊/文件/壓縮檔/程式碼/其他分類
- 預覽圖生成（多線程 Worker）
- 觀看頁僅保留觀看功能（設定集中在管理端）

## 備註

- 若系統有 `ffmpeg`，影片/圖片會生成更真實縮圖。
- 無 `ffmpeg` 時，仍會生成 SVG 預覽圖。
- 若防火牆提示，允許 Node.js 私人網路存取。
