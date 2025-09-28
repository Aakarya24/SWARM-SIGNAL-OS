import json
import datetime
from typing import Dict, Any, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow frontend (React) to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # change to ["http://localhost:5173"] for stricter setup
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store connected WebSocket clients
publish_clients: Set[WebSocket] = set()
dashboard_clients: Set[WebSocket] = set()

# Store latest junction states (like an in-memory DB)
junctions: Dict[str, Dict[str, Any]] = {}

# Broadcast helper
async def broadcast(message: str):
    """Send message to all connected dashboard clients."""
    dead_clients = []
    for client in dashboard_clients:
        try:
            await client.send_text(message)
        except Exception:
            dead_clients.append(client)
    for client in dead_clients:
        dashboard_clients.remove(client)


# -------------------------------------------------
# WebSocket for simulators/publishers
# -------------------------------------------------
@app.websocket("/ws/publish")
async def ws_publish(ws: WebSocket):
    await ws.accept()
    publish_clients.add(ws)
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "junction_update":
                jid = msg["junction_id"]
                junctions[jid] = msg  # update state
                # Broadcast update to dashboards
                await broadcast(json.dumps(msg))

    except WebSocketDisconnect:
        publish_clients.remove(ws)


# -------------------------------------------------
# WebSocket for dashboards (read-only)
# -------------------------------------------------
@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket):
    await ws.accept()
    dashboard_clients.add(ws)
    try:
        # Send a snapshot on connect
        snapshot = {
            "type": "snapshot",
            "junctions": list(junctions.values())
        }
        await ws.send_text(json.dumps(snapshot))

        while True:
            await ws.receive_text()  # keep alive, ignore any input
    except WebSocketDisconnect:
        dashboard_clients.remove(ws)


# -------------------------------------------------
# REST API for manual override
# -------------------------------------------------
@app.post("/api/junctions/{jid}/override")
async def override_junction(jid: str, payload: dict = Body(...)):
    """
    Apply manual override:
    - Set current_green = payload['lane']
    - Set phase_remaining = payload['duration']
    """
    lane = payload.get("lane")
    duration = int(payload.get("duration", 20))
    operator = payload.get("operator", "manual")
    reason = payload.get("reason", "Manual override")

    # Ensure junction exists
    if jid not in junctions:
        junctions[jid] = {"junction_id": jid}

    # Update state
    junctions[jid]["current_green"] = lane
    junctions[jid]["phase_remaining"] = duration
    junctions[jid]["override"] = {
        "operator": operator,
        "reason": reason,
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    # Build override event
    event = {
        "type": "override",
        "junction_id": jid,
        "payload": payload,
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

    # Broadcast override to all dashboards
    await broadcast(json.dumps(event))

    return {
        "status": "ok",
        "event": event,
        "applied_state": junctions[jid]
    }
