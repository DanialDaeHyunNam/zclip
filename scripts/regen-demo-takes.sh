#!/bin/bash
# Regenerate demo takes 2 & 3 with expression-hold engineering (~$0.80).
# Run when the Veo daily quota resets: bash scripts/regen-demo-takes.sh
# Requires the dev server running (default http://localhost:3001).
set -e
HOST="${1:-http://localhost:3001}"
CORE="A very pretty young East Asian woman in her early-to-mid 20s with a fresh natural look, clear realistic skin, long dark hair with soft balayage, soft natural makeup"
HOLD="Her face is frozen mid-reaction the entire time: eyes wide, lips parted, silently mouthing 'whaaaat?' in stunned quiet disbelief at her phone — she holds exactly this expression from the first frame to the last. She does not smile, she does not laugh, no gasping, no panting, no hand movements, minimal motion, slow and natural, with natural blinks and relaxed posture."
SUFFIX="Hyper-realistic, indistinguishable from real found iPhone footage: natural skin texture with visible pores, no beauty filter, no airbrushed smoothing, authentic unpolished UGC look, subtle handheld camera shake, slightly imperfect exposure, no cinematic color grading. Natural micro-expressions, natural blinking, relaxed lifelike body language. 3 seconds."
P2="Vertical 9:16 amateur front-camera selfie video, handheld iPhone. $CORE, cozy cream oversized cardigan, sitting on a city rooftop at dusk, two friends behind her chatting quietly while looking away at the skyline. $HOLD $SUFFIX"
P3="Vertical 9:16 amateur front-camera selfie video, handheld iPhone. $CORE, now wearing a chic black leather jacket over a white tee, sitting on the same city rooftop at dusk, the same two friends behind her chatting quietly while looking away at the skyline. $HOLD $SUFFIX"
gen() {
  local PROMPT="$1" OUT="$2"
  local JOB=$(curl -s -X POST "$HOST/api/generate" -H 'content-type: application/json' -d "$(python3 -c "import json,sys;print(json.dumps({'prompt':sys.argv[1],'provider':'veo','aspectRatio':'9:16','durationSeconds':4,'resolution':'720p'}))" "$PROMPT")")
  local JOBID=$(echo "$JOB" | python3 -c "import json,sys;print(json.load(sys.stdin).get('jobId',''))")
  echo "SUBMIT $OUT: ${JOBID:-FAILED}"; [ -z "$JOBID" ] && echo "$JOB" && exit 1
  for i in $(seq 1 40); do sleep 10
    local ST=$(curl -s "$HOST/api/status?id=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$JOBID")&provider=veo")
    local STATE=$(echo "$ST" | python3 -c "import json,sys;print(json.load(sys.stdin).get('state',''))")
    echo "  poll $i: $STATE"
    if [ "$STATE" = "done" ]; then
      local URL=$(echo "$ST" | python3 -c "import json,sys;print(json.load(sys.stdin)['videoUrl'])")
      curl -s "$HOST$URL" -o "$OUT"; return 0
    fi
    [ "$STATE" = "error" ] && echo "$ST" && exit 1
  done
}
gen "$P2" public/demo/take-2.mp4
gen "$P3" public/demo/take-3.mp4
echo "done — refresh the landing page."
