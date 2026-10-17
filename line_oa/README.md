# LINE OA

透過 LINE 官方帳號傳送文字與圖片通知。支援 QR／PIN 登入、收件者別名、Ingress 管理、API v1 探索與配對。

**目前僅支援 amd64（x86-64），屬實驗版本。** 使用 LINE 管理後台未公開聊天介面，未獲 LINE 背書。安裝前先申請官方帳號、啟用「聊天」，並讓收件者先傳訊給官方帳號。

[完整入門與 LINE 官方教學連結](https://github.com/xangin/line-oa-ha-addon#readme)。安裝後閱讀 **Documentation**，由「開啟 Web UI」登入與設定別名。

Home Assistant 自動化另需相容 LINE OA 整合；本 App 不會自行建立 Actions，也不包含 HACS 整合。沒有對外開放 TCP 埠。備份保留必要設定與登入資料，還原時從公開 GHCR 下載對應版本映像。
