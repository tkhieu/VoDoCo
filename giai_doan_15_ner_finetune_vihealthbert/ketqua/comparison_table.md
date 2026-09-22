# So sánh 3 model NER trên VietMed-NER/test (n=3497)

| Model                                       | Pretrain                    | Cấu hình chọn                      | Val F1 (3 seed)   |   Test P |   Test R |   Test F1 (micro) |   Test F1 (macro) | Entity-only F1 (micro)   |   Entity-only F1 (macro) |   Retention sau ASR |
|:--------------------------------------------|:----------------------------|:-----------------------------------|:------------------|---------:|---------:|------------------:|------------------:|:-------------------------|-------------------------:|--------------------:|
| XLM-RoBERTa-base (VietMed-NER, dùng sẵn)    | Đa ngôn ngữ (~100 ngôn ngữ) | —                                  | — (dùng sẵn)      |    51.83 |    62.79 |             56.79 |             48.73 | 58.65                    |                    48.41 |               52.79 |
| PhoBERT-base-v2 (nhóm fine-tune)            | Tiếng Việt, văn bản chung   | lr=3e-05, ep=8, wd=0.05, seed=123  | 83.44 ± 0.36      |    56.2  |    66.46 |             60.9  |             52.27 | ≈62.42                   |                    51.9  |               53.27 |
| ViHealthBERT-base-syllable (nhóm fine-tune) | Tiếng Việt, văn bản y tế    | lr=3e-05, ep=8, wd=0.01, seed=2024 | 83.16 ± 0.1       |    55.81 |    67.93 |             61.28 |             51.97 | 62.74                    |                    51.56 |               52.59 |

ViHealthBERT test F1 trên 3 seed: 60.97 ± 0.23 (chỉ để đo độ dao động; seed chính thức chọn theo validation).

Chênh lệch F1 micro ViHealthBERT − PhoBERT: +0.37 điểm phần trăm.

## F1 theo loại entity

|                    |   Support |   XLM-R F1 |   PhoBERT F1 |   ViHealthBERT F1 |   Δ ViHealthBERT − PhoBERT |
|:-------------------|----------:|-----------:|-------------:|------------------:|---------------------------:|
| DISEASESYMTOM      |      1467 |      61.42 |        62.2  |             66.9  |                       4.7  |
| ORGAN              |      1260 |      61.55 |        62.21 |             63.66 |                       1.45 |
| DRUGCHEMICAL       |       709 |      76.03 |        79.04 |             80.15 |                       1.11 |
| DATETIME           |       667 |      70.81 |        72.62 |             74.05 |                       1.43 |
| MEDDEVICETECHNIQUE |       635 |      14.29 |        19.84 |             24.78 |                       4.94 |
| AGE                |       622 |      62.72 |        69.55 |             68.9  |                      -0.65 |
| OCCUPATION         |       565 |      88.13 |        91.28 |             92.03 |                       0.75 |
| GENDER             |       558 |      52.46 |        77.9  |             72.1  |                      -5.8  |
| LOCATION           |       329 |      65.95 |        72.61 |             65.38 |                      -7.23 |
| DIAGNOSTICS        |       299 |      65.22 |        69.83 |             71.5  |                       1.67 |
| SURGERY            |       276 |      51.9  |        43.98 |             40.78 |                      -3.2  |
| FOODDRINK          |       261 |      68.36 |        69.4  |             69.96 |                       0.56 |
| UNITCALIBRATOR     |       257 |      35.69 |        38.15 |             38.53 |                       0.38 |
| TREATMENT          |       232 |      53.81 |        69.6  |             65.88 |                      -3.72 |
| PERSONALCARE       |        95 |      33.26 |        33.46 |             30.8  |                      -2.66 |
| ORGANIZATION       |        61 |       9.8  |         0    |              0    |                       0    |
| TRANSPORTATION     |        27 |       0    |         0    |              0    |                       0    |
| PREVENTIVEMED      |        18 |       0    |         2.48 |              2.64 |                       0.16 |

## Hiệu năng suy luận (GPU)

|                      |   params_millions |   weights_mb_fp32 |   avg_tokens_per_sentence |   latency_ms_p50 |   latency_ms_p95 |   throughput_sentences_per_s_bs32 |   peak_vram_mb | gpu                        |   num_sentences |
|:---------------------|------------------:|------------------:|--------------------------:|-----------------:|-----------------:|----------------------------------:|---------------:|:---------------------------|----------------:|
| xlm_roberta_baseline |           277.482 |          1058.51  |                   24.2567 |          3.43789 |          4.53916 |                           1670.15 |       1115.88  | NVIDIA GeForce RTX 5060 Ti |             300 |
| vihealthbert         |           134.436 |           512.833 |                   23.43   |          3.65179 |          4.4947  |                           2116.51 |        568.678 | NVIDIA GeForce RTX 5060 Ti |             300 |

## Top 5 cấu hình validation của ViHealthBERT

| trial                         |   val F1 |   giây |   VRAM GB |
|:------------------------------|---------:|-------:|----------:|
| validation_lr3e-05_ep8_wd0.01 |    83.34 | 150.3  |      2.03 |
| validation_lr3e-05_ep8_wd0.05 |    83.13 | 138.12 |      2.03 |
| validation_lr3e-05_ep6_wd0.01 |    82.29 | 143.03 |      2.03 |
| validation_lr3e-05_ep6_wd0.05 |    81.71 | 126.03 |      2.03 |
| validation_lr3e-05_ep4_wd0.05 |    78.93 | 102.43 |      2.03 |

Ghi chú: Test P/R/F1 giữ đúng cách chấm của notebook PhoBERT (nhãn '0' bị seqeval tính như entity loại '_'). Cột Entity-only đổi '0' → 'O' nên chỉ tính entity y tế thật; số có dấu ≈ được suy ra từ classification report đã lưu (micro lệch tối đa khoảng 1 điểm; macro chính xác). Đặt PHOBERT_CHECKPOINT để có số chính xác.

Retention là độ nhất quán giữa dự đoán trên transcript ASR và transcript chuẩn, không phải recall gold.
