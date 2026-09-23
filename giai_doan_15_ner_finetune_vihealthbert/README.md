# Giai đoạn 15 — NER model thứ ba: ViHealthBERT

`NER_ViHealthBERT_RunAll.ipynb` fine-tune `demdecuong/vihealthbert-base-syllable` trên `leduckhai/VietMed-NER`. Quy trình giống hệt notebook PhoBERT ở giai đoạn 13: cùng 18 cấu hình, 3 seed, cùng cách căn nhãn và cùng evaluator. Kết quả nhờ vậy đặt được cạnh XLM-RoBERTa và PhoBERT trong cùng một bảng.

| | XLM-RoBERTa-base | PhoBERT-base-v2 | ViHealthBERT-base-syllable |
|---|---|---|---|
| Pretrain | ~100 ngôn ngữ | Tiếng Việt, văn bản chung | Tiếng Việt, văn bản y tế |
| Câu hỏi nghiên cứu | Model đa ngôn ngữ có đủ tốt? | Model riêng cho tiếng Việt có hơn? | Pretrain thêm trên văn bản y tế có hơn nữa? |
| Tham số | ~277M | ~135M | ~134M |

## 1. Cài môi trường (một lần)

Yêu cầu: WSL2 hoặc Linux, driver NVIDIA đã cài trên Windows, lệnh `nvidia-smi` chạy được trong WSL.

```bash
cd giai_doan_15_ner_finetune_vihealthbert
./setup_env.sh
```

Script làm các bước sau:
1. Cài `uv` nếu máy chưa có.
2. Tạo `.venv` dùng Python 3.12.
3. Cài `torch==2.8.0` bản **cu128**. RTX 50xx (Blackwell, sm_120) bắt buộc cần CUDA 12.8 trở lên.
4. Cài các thư viện trong `requirements.txt`.
5. Đăng ký kernel Jupyter tên **VoDoCo NER (.venv)**.
6. In ra tên GPU để xác nhận đã nhận CUDA.

## 2. Train

```bash
cd giai_doan_15_ner_finetune_vihealthbert
.venv/bin/jupyter lab
```

Mở `NER_ViHealthBERT_RunAll.ipynb` và chọn kernel **VoDoCo NER (.venv)**.

1. **Chạy thử trước (khoảng 3 phút):** ở cell `# 1. Cấu hình`, đặt `SMOKE_TEST = True`, rồi chọn *Run → Run All Cells*. Kết quả được ghi vào `outputs/...-smoke` và `ketqua-smoke/`. F1 gần 0 là bình thường vì chỉ train 16 bước. Mục đích là xác nhận mọi cell chạy được.
2. **Chạy thật:** đặt lại `SMOKE_TEST = False`, *Restart Kernel and Run All*. Trên RTX 5060 Ti mất khoảng **45–60 phút**: mỗi epoch khoảng 20 giây, sweep có 108 epoch, 3 seed thêm tối đa 24 epoch. VRAM đỉnh khoảng 2 GB.
3. **Nếu bị ngắt giữa chừng:** chạy lại từ đầu. Cell train đọc `validation_trials.jsonl` và `best_config_seeds.jsonl`, rồi bỏ qua các trial đã xong.

Chạy nền không cần mở trình duyệt, log in ra terminal:

```bash
.venv/bin/jupyter nbconvert --to notebook --execute NER_ViHealthBERT_RunAll.ipynb \
  --ExecutePreprocessor.kernel_name=vodoco-ner --ExecutePreprocessor.timeout=-1 \
  --output NER_ViHealthBERT_RunAll.executed.ipynb
```

Theo dõi GPU trong lúc train: `watch -n 2 nvidia-smi`. Tiến trình python phải xuất hiện và cột GPU-Util phải cao.

**(Tuỳ chọn) Chấm lại PhoBERT trên cùng máy:** giải nén `phobert-best-seed.zip` (checkpoint seed 123, xem `services/inference/model-manifest.json`), rồi khởi động Jupyter với biến môi trường:

```bash
PHOBERT_CHECKPOINT=/đường/dẫn/seed_123_lr3e-05_ep8_wd0.05 .venv/bin/jupyter lab
```

Nếu không đặt biến này, notebook lấy số liệu PhoBERT từ `giai_doan_13_ner_finetune_phobert/ketqua/`.

## 3. Đọc kết quả

Tất cả file kết quả nằm trong `ketqua/`. Nên commit thư mục này. Checkpoint nằm trong `outputs/` và đã được gitignore.

| File | Nội dung | Dùng để |
|---|---|---|
| `validation_trials.jsonl` | 18 trial: lr, epoch, wd, F1 validation, thời gian, VRAM | Bảng/biểu đồ độ nhạy hyperparameter |
| `best_config_seeds.json` | Cấu hình tốt nhất, F1 validation của 3 seed, mean ± std, seed được chọn | Chứng minh kết quả ổn định giữa các seed |
| `ner_gold_comparison.json` | P/R/F1 trên test (3.497 câu) của cả 3 model, classification report theo từng loại entity, F1 test của 3 seed ViHealthBERT | **Số liệu chính của báo cáo** |
| `asr_ner_comparison.jsonl` / `_summary.json` | Entity của từng model trên 500 transcript Whisper, so với transcript chuẩn | Độ bền của NER khi đầu vào có lỗi ASR |
| `speed_benchmark.json` | Tham số, độ trễ p50/p95 (batch 1), thông lượng (batch 32), VRAM | So sánh chi phí triển khai |
| `comparison_table.md` | Gộp tất cả thành bảng markdown | Dán thẳng vào báo cáo |

Cách diễn giải từng chỉ số:

- **Val F1 (3 seed) mean ± std**: std nhỏ (dưới khoảng 0,5 điểm) nghĩa là kết quả ổn định. Nếu chênh lệch giữa hai model nhỏ hơn khoảng 2×std, không nên kết luận model nào tốt hơn.
- **Test P/R/F1 (micro)**: tính đúng như notebook PhoBERT, nên so trực tiếp được với con số 60,90% đã báo cáo. Recall cao hơn precision nghĩa là model đoán thừa entity.
- **Entity-only F1**: dataset dùng nhãn `"0"` (số không) thay cho `"O"`. Vì vậy seqeval coi các đoạn "không phải entity" là một loại entity tên `_` và tính vào micro F1. Cột Entity-only đổi `0 → O` nên chỉ tính entity y tế thật. **Nên đưa cả hai cột vào báo cáo và ghi chú lý do.** Số có dấu `≈` là số suy ra từ report đã lưu, không có checkpoint để tính lại.
- **Macro F1**: trung bình đều giữa các loại entity. Chỉ số này thấp hơn micro vì các loại hiếm như SURGERY, UNITCALIBRATOR, MEDDEVICETECHNIQUE kéo xuống. Bảng F1 theo loại entity cho thấy pretrain y tế giúp nhóm nào: kỳ vọng là DISEASESYMTOM, DRUGCHEMICAL, DIAGNOSTICS, TREATMENT.
- **Retention sau ASR**: tỉ lệ entity dự đoán trên transcript chuẩn mà vẫn được dự đoán lại trên transcript Whisper. Đây là **độ nhất quán, không phải recall gold**. Cả 3 model chạy trên cùng 500 transcript nên so sánh được.
- **Khoảng cách validation (~83%) và test (~61%)**: PhoBERT cũng bị như vậy. Nếu ViHealthBERT có khoảng cách tương tự, đó là đặc điểm của split test chứ không phải lỗi của model. Nên nêu rõ trong phần hạn chế.

## 4. Benchmark và đưa vào báo cáo

1. Lấy bảng tổng từ `ketqua/comparison_table.md` làm bảng chính trong chương thực nghiệm (3 model × P/R/F1/Macro/Entity-only/Retention).
2. Lấy bảng F1 theo loại entity và cột Δ ViHealthBERT − PhoBERT để trả lời câu hỏi "pretrain y tế giúp loại entity nào".
3. Lấy bảng hiệu năng để bàn về triển khai: XLM-R có khoảng gấp đôi tham số, thông lượng thấp hơn khoảng một nửa.
4. Lấy top 5 cấu hình validation để nói về độ nhạy hyperparameter. Có thể so với `giai_doan_13_ner_finetune_phobert/ketqua/validation_sweep.json`.
5. Kết luận dựa trên test F1 của seed được chọn theo validation, kèm mean ± std của 3 seed. **Không chọn seed theo test.**
