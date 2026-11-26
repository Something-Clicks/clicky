#!/usr/bin/env bash
# Pipeline check ONLY: serve a small Apache-2.0 model on this machine's CPU so the app's real-inference path can be exercised.
# This is NOT one of the three evaluation candidates and proves nothing about their quality. No GPU, no rental, no cost.
# Localhost only, bearer token in $TOKEN_FILE (mode 600). Pins: llama.cpp b6850 (59fc1ec8), Qwen2.5-1.5B-Instruct-GGUF @ 91cad511
# (Apache 2.0 LICENSE file in the repo, sha256 832dd9e0…), q4_k_m weights sha256 6a1a2eb6….
set -euo pipefail
D="${LLM_DIR:-/opt/llm}"; mkdir -p "$D"; cd "$D"; umask 077
TOKEN_FILE="${TOKEN_FILE:-$D/token}"; [ -s "$TOKEN_FILE" ] || openssl rand -hex 24 > "$TOKEN_FILE"
if [ ! -x llama.cpp/build/bin/llama-server ]; then
  git clone -q --depth 1 --branch b6850 https://github.com/ggml-org/llama.cpp.git llama.cpp
  cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF -DGGML_NATIVE=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
  cmake --build llama.cpp/build --target llama-server -j "$(nproc)"
fi
M=qwen2.5-1.5b-instruct-q4_k_m.gguf
if [ ! -s "$M" ]; then
  curl -fL -o "$M" "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/$M"
fi
echo "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e  $M" | sha256sum -c -
exec ./llama.cpp/build/bin/llama-server -m "$M" --alias qwen2.5-1.5b-instruct-q4_k_m --host 127.0.0.1 --port 8091 \
  --api-key "$(cat "$TOKEN_FILE")" -c 16384 -t "$(nproc)" --parallel 1 --jinja
