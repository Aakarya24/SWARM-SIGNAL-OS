# simulator/publisher.py
import asyncio
import json
import random
import datetime
import websockets

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def random_plate():
    return f"KA{random.randint(1,99):02d}{random.choice(['AB','CD','EF','GH'])}{random.randint(1000,9999)}"

# Track overrides locally
active_overrides = {}

async def publisher():
    uri = "ws://localhost:8000/ws/publish"
    async with websockets.connect(uri) as ws:
        print("✅ Connected to backend publisher WebSocket")

        junctions = [
            {"id": "J1", "lat": 12.9716, "lon": 77.5946, "name": "1st & Main"},
            {"id": "J2", "lat": 12.9765, "lon": 77.5890, "name": "2nd & Park"},
            {"id": "J3", "lat": 12.9670, "lon": 77.5980, "name": "3rd & Lake"}
        ]

        while True:
            now = datetime.datetime.now(datetime.timezone.utc)

            for j in junctions:
                jid = j["id"]

                # Generate lanes
                lanes = {
                    "north": {"vehicles": random.randint(0, 25)},
                    "east": {"vehicles": random.randint(0, 25)},
                    "south": {"vehicles": random.randint(0, 25)},
                    "west": {"vehicles": random.randint(0, 25)},
                }
                for lane, data in lanes.items():
                    data["density_score"] = data["vehicles"]

                # Check if override is active
                if jid in active_overrides and active_overrides[jid]["end_time"] > now:
                    override = active_overrides[jid]
                    current_green = override["lane"]
                    phase_remaining = int((override["end_time"] - now).total_seconds())
                else:
                    # Normal AI logic
                    current_green = random.choice(list(lanes.keys()))
                    phase_remaining = random.randint(5, 30)

                    # RL suggestion: pick densest lane
                    dens_sorted = sorted(lanes.items(), key=lambda x: x[1]["density_score"], reverse=True)
                    suggested_lane = dens_sorted[0][0]
                    suggested_duration = max(10, min(60, dens_sorted[0][1]["density_score"] * 2))
                    rl_confidence = round(random.uniform(0.4, 0.98), 2)
                    rl_suggestion = {
                        "next_green": suggested_lane,
                        "duration": suggested_duration,
                        "confidence": rl_confidence,
                    }

                # Emergency + Violations
                emergency_vehicle = random.random() < 0.1
                violations = []
                if random.random() < 0.05:
                    violations.append({
                        "plate": random_plate(),
                        "lane": random.choice(list(lanes.keys())),
                        "time": now_iso()
                    })

                # Build msg
                msg = {
                    "type": "junction_update",
                    "junction_id": jid,
                    "name": j["name"],
                    "lat": j["lat"],
                    "lon": j["lon"],
                    "timestamp": now_iso(),
                    "lanes": lanes,
                    "current_green": current_green,
                    "phase_remaining": phase_remaining,
                    "rl_suggestion": rl_suggestion if 'rl_suggestion' in locals() else None,
                    "emergency_vehicle": emergency_vehicle,
                    "violations": violations,
                }

                await ws.send(json.dumps(msg))
                await asyncio.sleep(0.5)

            await asyncio.sleep(1.0)


# -------------------------------------------------
# Listener for overrides from backend
# -------------------------------------------------
async def override_listener():
    uri = "ws://localhost:8000/ws/dashboard"
    async with websockets.connect(uri) as ws:
        print("👂 Listening for overrides from backend...")
        async for msg in ws:
            data = json.loads(msg)
            if data.get("type") == "override":
                jid = data["junction_id"]
                lane = data["payload"]["lane"]
                duration = int(data["payload"]["duration"])
                end_time = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=duration)
                active_overrides[jid] = {"lane": lane, "end_time": end_time}
                print(f"⚡ Override received: {jid} → {lane} for {duration}s")


# -------------------------------------------------
# Run publisher + listener concurrently
# -------------------------------------------------
async def main():
    await asyncio.gather(
        publisher(),
        override_listener()
    )

if __name__ == "__main__":
    asyncio.run(main())
