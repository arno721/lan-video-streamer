# LAN Media Hub（內網媒體中心）

> 優化後項目名稱：`LAN Media Hub`  
> 優化後簡介：Private LAN media hub with mobile-first web viewer, admin controls, and SQLite persistence.

## 多語言簡介

### 繁體中文
LAN Media Hub 是一套在內網使用的媒體中心，提供桌面與手機友善的 Web 觀看介面，並透過 SQLite 持久化保存索引與設定，重啟後不會遺失。

### English
LAN Media Hub is a private LAN media center with desktop and mobile-friendly web viewers. It uses SQLite to persist media index and settings, so data survives restarts.

### 日本語
LAN Media Hub は、LAN 内で使うプライベートメディアセンターです。PC/モバイル向けの Web ビューアーを備え、SQLite によってインデックスと設定を永続化します。

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

## 版本發佈（自動安裝包）

已加入版本控制與自動發佈流程：

1. 本機打版（會自動更新版本、commit、tag、push）：
   - `./scripts/release.ps1 1.0.1`
2. 推送 `v*` tag 後，GitHub Actions 會自動：
   - 產生安裝包 ZIP（`dist/<package-name>-vX.Y.Z.zip`）
   - 建立 GitHub Release 並附上安裝包

手動只打包不發版：
- `npm run build:installer`
