# LINE OA 操作說明

## 使用前準備

依 [LINE 官方申請頁](https://tw.linebiz.com/account/) 建立帳號，登入 [Official Account Manager](https://manager.line.biz/) 後，在「設定 → 回應設定」啟用「聊天」。讓收件者先加入好友並傳訊，確認官方後台可聊天，再使用本 App。圖文步驟見 [LINE 官方聊天教學](https://tw.linebiz.com/manual/line-official-account/oa-manager-chatting/)。

完整新手教學：[專案 README](https://github.com/xangin/line-oa-ha-addon#readme)。目前只支援 amd64；HACS 整合需另外安裝相容版本。

## 啟動與登入

啟動 App，按「開啟 Web UI」。管理介面只能經由 HA Ingress 使用，不需另外建立 Gateway 管理者密碼。

在「總覽」按「登入／切換官方帳號」，用手機 LINE 掃描 QR，依畫面核對 PIN／選擇官方帳號。完成後在「聯絡人」先按「重新整理」載入對象，再按「設為別名」設定單一別名（例如 `home`）。重新登入前不會先刪除原有 Session；只有成功取得新 Session 後才以原子寫入取代。

「手動測試連線」會查詢 LINE 連線與聯絡人，不會發訊。切換官方帳號後，請重新核對聯絡人與允許發送的別名。Web UI 的「發送測試」會真的發送，請只對已確認的收件者操作。

「總覽 → 登出 LINE」會清除此 Add-on 保存的登入資料與聯絡人快取，保留收件者別名與 HA 配對。正在發送時請等待完成後再登出。

「紀錄」可展開失敗回應詳情；應用程式日誌以 HA 當地時區顯示純文字欄位。登入憑證會遮蔽。

## Home Assistant 整合

App 會透過 Supervisor Discovery 發布 `line_oa`，API 尚未登入 LINE 也可探索。搭配已實作 hassio config flow 的 HACS 時，至「設定 → 裝置與服務」確認新增即可自動配對。整合需實作配對交換；本 App 不會修改 HA 的 `configuration.yaml` 或現有整合。

HACS 呼叫 `/api/v1/*` 需 Bearer Key。正式 Key 只經配對交換回傳給 HACS，Web UI 不顯示、不保存到瀏覽器。

## 重新配對／憑證輪替

Ingress「設定 → 重新配對 Home Assistant／輪替憑證」會撤銷舊 Key，建立新的配對窗口。接著在支援配對的 HACS 重新驗證。這與 LINE QR 登入互相獨立。若交換回應遺失，先重新授權，再重新驗證；不要重用舊 Token。

## 資料與更新

Session、別名、身份與憑證雜湊位於 App 私有 `/data`，更新映像會保留。使用 Home Assistant 備份本 App，復原時保留整份 `/data`。預建映像於還原時重新下載，不含在 App 備份中；圖片暫存、快取與日誌不備份。還原需要網路與對應版本映像。請保護包含 Session 的備份，不要放入 Git／Issue／聊天。

## 故障排除

- Ingress 403：只允許 Supervisor 代理，請從 HA「開啟 Web UI」進入，不能直接用 IP:8099。
- API 401：Key 未配對或已撤銷；檢查「設定」配對狀態。
- Discovery retrying：Supervisor 暫時不可用，App 會重試，不會清除 LINE Session。
- 登入 auth_required／expired：在 Web UI 重新登入 LINE，不需要重配 API。
- UNKNOWN：結果不明，不要自動重送。

完整技術契約、安全模型與實測紀錄請參閱此 Repository 根目錄 `docs/`。
