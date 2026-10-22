<p align="center"><img src="line_oa/icon@2x.png" width="112" alt="LINE OA Add-on icon"></p>

# LINE OA — Web Gateway

> ⚠️ **非官方使用警語**
>
> 本專案採非官方方式使用 LINE 服務，使用風險由使用者自行承擔。若因此造成帳號異常、限制、停權或其他損失，開發者不負相關責任。

透過 LINE 官方帳號傳送 Home Assistant 文字、圖片與攝影機快照通知。使用 Web UI 完成 LINE 登入，為收件者設定別名，搭配 HTTP API v1 完成通知寄送。

TODO... 建立映像工作流

> 與[原始專案](https://github.com/xangin/line-oa-ha-addon)相比，此版本**無需與HA配合使用**，可於任意程式透過API呼叫。

## 功能與需求

- LINE QR Code／PIN 登入、官方帳號選擇及登出。
- 聯絡人查詢、重新整理與收件者別名白名單。
- 文字、單張 JPEG／PNG 圖片（最大 10 MiB）及供整合呼叫的 HTTP API v1。
- 一般的 Web UI 管理介面、自動探索與一次性配對交換。
- 當地時區日誌、失敗回應詳情與憑證遮蔽。

TODO... 預建映像安裝; 整理檔案; 整理文件;

| 需求 | 說明 |
| --- | --- |
| Docker | TODO... 待確認細節 |
| 架構 | **amd64（x86-64)**； arm之後會再加入 |
| LINE | 手機 LINE，以及可登入、管理該官方帳號的 LINE 帳號 |
| 網路 | 需要能連線到 LINE、GitHub 與 GHCR |

![管理介面範例（使用合成帳號與 Mock LINE）](docs/screenshots/overview-0.1.1.png)

## 其他注意事項
- 專案主要是透過 Codex 進行調整，並由人類做Review與小調整，但仍可能有非人為的錯誤風險。
- 本質上是從源專案撥離 HA 的部分，讓其可以獨立於Docker容器中運作，流程上目前可能有所缺失。
- 雖然已可運作，但既有的程式仍尚待清理，文件也是(包還佈署相關流程)。

Codex 給的[獨立版操作文件](README-WEB.md) <= 之後整理完後會重寫

## 授權與商標

專案程式碼採 [MIT License](LICENSE)。Node.js、Debian 及建置工具各依其原有授權；LINE 及相關商標屬其各自權利人。本專案圖示為社群專案識別，不代表官方合作。
