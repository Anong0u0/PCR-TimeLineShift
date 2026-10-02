# PCR Timeline Shift

《公主連結 Re:Dive》補償刀時間軸轉換工具。

[**🔗 Live Demo**](https://anong0u0.github.io/PCR-TimeLineShift/)

## 功能

- **時間計算**：依據剩餘秒數自動平移時間軸。
- **邏輯過濾**：自動隱藏超時動作及其子項目。
- **狀態保存**：自動紀錄輸入與設定。
- **記憶管理**：可儲存多組刀並一鍵切換，支援新增、改名、複製、刪除；未命名的刀以第一行作為名稱。
- **圖片 OCR**：可上傳、貼上或拖曳圖片，自動辨識圖片中的文字；若目前的刀已有內容，辨識結果會存成新的一刀。
- **UI**：1:1 視窗對照，深色模式。

## OCR 備註

- OCR 模型採用 [PaddleOCRv5](https://www.paddleocr.ai/main/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html)，支援中、英、日文。
- 首次使用 OCR 需要下載模型檔(~85MiB)，下載速度與辨識速度會因設備而異。

## Vibe Coding

本專案為 Vibe Coding 產物。
建議後續維護或修改亦使用 Vibe Coding。
