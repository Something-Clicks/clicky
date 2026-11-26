# Pinned candidates (verified against huggingface.co Nov 26 2026; see docs/agents/FIRST_RUN_CHECKLIST.md).
# Sourced by serve.sh. Revisions are exact commits; a changed repo is never used silently.
case "$1" in
  A) MODEL_REPO="Qwen/Qwen3.8-27B-FP8";                   MODEL_REV="c3a462cc3d38cf351f3b26cbd763469eeb74ef81"; MODEL_ID="qwen3.8-27b-fp8"
     SERVE_ARGS="--max-model-len 32768"
     EXTRA_BODY='{"chat_template_kwargs":{"enable_thinking":false}}' ;;
  B) MODEL_REPO="Qwen/Qwen3-30B-A3B-Instruct-2507-FP8";   MODEL_REV="5a5a776300a41aaa681dd7ff0106608ef2bc90db"; MODEL_ID="qwen3-30b-a3b-instruct-2507-fp8"
     SERVE_ARGS="--max-model-len 32768"
     EXTRA_BODY='' ;;
  C) MODEL_REPO="openai/gpt-oss-20b";                      MODEL_REV="6cee5e81ee83917806bbde320786a8fb61efebee"; MODEL_ID="gpt-oss-20b"
     SERVE_ARGS="--max-model-len 32768"
     EXTRA_BODY='' ;;   # reasoning level handling: confirm on first start (see checklist, open item)
  *) echo "usage: serve.sh A|B|C   (C needs the owner's usage-policy approval first)"; exit 2 ;;
esac
