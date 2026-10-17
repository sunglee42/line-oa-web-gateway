# 測試範圍與限制

## 自動測試

Node.js 24、TypeScript strict、30 項 Mock 測試，涵蓋：

- 探索、短效配對、過期／錯誤／已用秘密、互斥、撤銷與損壞資料拒絕。
- Ingress 來源、相對靜態資源、CSRF／Origin、Web Session 與 LINE 登出。
- 登出與匯入／CSRF 寫入競態、取消 QR、發送期間拒絕登出。
- 別名、文字與圖片、UNKNOWN 不重送、請求去重、圖片清理。
- 完整失敗回應、敏感欄位遮蔽、當地時區與易讀日誌。
- 重啟後永久身份／配對／別名／Session 保留。

`check-backup-policy.py` 檢查排除規則保留必要資料、版本 metadata 一致。`check-publication.py` 檢查發布檔案不含私有部署資料與常見秘密。這些檢查不能取代人工檢查日誌及憑證。

Docker build stage 在 linux/amd64 執行全套測試。隔離 smoke 用空資料 volume 驗證 health、沒有公開埠、SIGTERM 正常停止、重啟身份持久化與 runtime 沒有 compiler／npm／測試檔。

[CI 執行結果](https://github.com/xangin/line-oa-ha-addon/actions)。0.1.3 映像發布與隔離 smoke：[成功執行紀錄](https://github.com/xangin/line-oa-ha-addon/actions/runs/39017811917)。公開文件中的 UI 截圖均使用合成帳號與 Mock LINE，不含正式 Session。

## 實機驗證與邊界

已在 HAOS／amd64 驗證安裝、啟動、HA→Supervisor→Ingress 資源、探索、配對狀態、更新保留私有資料、當地時區與健康檢查。0.1.3 實際 App-only 備份由約 86.55 MiB 降為 10 KiB，驗證無 image.tar、暫存排除、必要資料保留，並確認公開映像可匿名下載。詳見 [備份實測](backups.md)。

沒有透過自動測試向真實 LINE 收件者發訊，也沒有在使用中的 HA 執行覆寫式還原。未宣告支援 aarch64、長期低於固定記憶體上限、永不失效的 LINE Session 或保證送達。應用介面與 LINE 上游相容性需持續維護。
