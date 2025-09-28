// App.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Legend
} from "recharts";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import "./App.css"; // optional styling file

function KPI({ label, value, small }) {
  return (
    <div style={{
      background: "#0f1724", color: "white",
      padding: 12, borderRadius: 8, minWidth: 140, textAlign: "center",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
    }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [junctions, setJunctions] = useState({});
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("AUTO");
  const [refreshRate, setRefreshRate] = useState(3);
  const [history, setHistory] = useState([]);
  const [violationsLog, setViolationsLog] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/dashboard");
    wsRef.current = ws;
    ws.onopen = () => console.log("WS connected");
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "snapshot" && msg.junctions) {
          const map = {};
          msg.junctions.forEach(j => map[j.junction_id] = j);
          setJunctions(map);
        } else if (msg.type === "junction_update") {
          setJunctions(prev => ({ ...prev, [msg.junction_id]: msg }));
          if (msg.violations && msg.violations.length) {
            setViolationsLog(prev => [...msg.violations, ...prev].slice(0, 200));
          }
        } else if (msg.type === "override") {
          console.log("Override event", msg);
        }
      } catch (e) {
        console.error("WS parse", e);
      }
    };
    ws.onclose = () => console.log("WS closed");
    return () => ws.close();
  }, []);

  const junctionArray = Object.values(junctions);
  const totalVehicles = junctionArray.reduce((sum, j) => {
    if (!j.lanes) return sum;
    return sum + Object.values(j.lanes).reduce((s, l) => s + (l.vehicles || 0), 0);
  }, 0);

  const avgLaneDensity = junctionArray.length > 0 ? (
    junctionArray.reduce((acc, j) => {
      if (!j.lanes) return acc;
      const avg = Object.values(j.lanes).reduce((s,l)=>(s+(l.density_score||0)),0) / Object.values(j.lanes).length;
      return acc + avg;
    }, 0) / junctionArray.length
  ).toFixed(1) : 0;

  const emergencyActive = junctionArray.some(j => j.emergency_vehicle === true) ? "YES" : "No";
  const violationsCount = violationsLog.length;

  useEffect(() => {
    const t = setInterval(() => {
      const stamp = new Date().toLocaleTimeString();
      setHistory(prev => {
        const next = [...prev.slice(-59), { time: stamp, avg: Number(avgLaneDensity) }];
        return next;
      });
    }, Math.max(1000, refreshRate * 1000));
    return () => clearInterval(t);
  }, [avgLaneDensity, refreshRate]);

  function getColorForJunction(j) {
    if (!j.lanes) return "#9CA3AF";
    const avg = Object.values(j.lanes).reduce((s,l)=>s+(l.density_score||0),0) / Object.values(j.lanes).length;
    if (avg < 15) return "#10B981";
    if (avg < 40) return "#F59E0B";
    return "#EF4444";
  }

  async function sendOverride(jid, lane) {
    let durationStr = prompt(`Force green for lane ${lane} (seconds):`, "20");
    if (!durationStr) return;
    const duration = Number(durationStr);
    const payload = { operator: "operator_1", lane, duration, reason: "Manual override from dashboard" };
    try {
      const res = await fetch(`http://localhost:8000/api/junctions/${jid}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      alert("Override sent: " + JSON.stringify(body.event || body));
    } catch (e) {
      alert("Failed to send override: " + e.message);
    }
  }

  function exportViolationsCSV() {
    if (!violationsLog.length) { alert("No violations to export"); return; }
    const header = "plate,lane,time\n";
    const rows = violationsLog.map(v => `${v.plate},${v.lane},${v.time}`).join("\n");
    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "violations.csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  function coloredIcon(hex) {
    return L.divIcon({
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${hex};border:2px solid white;"></div>`,
      className: ""
    });
  }

  const sel = selected ? junctions[selected] : null;

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Inter, Arial, sans-serif" }}>
      {/* Left Panel */}
      <div style={{
        width: 300,
        background: "#0f1724",
        color: "white",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}>
        <h2 style={{ margin: 0 }}>Controls</h2>

        <div>
          <label style={{ display: "block", marginBottom: 6 }}>Mode</label>
          <div>
            <label style={{ marginRight: 10 }}>
              <input type="radio" checked={mode==="AUTO"} onChange={()=>setMode("AUTO")} /> <b>AUTO (AI)</b>
            </label>
            <label>
              <input type="radio" checked={mode==="MANUAL"} onChange={()=>setMode("MANUAL")} /> <b>MANUAL</b>
            </label>
          </div>
        </div>

        <div>
          <label>Refresh rate (sec): {refreshRate}</label>
          <input type="range" min={1} max={10} value={refreshRate} onChange={(e)=>setRefreshRate(Number(e.target.value))} />
        </div>

        <div style={{ marginTop: 10 }}>
          <button onClick={() => { setSelected(null); setHistory([]); }} style={{ width: "100%", padding: 8 }}>Reset selection / clear graph</button>
        </div>

        <div style={{ marginTop: "auto", fontSize: 12, color: "#94A3B8" }}>
          <div>Connected junctions: {junctionArray.length}</div>
          <div style={{ marginTop: 6 }}>Tip: Click a marker on map or select from list to view lane details.</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* KPIs */}
        <div style={{ display: "flex", gap: 12, padding: 16, alignItems: "center", background: "#111827" }}>
          <div style={{ flex: 1, display: "flex", gap: 12 }}>
            <KPI label="Total Queue (veh)" value={totalVehicles} />
            <KPI label="Avg Lane Density" value={avgLaneDensity} />
            <KPI label="Emergency" value={emergencyActive} />
            <KPI label="Violations" value={violationsCount} />
          </div>
          <div style={{ width: 360, paddingLeft: 8 }}>
            <div style={{ color: "#94A3B8", fontSize: 12 }}>AI Performance (Avg density trend)</div>
            <div style={{ height: 60 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip />
                  <Line type="monotone" dataKey="avg" stroke="#60a5fa" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Map + Junction Detail */}
        <div style={{ display: "flex", flex: 1 }}>
          {/* Map */}
          <div style={{ width: "60%", height: "100%" }}>
            <MapContainer center={[12.9716, 77.5946]} zoom={13} style={{ height: "100%", width: "100%" }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              {junctionArray.map(j => (
                <Marker
                  key={j.junction_id}
                  position={[j.lat, j.lon]}
                  icon={coloredIcon(getColorForJunction(j))}
                  eventHandlers={{ click: () => setSelected(j.junction_id) }}>
                  <Popup>
                    <div style={{ minWidth: 200 }}>
                      <b>{j.name || j.junction_id}</b><br/>
                      Active: <b>{j.current_green || "N/A"}</b> ({j.phase_remaining ?? "-" }s)<br/>
                      AI next: <b>{j.rl_suggestion?.next_green || "-"}</b> for {j.rl_suggestion?.duration ?? "-"}s
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          {/* Right Panel */}
          <div style={{ width: "40%", padding: 14, overflowY: "auto", background: "#f8fafc", color: "#111827" }}>
            {/* Queue Lengths */}
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "6px 0" }}>Queue Lengths by Approach</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(selected ? [junctions[selected]] : junctionArray).map(j => {
                    if (!j) return { N:0, E:0, S:0, W:0, name: "No Data" };
                    const lanes = j.lanes || {};
                    return {
                      name: j.junction_id,
                      N: lanes.north?.vehicles || 0,
                      E: lanes.east?.vehicles || 0,
                      S: lanes.south?.vehicles || 0,
                      W: lanes.west?.vehicles || 0
                    };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="N" stackId="a" fill="#60a5fa" />
                    <Bar dataKey="E" stackId="a" fill="#1f9a6f" />
                    <Bar dataKey="S" stackId="a" fill="#f97316" />
                    <Bar dataKey="W" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Junction Details */}
            <div>
              <h3 style={{ margin: "6px 0" }}>Junction Details</h3>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <select value={selected || ""} onChange={(e) => setSelected(e.target.value || null)} style={{ width: "100%", padding: 8 }}>
                    <option value="">-- Select junction --</option>
                    {junctionArray.map(j => <option value={j.junction_id} key={j.junction_id}>{j.name || j.junction_id}</option>)}
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <button onClick={() => setSelected(null)} style={{ width: "100%" }}>Clear</button>
                </div>
              </div>

              {!selected && <div style={{ color: "#6b7280" }}>Select a junction to view lane-by-lane details and AI suggestions.</div>}

              {selected && (() => {
                const j = junctions[selected];
                if (!j) return <div>No data for selected junction</div>;
                const lanes = j.lanes || {};
                return (
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <b>{j.name || j.junction_id}</b><br/>
                      Active lane: <span style={{ fontWeight: 700, color: "green" }}>{j.current_green || "-"}</span> ({j.phase_remaining ?? "-"}s left)
                    </div>

                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                          <th>Lane</th><th>Vehicles</th><th>Density</th><th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {["north","east","south","west"].map(k => {
                          const lane = lanes[k] || { vehicles: 0, density_score: 0 };
                          const active = (j.current_green === k);
                          return (
                            <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={{ padding: 8 }}>{k.toUpperCase()}</td>
                              <td>{lane.vehicles}</td>
                              <td>{lane.density_score}</td>
                              <td>
                                {active ? <span style={{ color: "green", fontWeight: 700 }}>ACTIVE</span> :
                                  <button disabled={mode !== "MANUAL"} onClick={() => sendOverride(j.junction_id, k)} style={{ padding: "6px 10px" }}>
                                    Force Green
                                  </button>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div style={{ margin: "8px 0", padding: 8, background: "#fff", borderRadius: 6, color: "#111827" }}>
                      <div style={{ fontSize: 14, marginBottom: 6 }}><b>AI Suggestion</b></div>
                      <div>Next: <b>{j.rl_suggestion?.next_green || "-"}</b> for <b>{j.rl_suggestion?.duration || "-"}</b> s</div>
                      <div>Confidence: <b>{j.rl_suggestion?.confidence ?? "-"}</b></div>
                    </div>

                    {j.emergency_vehicle && <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", color: "#7f1d1d", borderRadius: 6 }}>
                      🚨 <b>Emergency detected!</b> Giving priority to emergency lane.
                    </div>}
                  </div>
                );
              })()}
            </div>

            {/* Violations */}
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: "6px 0" }}>Violations Log</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportViolationsCSV}>Export CSV</button>
                <div style={{ color: "#6b7280", alignSelf: "center" }}>{violationsLog.length} records</div>
              </div>
              <div style={{ maxHeight: 220, overflow: "auto", marginTop: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                      <th>Plate</th><th>Lane</th><th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violationsLog.map((v, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: 6 }}>{v.plate}</td>
                        <td>{v.lane}</td>
                        <td>{v.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
