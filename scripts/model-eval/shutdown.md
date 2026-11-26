# Shutdown and proof that compute stopped
1. Stop the server: Ctrl-C the `serve.sh` terminal (or `pkill -f "vllm serve"`); `nvidia-smi` should list no process.
2. Copy `eval-results/` off the box (it contains no customer data and no secrets), then `shred -u ~/.eval-token`.
3. In the provider's console, TERMINATE (not "stop" or "pause") the instance; delete attached volumes unless the owner wants the weights cached. Paused instances can still bill for disk.
4. Proof: screenshot or copy of the console showing no running instances and the final billed usage; write the real total into `docs/agents/EVALUATION_SPEND.md`.
5. If spend reaches $450, stop and ask; $500 is the hard cap.
