"""
Benchmark the deployed Modal endpoint against the CPU baseline. Usage:
  MODAL_LLM_URL=https://<workspace>--clicky-qwen-serve.modal.run MODAL_TOKEN_SECRET=... python infra/modal/benchmark.py [--cold]
Measures: time to first token, decode tokens/s (streamed), and a structured-JSON request like the agent's. Prints a JSON report; no secrets.
CPU baseline (this repo, 4-core CPU, llama.cpp Q4_K_M): ~3 output tokens/s; business_intelligence 673 s, marketing_analysis 897 s.
"""
import hashlib, hmac, json, os, sys, time, urllib.request

URL = os.environ["MODAL_LLM_URL"].rstrip("/")
KEY = hmac.new(os.environ["MODAL_TOKEN_SECRET"].encode(), b"clicky-llm-endpoint-v1", hashlib.sha256).hexdigest()
MODEL = "qwen3-4b-instruct-2507"

def post(path, body, stream=False):
    req = urllib.request.Request(f"{URL}{path}", data=json.dumps(body).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {KEY}"})
    return urllib.request.urlopen(req, timeout=900)

def stream_run(prompt, max_tokens):
    t0 = time.time(); first = None; n = 0
    with post("/v1/chat/completions", {"model": MODEL, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, "stream": True, "stream_options": {"include_usage": True}}) as r:
        for raw in r:
            line = raw.decode().strip()
            if not line.startswith("data: ") or line == "data: [DONE]": continue
            j = json.loads(line[6:])
            if j.get("choices") and j["choices"][0]["delta"].get("content") and first is None: first = time.time() - t0
            if j.get("usage"): n = j["usage"]["completion_tokens"]
    total = time.time() - t0
    return {"ttft_s": round(first or total, 2), "completion_tokens": n, "total_s": round(total, 2), "decode_tok_s": round(n / max(total - (first or 0), 1e-6), 1)}

report = {"endpoint": URL.split("//")[1].split(".")[0], "model": MODEL}
t0 = time.time()
report["first_request_s"] = None
try:
    report["streamed_run"] = stream_run("Write a 400-word marketing plan for a small plumbing company in Denver.", 700)
    report["first_request_s"] = round(time.time() - t0, 1)
    report["warm_streamed_run"] = stream_run("List ten website headline ideas for a dentist.", 300)
    t1 = time.time()
    with post("/v1/chat/completions", {"model": MODEL, "messages": [{"role": "user", "content": "Return JSON with keys industry and summary for: Summit Plumbing, 24/7 emergency plumbers in Denver."}], "response_format": {"type": "json_object"}, "max_tokens": 120}) as r:
        out = json.load(r)
    report["json_request_s"] = round(time.time() - t1, 2); report["json_valid"] = bool(json.loads(out["choices"][0]["message"]["content"]))
except Exception as e:
    report["error"] = f"{type(e).__name__}: {e}"
print(json.dumps(report, indent=2))
