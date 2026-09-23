#!/usr/bin/env bash
# Tạo môi trường .venv cho notebook NER_ViHealthBERT_RunAll.ipynb, dùng GPU NVIDIA qua PyTorch cu128.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo ">> Cài uv (trình quản lý Python) vào ~/.local/bin"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m ipykernel install --user --name vodoco-ner --display-name "VoDoCo NER (.venv)"

.venv/bin/python - <<'PY'
import torch
assert torch.cuda.is_available(), "CUDA không khả dụng — kiểm tra driver NVIDIA trên Windows và nvidia-smi trong WSL"
print("OK:", torch.__version__, "|", torch.cuda.get_device_name(0), "| arch", torch.cuda.get_arch_list())
PY
