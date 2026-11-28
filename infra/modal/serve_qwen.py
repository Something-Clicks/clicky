"""
Optional hosted GPU inference for the Clicky Marketing Agent: Qwen3-4B-Instruct-2507 behind an OpenAI-compatible vLLM endpoint on Modal.

This file is ONLY the model server. All orchestration stays in the Next.js app; the app reaches this endpoint through its existing
OpenAI-compatible provider (src/agent/providers/openai-compatible.ts) and falls back to the local model if it is unreachable.

Deploy (development):   MODAL_TOKEN_ID=... MODAL_TOKEN_SECRET=... modal deploy infra/modal/serve_qwen.py
Choose the GPU:         CLICKY_GPU=A10 modal deploy infra/modal/serve_qwen.py        (default L4)
App settings it needs:  MODAL_LLM_URL=<url printed by deploy>  (MODAL_TOKEN_SECRET is already set; the endpoint key is derived from it)

The endpoint requires `Authorization: Bearer <key>` where key = HMAC-SHA256(MODAL_TOKEN_SECRET, "clicky-llm-endpoint-v1") (hex). vLLM enforces it
via --api-key, so the endpoint is not open to the internet. Scales to zero after SCALEDOWN seconds idle, so idle time costs nothing.
Docs used: modal.com/docs/examples/vllm_inference, /docs/guide/webhooks (web_server), /docs/guide/webhook-timeouts (150 s HTTP limit, 303 follow-up).
"""
import hashlib
import hmac
import os
import subprocess

import modal

MODEL_NAME = "Qwen/Qwen3-4B-Instruct-2507"
MODEL_REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"  # pinned (huggingface.co/api/models/Qwen/Qwen3-4B-Instruct-2507)
SERVED_NAME = "qwen3-4b-instruct-2507"
GPU = os.environ.get("CLICKY_GPU", "L4")
SCALEDOWN = int(os.environ.get("CLICKY_SCALEDOWN_SECONDS", "300"))
PORT = 8000
MINUTES = 60

endpoint_key = hmac.new(os.environ.get("MODAL_TOKEN_SECRET", "unset").encode(), b"clicky-llm-endpoint-v1", hashlib.sha256).hexdigest()

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.21.0", "transformers==5.8.1")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)
hf_cache = modal.Volume.from_name("clicky-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("clicky-vllm-cache", create_if_missing=True)
app = modal.App("clicky-qwen")


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_dict({"VLLM_API_KEY": endpoint_key})],
    scaledown_window=SCALEDOWN,
    timeout=60 * MINUTES,  # the Function may run long; each HTTP request is limited to 150 s by Modal and continues via 303 redirects
    max_containers=1,  # cost cap: never more than one GPU at a time
)
@modal.concurrent(max_inputs=4)
@modal.web_server(PORT, startup_timeout=10 * MINUTES)
def serve():
    cmd = [
        "vllm", "serve", MODEL_NAME, "--revision", MODEL_REVISION, "--served-model-name", SERVED_NAME,
        "--host", "0.0.0.0", "--port", str(PORT), "--api-key", os.environ["VLLM_API_KEY"],
        "--max-model-len", "16384", "--gpu-memory-utilization", "0.90", "--uvicorn-log-level", "info",
    ]
    subprocess.Popen(cmd)
