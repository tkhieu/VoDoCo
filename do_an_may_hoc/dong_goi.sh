#!/usr/bin/env bash
# Build the submission archive nop_bai/DoAn_MayHoc_VietMedNER.zip.
# Checkpoints are included (symlinks are followed); raw data and the public XLM-R checkpoint are
# left out because the notebook downloads them from Hugging Face when missing.
set -euo pipefail
cd "$(dirname "$0")"

for required in checkpoints/phobert/config.json checkpoints/vihealthbert/config.json \
                results/model_comparison.json bao_cao/BaoCao_DoAn_MayHoc_VietMedNER.docx; do
  [[ -e "$required" ]] || { echo "Thiếu $required — chạy notebook và build báo cáo trước." >&2; exit 1; }
done

mkdir -p nop_bai
archive="nop_bai/DoAn_MayHoc_VietMedNER.zip"
rm -f "$archive"
zip -r -q "$archive" \
  VietMed_NER_MayHoc.ipynb requirements.txt \
  ket_qua_goc results notebooks_huan_luyen \
  bao_cao/BaoCao_DoAn_MayHoc_VietMedNER.docx bao_cao/build_docx.js \
  checkpoints/phobert checkpoints/vihealthbert \
  -x '*/.ipynb_checkpoints/*'
ls -lh "$archive"
