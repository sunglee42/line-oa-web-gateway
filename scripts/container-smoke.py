"""Build-independent Docker smoke check. Run after building line-oa:test.

Uses an empty Docker volume and no Supervisor token or LINE session. Checks
health, lack of published ports, SIGTERM, restart and persistence. Never sends.
"""
import json
import subprocess
import uuid


def run(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


name = "line-oa-smoke-" + uuid.uuid4().hex[:12]
volume = name + "-data"
run("volume", "create", volume)
try:
    run("run", "-d", "--name", name, "-v", volume + ":/data", "line-oa:test")
    probe = """let ready=false;for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:8787/api/v1/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}if(!ready)process.exit(1)"""
    run("exec", name, "node", "--input-type=module", "-e", probe)
    details = json.loads(run("inspect", name))[0]
    assert not details["HostConfig"]["PortBindings"]
    identity = json.loads(run("exec", name, "node", "-e", "console.log(require('fs').readFileSync('/data/config.json','utf8'))"))["instanceId"]
    # Only source JS, public web and package metadata; no compiler or node_modules.
    run("exec", name, "node", "-e", "const fs=require('fs');for(const p of ['/app/node_modules','/app/dist/tests','/app/dist/scripts','/usr/local/bin/npm'])if(fs.existsSync(p))process.exit(1)")
    run("stop", "--time", "30", name)
    assert json.loads(run("inspect", name))[0]["State"]["ExitCode"] == 0
    run("start", name)
    run("exec", name, "node", "--input-type=module", "-e", probe)
    after = json.loads(run("exec", name, "node", "-e", "console.log(require('fs').readFileSync('/data/config.json','utf8'))"))["instanceId"]
    assert identity == after
    print("Docker smoke passed: health, private ports, graceful stop and stable identity")
finally:
    subprocess.run(["docker", "rm", "-f", name], check=False, capture_output=True)
    subprocess.run(["docker", "volume", "rm", volume], check=False, capture_output=True)
