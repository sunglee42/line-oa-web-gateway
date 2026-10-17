<p align="center"><img src="line_oa/icon@2x.png" width="112" alt="LINE OA Add-on icon"></p>

# LINE OA — Home Assistant Add-on

透過 LINE 官方帳號傳送 Home Assistant 文字、圖片與攝影機快照通知。使用 Home Assistant 的 Web UI 完成 LINE 登入，為收件者設定別名，再由相容整合呼叫通知。

[![Test and build](https://github.com/xangin/line-oa-ha-addon/actions/workflows/test.yaml/badge.svg)](https://github.com/xangin/line-oa-ha-addon/actions/workflows/test.yaml)
[![Release](https://img.shields.io/github/v/release/xangin/line-oa-ha-addon)](https://github.com/xangin/line-oa-ha-addon/releases)

> **實驗版本／非官方 LINE 專案。** 本專案使用 LINE 官方帳號管理後台的未公開聊天介面，並非 LINE Messaging API，也未獲 LINE 背書。LINE 服務變更或登入限制可能影響使用；請遵守 LINE 使用規範，不適合大量群發或必須保證送達的緊急通知。這裡提供的是 Add-on；Home Assistant Actions 另需相容的 LINE OA 整合。

## 功能與需求

- LINE QR Code／PIN 登入、官方帳號選擇及登出。
- 聯絡人查詢、重新整理與收件者別名白名單。
- 文字、單張 JPEG／PNG 圖片（最大 10 MiB）及供整合呼叫的 HTTP API v1。
- Home Assistant Ingress 管理介面、自動探索與一次性配對交換。
- 當地時區日誌、失敗回應詳情與憑證遮蔽。
- 預建映像安裝；備份保存設定與登入資料，還原時重新下載映像，排除暫存、快取與日誌。

| 需求 | 說明 |
| --- | --- |
| Home Assistant | 有 Supervisor／App Store 的安裝；一般建議 Home Assistant OS |
| 架構 | **amd64（x86-64）**；目前沒有 aarch64／Raspberry Pi ARM 映像 |
| LINE | 手機 LINE，以及可登入、管理該官方帳號的 LINE 帳號 |
| 網路 | HA 可連線 LINE、GitHub 與 GHCR；還原映像也需要網路 |
| 通知自動化 | 另裝支援本專案 API v1／Supervisor 配對的 LINE OA 整合 |

僅有 Home Assistant Container／Core、沒有 Supervisor 的環境不能安裝本 Add-on。也不需要為本 Add-on 另外建立 Messaging API Channel、Channel Access Token 或公開 Webhook URL。

![管理介面範例（使用合成帳號與 Mock LINE）](docs/screenshots/overview-0.1.1.png)

## 1. 申請 LINE 官方帳號

已有官方帳號且能在管理後台進行聊天，可直接進到下一節。

1. 從 LINE 的[免費開設官方帳號](https://tw.linebiz.com/account/)頁面開始，依官方畫面登入並建立帳號。
2. 建立完成後，登入 [LINE Official Account Manager](https://manager.line.biz/)，確認可以選到要使用的官方帳號。
3. 若帳號由其他人建立，請由擁有者透過官方的[權限管理說明](https://tw.linebiz.com/manual/line-official-account/oa-manager/)授予適當管理權限。

申請欄位、驗證、方案及費用以 LINE 官方頁面為準。本專案不代辦申請，也不要求提供 LINE 密碼或手機驗證碼。

## 2. 必須啟用「聊天」並建立對話

**只建立官方帳號還不夠，請先開啟聊天。**

1. 在 [LINE Official Account Manager](https://manager.line.biz/) 選擇官方帳號。
2. 進入「設定 → 回應設定」，啟用「聊天」。若設有回應時間，也請核對手動聊天的時段與回應方式。
3. 用要接收通知的個人 LINE 加入該官方帳號好友，並先傳一則訊息給官方帳號。
4. 回到官方後台的聊天頁面，確認可以找到此對話並手動回覆。

詳細畫面請直接參考 LINE 官方教學：

- [一對一聊天：啟用聊天模式與基本操作](https://tw.linebiz.com/manual/line-official-account/oa-manager-chatting/)
- [回應設定、回應時間與帳號權限](https://tw.linebiz.com/manual/line-official-account/oa-manager/)

聯絡人來自後台聊天集合，**不等於全部好友名單**。找不到收件者時，先確認對方已傳訊、未封鎖帳號，且官方後台可正常聊天；再到 Add-on 重新整理。群組支援取決於 LINE 官方帳號設定及後台實際回傳的聊天對象，不保證每個群組都會出現。

## 3. 安裝 Add-on

[![Open your Home Assistant instance and show the add repository dialog](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fxangin%2Fline-oa-ha-addon)

或手動加入：

1. 在 Home Assistant 開啟「設定 → 應用程式／附加元件 → 商店」。介面名稱會隨 HA 版本不同。
2. 右上角選單 →「儲存庫／Repositories」，加入：

   ```text
   https://github.com/xangin/line-oa-ha-addon
   ```

3. 找到 **LINE OA**，按「安裝」。此步驟會下載與版本相符的預建映像。
4. 啟動後按「開啟 Web UI」。建議開啟「開機啟動」。

不需要新增 HA YAML、手動開放 TCP 埠或關閉保護模式。Web UI 必須由 Home Assistant 的「開啟 Web UI」進入，不能直接使用主機 IP 加上內部埠號。

## 4. 登入 LINE 與設定收件者

1. 「總覽」→「登入／切換官方帳號」。
2. 用手機 LINE 掃描行動條碼，依畫面確認登入。若顯示 PIN，請依手機畫面核對；若顯示帳號選擇，選取正確的官方帳號。
3. 等待完成，再按「手動測試連線」，確認狀態為 **CONNECTED**。
4. 「聯絡人」→ **先按「重新整理」**，從 LINE 載入對象；需要時輸入名稱搜尋。
5. 找到對象後按「設為別名」，輸入例如 `home`。別名限 1–32 字元的小寫英文字母、數字、底線或連字號。
6. 確認出現在「允許的收件者別名」。**沒有別名的對象不能發送通知。** 名稱相同時請核對 Web Chat ID。
7. 到「發送測試」選取別名，先對已確認的收件者發送少量測試訊息。

`who` 使用 `home` 這類別名，不填 LINE ID、電話號碼或 Messaging API User ID。

「登出 LINE」清除此 Add-on 保存的登入資料與聯絡人快取，保留別名與 HA 配對；之後需重新登入。切換官方帳號後，請重新核對收件者與別名。

## 5. Home Assistant 通知整合

**本儲存庫不包含 HACS 整合，也不會自行建立 `line_oa.*` Actions。** Add-on 的 Web UI 可以獨立登入及測試發送；自動化必須搭配實作 API v1 與 Supervisor Discovery／配對交換的 LINE OA 整合。目前此處沒有提供已驗證的公開 HACS 下載位置，請勿將本 Add-on 儲存庫當成 HACS Integration 加入。

使用相容整合時：

1. 依該整合的說明安裝並載入。
2. 在「設定 → 裝置與服務」確認探索到的 LINE OA，再完成配對。
3. Add-on「設定」應顯示已配對；可在整合建立的 Actions 中使用收件者別名。

已經連到其他 Gateway／LXC 的整合不會被 Add-on 自動覆寫。若整合沒有自動探索／配對能力，單獨安裝本 Add-on 不會補足這項能力。[整合端介接契約](docs/secure-pairing.md)。

下列範例需要相容整合提供對應 Action：

```yaml
action: line_oa.send_text
data:
  who: home
  message: "洗衣機已完成"
```

```yaml
action: line_oa.send_image
data:
  who: home
  image_path: "/media/test.jpg"
```

```yaml
action: line_oa.send_screen_shot
data:
  who: home
  camera_entity: camera.front_door
```

圖片／攝影機 Action 不接受 `message`，需附文字請另呼叫 `send_text`。`image_path` 是 **HA Core 可讀取的路徑**；Core 讀取圖片後上傳，Add-on 不會直接讀取 Core 的檔案。結果為 **UNKNOWN** 時代表送出結果不明，請先核對 LINE，避免重複通知。

## 備份、還原與更新

- 在 Home Assistant 系統備份中包含 **LINE OA**。備份保存登入 Session、別名、永久身份、配對憑證雜湊及 App 設定。
- 正式版使用 GHCR 預建映像，Supervisor 不必把整份 runtime／Docker 映像放進 App 備份；還原時下載備份對應的版本。
- 暫存圖片、快取及日誌排除。實際備份大小仍受必要資料與 HA 備份封裝影響。
- 冷備份會短暫停止並恢復 Add-on。備份本身含敏感登入資料，請保護 HA 備份與復原金鑰。
- 從商店更新會保留 `/data`；**不要以解除安裝後重裝代替更新**。
- 還原需要可連線 GHCR，且該版本映像仍存在。即使檔案成功還原，LINE 仍可能要求重新登入。

[完整備份與還原說明](docs/backups.md)。

## 常見問題

| 情況 | 先檢查 |
| --- | --- |
| 商店看不到 Add-on | 確認已加入本儲存庫、重新整理商店，且主機為 amd64 |
| 安裝／還原下載失敗 | 確認 HA 可連線 `ghcr.io` 及 GitHub，查看 App／Supervisor 日誌 |
| 無法登入／沒有帳號可選 | 確認手機使用的 LINE 帳號具有官方帳號管理權限，且官方網站可正常登入 |
| 找不到聯絡人 | 啟用聊天、讓對方先傳訊，在官方後台確認對話，再按 Add-on「重新整理」 |
| `TARGET_NOT_ALLOWED` | 收件者尚未設定允許別名，或 `who` 拼寫不同 |
| `WEB_UI_CSRF_TOKEN_*` | 頁面驗證已失效；重新整理 Add-on 頁面再操作，遭拒的操作尚未執行 |
| `LINE_HTTP_403_CSRF_OR_PERMISSION_DENIED` | 展開失敗紀錄，檢查 LINE 回應與帳號權限，必要時重新登入 |
| `LOGIN_BUSINESS_CSRF_MISSING` | LINE 登入頁與預期格式不同；查看遮蔽後的回應，提供版本與錯誤名稱回報 |
| App 已連線但 HA 沒有 Actions | 確認已安裝並載入相容 LINE OA 整合 |
| `UNKNOWN` | 不自動重送，先確認 LINE 是否已收到 |

日誌依 HA 提供的當地時區顯示；「紀錄」可以展開失敗系統回應。憑證會遮蔽，但內容仍可能包含帳號或對象資訊，公開回報前請自行檢查。

[故障排除](docs/troubleshooting.md) · [回報問題](https://github.com/xangin/line-oa-ha-addon/issues/new/choose) · [安全回報](SECURITY.md)

## 開發與介接

執行環境為 Node.js 24，正式 runtime 無第三方 npm 生產相依或 Chromium。原有 LINE 通訊核心由 Gateway 0.5.0 移植，保留一次提交、結果不明不重送的行為。

```sh
npm --prefix line_oa/app ci --ignore-scripts --no-audit --no-fund
npm --prefix line_oa/app test
python3 scripts/check-backup-policy.py
docker build --platform linux/amd64 -t line-oa:test line_oa
python3 scripts/container-smoke.py
```

[完整操作](DOCS.md) · [安裝](docs/installation.md) · [API 相容性](docs/api-compatibility.md) · [安全配對](docs/secure-pairing.md) · [探索](docs/discovery.md) · [安全邊界](docs/security.md) · [測試範圍](docs/verification.md) · [原始碼來源](docs/source-audit.md) · [貢獻指南](CONTRIBUTING.md)

## 授權與商標

專案程式碼採 [MIT License](LICENSE)。Node.js、Debian 及建置工具各依其原有授權；LINE、Home Assistant 及相關商標屬其各自權利人。本專案圖示為社群專案識別，不代表官方合作。
