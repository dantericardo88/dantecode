#!/usr/bin/env bash
# =============================================================================
# packages/dante-trainer/scripts/quantize.sh
#
# Convert the fine-tuned dante-next-edit model to GGUF Q4_K_M format
# and register it with Ollama for local use.
#
# Prerequisites:
#   - llama.cpp cloned and built (see below)
#   - Ollama installed (https://ollama.ai)
#   - Model weights in ./dante-next-edit-v1/ (output of train.py)
#
# Usage:
#   chmod +x scripts/quantize.sh
#   bash scripts/quantize.sh [model_dir] [output_name]
#
# Arguments:
#   model_dir    Path to HuggingFace model directory (default: ./dante-next-edit-v1)
#   output_name  Ollama model name (default: dante-next-edit)
# =============================================================================

set -euo pipefail

MODEL_DIR="${1:-./dante-next-edit-v1}"
OLLAMA_NAME="${2:-dante-next-edit}"
GGUF_F16="${MODEL_DIR}/ggml-model-f16.gguf"
GGUF_Q4="${MODEL_DIR}/${OLLAMA_NAME}-q4_k_m.gguf"

echo "=== dante-next-edit GGUF Quantization ==="
echo "Input:  ${MODEL_DIR}"
echo "Output: ${GGUF_Q4}"
echo "Ollama: ${OLLAMA_NAME}"
echo

# ── Step 1: Clone and build llama.cpp if not present ─────────────────────────

if [ ! -d "llama.cpp" ]; then
  echo "[1/4] Cloning llama.cpp..."
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
  cd llama.cpp
  cmake -B build -DGGML_CUDA=ON 2>/dev/null || cmake -B build  # fallback: no CUDA
  cmake --build build --config Release -j "$(nproc)"
  cd ..
else
  echo "[1/4] llama.cpp already present, skipping clone."
fi

# ── Step 2: Convert HuggingFace model to GGUF F16 ────────────────────────────

echo "[2/4] Converting HuggingFace → GGUF F16..."
pip install -q gguf transformers sentencepiece
python llama.cpp/convert_hf_to_gguf.py \
  "${MODEL_DIR}" \
  --outtype f16 \
  --outfile "${GGUF_F16}"

echo "  Created: ${GGUF_F16}"

# ── Step 3: Quantize F16 → Q4_K_M ────────────────────────────────────────────

echo "[3/4] Quantizing F16 → Q4_K_M..."
./llama.cpp/build/bin/llama-quantize \
  "${GGUF_F16}" \
  "${GGUF_Q4}" \
  Q4_K_M

echo "  Created: ${GGUF_Q4}"

# ── Step 4: Register with Ollama ──────────────────────────────────────────────

echo "[4/4] Creating Ollama Modelfile and registering..."

MODELFILE_PATH="${MODEL_DIR}/Modelfile"
cat > "${MODELFILE_PATH}" << MODELFILE_EOF
FROM ${GGUF_Q4}

PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER num_predict 256
PARAMETER stop "<fim_prefix>"
PARAMETER stop "<fim_suffix>"
PARAMETER stop "<fim_middle>"
PARAMETER stop "<|endoftext|>"

SYSTEM """You are a next-edit prediction engine for code editors. Given a sequence of recent code edits and surrounding file context, predict the next edit location and content. Always respond with valid JSON in this exact format:
{"filePath":"<basename>","startLine":<number>,"endLine":<number>,"confidence":<0.0-1.0>,"diff":"<unified diff hunk>"}"""
MODELFILE_EOF

ollama create "${OLLAMA_NAME}" -f "${MODELFILE_PATH}"

echo
echo "=== Done ==="
echo "Model registered as: ${OLLAMA_NAME}"
echo
echo "Test it:"
echo "  ollama run ${OLLAMA_NAME} 'EDIT_HISTORY:[{\"filePath\":\"utils.ts\",\"startLine\":10,\"endLine\":10,\"oldText\":\"const x = 1\",\"newText\":\"const x = 2\",\"language\":\"typescript\"}]\n\nFILE_CONTEXT:\nfunction foo() { const y = x + 1; }'"
echo
echo "To enable speculative decode, also pull the draft model:"
echo "  ollama pull qwen2.5-coder:0.5b"
echo
echo "Then set in DanteCode settings:"
echo '  "dantecode.nextEditModel": "dante-next-edit"'
echo '  "dantecode.fimDraftModel": "qwen2.5-coder:0.5b"'
