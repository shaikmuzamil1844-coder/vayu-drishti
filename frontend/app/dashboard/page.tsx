/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Thermometer,
  CloudRain,
  ShieldAlert,
  Wind,
  Play,
  Pause,
  RotateCcw,
  Send,
  Cpu,
  Database,
  Sliders,
  Info,
  Terminal,
  Activity,
  ArrowLeft,
  Satellite,
  FileDown,
  Loader2,
  GitCompare,
  Radio,
} from "lucide-react";
import ClimateMap from "@/components/map/ClimateMap";
import StatCard from "@/components/telemetry/StatCard";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── TypeScript Interfaces ────────────────────────────────────────────────────

interface GridNode {
  id: number;
  lat: number;
  lon: number;
  temp: number;
  rain: number;
  humidity: number;
  wind_u: number;
  wind_v: number;
  heat_stress: number;
  risk_zone: string;
  // INSAT-specific fields (present when sensor_type === "satellite")
  insat_lst?: number;
  insat_sst?: number | null;
  insat_rain?: number;
  sensor?: string;
}

interface SummaryStats {
  avg_temp: number;
  max_temp: number;
  min_temp: number;
  avg_rain: number;
  total_rain: number;
  avg_humidity: number;
  avg_heat_stress: number;
  critical_alerts: number;
  warning_alerts: number;
  total_nodes: number;
}

interface ChatMessage {
  role: "user" | "model";
  content: string;
}

interface AdvisorySection {
  heading: string;
  body: string;
}

// ── Helper: risk zone colour ─────────────────────────────────────────────────
function riskBadge(zone: string) {
  if (zone === "CRITICAL") return "bg-red-500/10 border-red-500/30 text-red-400";
  if (zone === "WARNING")  return "bg-amber-500/10 border-amber-500/30 text-amber-400";
  if (zone === "LOW")      return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
  return "bg-slate-500/10 border-slate-500/30 text-slate-300";
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  // Climate Grid states
  const [grid, setGrid]               = useState<GridNode[]>([]);
  const [summary, setSummary]         = useState<SummaryStats | null>(null);
  const [selectedNode, setSelectedNode] = useState<GridNode | null>(null);

  // Controls
  const [activeOverlay, setActiveOverlay] = useState<"temp" | "rain" | "risk">("temp");
  const [dayOffset, setDayOffset]     = useState<number>(0);
  const [isPlaying, setIsPlaying]     = useState<boolean>(false);
  const playIntervalRef               = useRef<NodeJS.Timeout | null>(null);

  // Simulation Sliders
  const [tempDelta, setTempDelta]     = useState<number>(0);
  const [rainDelta, setRainDelta]     = useState<number>(0);
  const [droughtMode, setDroughtMode] = useState<boolean>(false);
  const [floodMode, setFloodMode]     = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // ── OPTION 2: What-If Comparison ─────────────────────────────────────────
  const [baselineSummary, setBaselineSummary] = useState<SummaryStats | null>(null);
  const [simSummary, setSimSummary]           = useState<SummaryStats | null>(null);

  // ── OPTION 3: PDF Export ──────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Copilot Chat
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "model", content: "### VAYU-DRISHTI AI Copilot Ready.\nAsk me about India's climate data, simulations, or localized anomalies." }
  ]);
  const [inputValue, setInputValue]   = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBottomRef                 = useRef<HTMLDivElement | null>(null);

  // HUD UTC Clock
  const [hudTime, setHudTime] = useState("");

  // Model + Data source status
  const [modelReady, setModelReady]   = useState(false);
  const [dataSource, setDataSource]   = useState("synthetic");
  const [sensorType, setSensorType]   = useState<"ground" | "satellite">("ground");

  // CNN Forecast data for chart
  const [forecastData, setForecastData] = useState<{name:string;temp:number;rain:number}[]>([]);

  // Canvas ref for background
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const backendUrl = "http://localhost:8000";

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setHudTime(now.toISOString().replace("T", "  ").substring(0, 19) + " UTC");
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Fetch baseline grid ───────────────────────────────────────────────────
  const fetchGridData = async (offset: number, sensor: "ground" | "satellite" = sensorType) => {
    try {
      const res = await fetch(`${backendUrl}/api/data?day_offset=${offset}&sensor_type=${sensor}`);
      if (res.ok) {
        const data = await res.json();
        setGrid(data.grid);
        setSummary(data.summary);
        setDataSource(data.data_source || "synthetic");
      } else {
        throw new Error("HTTP error");
      }
    } catch {
      generateLocalMockGrid(offset, tempDelta, rainDelta, droughtMode, floodMode);
      setDataSource("offline_mock");
    }
  };

  // Fetch forecast chart
  const fetchForecastChart = async (baseSummary: typeof summary) => {
    try {
      const res = await fetch(`${backendUrl}/api/predict`);
      if (res.ok) {
        const data = await res.json();
        setModelReady(data.model_ready || false);
        const p = data.predictions;
        setForecastData([
          { name: "Today", temp: baseSummary?.avg_temp ?? 28, rain: baseSummary?.avg_rain ?? 5 },
          { name: "T+1",  temp: p.T_1?.avg_temp  ?? 0, rain: p.T_1?.avg_rain  ?? 0 },
          { name: "T+7",  temp: p.T_7?.avg_temp  ?? 0, rain: p.T_7?.avg_rain  ?? 0 },
          { name: "T+30", temp: p.T_30?.avg_temp ?? 0, rain: p.T_30?.avg_rain ?? 0 },
        ]);
      }
    } catch { /* keep existing chart data */ }
  };

  // ── Local Mock Grid (offline fallback) ───────────────────────────────────
  const generateLocalMockGrid = (
    offset: number,
    tDel: number = 0, rDel: number = 0,
    drought: boolean = false, flood: boolean = false
  ) => {
    const mockGrid: GridNode[] = [];
    const size = 31;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const lat = 8.0 + (r / (size - 1)) * (37.0 - 8.0);
        const lon = 68.0 + (c / (size - 1)) * (97.0 - 68.0);
        const cellId = r * size + c;
        let baseTemp = 32.0 - 0.5 * (lat - 8.0);
        if (lat > 28.0 && lon > 74.0 && lon < 85.0) baseTemp -= 15.0;
        else if (lat > 32.0) baseTemp -= 20.0;
        if (lat > 24.0 && lat < 28.0 && lon > 68.0 && lon < 74.0) baseTemp += 5.0;
        let baseRain = 2.0;
        if (lat >= 8.0 && lat <= 20.0 && lon >= 72.0 && lon <= 75.0) baseRain += 15.0;
        else if (lat >= 22.0 && lat <= 28.0 && lon >= 88.0 && lon <= 97.0) baseRain += 20.0;
        else if (lat >= 24.0 && lat <= 28.0 && lon >= 68.0 && lon <= 74.0) baseRain = 0.1;
        const baseHum = (lon < 74.0 && lat < 20.0) || (lon > 80.0 && lat < 22.0) ? 80.0 : 50.0;
        const timeFactor = Math.sin(offset / 5.0);
        const noise = Math.sin(lat * 1.5 + offset) * 1.2;
        let temp = baseTemp + timeFactor * 1.5 + noise + tDel;
        let rain = Math.max(0.0, baseRain + timeFactor * 2.5 + noise * 1.5 + rDel);
        let humidity = Math.min(100.0, Math.max(10.0, baseHum + timeFactor * 5.0));
        if (drought) { temp += 1.8; rain *= 0.1; humidity *= 0.4; }
        if (flood)   { rain += 8.0; humidity = Math.min(100.0, humidity + 25.0); temp -= 1.0; }
        const heatStress = temp + 0.05 * humidity;
        let risk = "MODERATE";
        if (drought && temp > 35.0) risk = "CRITICAL";
        else if (flood && rain > 15.0) risk = "CRITICAL";
        else if (heatStress > 38.0 || rain > 22.0) risk = "CRITICAL";
        else if (heatStress > 34.0 || rain > 12.0) risk = "WARNING";
        else if (heatStress < 10.0) risk = "LOW";
        mockGrid.push({ id: cellId, lat, lon, temp: parseFloat(temp.toFixed(2)), rain: parseFloat(rain.toFixed(2)), humidity: parseFloat(humidity.toFixed(1)), wind_u: 3.0 + Math.sin(offset), wind_v: 4.0 + Math.cos(offset), heat_stress: parseFloat(heatStress.toFixed(2)), risk_zone: risk });
      }
    }
    setGrid(mockGrid);
    const temps    = mockGrid.map(n => n.temp);
    const rains    = mockGrid.map(n => n.rain);
    const hums     = mockGrid.map(n => n.humidity);
    const stresses = mockGrid.map(n => n.heat_stress);
    setSummary({
      avg_temp:        parseFloat((temps.reduce((a,b)=>a+b,0)/temps.length).toFixed(2)),
      max_temp:        parseFloat(Math.max(...temps).toFixed(2)),
      min_temp:        parseFloat(Math.min(...temps).toFixed(2)),
      avg_rain:        parseFloat((rains.reduce((a,b)=>a+b,0)/rains.length).toFixed(2)),
      total_rain:      parseFloat(rains.reduce((a,b)=>a+b,0).toFixed(1)),
      avg_humidity:    parseFloat((hums.reduce((a,b)=>a+b,0)/hums.length).toFixed(1)),
      avg_heat_stress: parseFloat((stresses.reduce((a,b)=>a+b,0)/stresses.length).toFixed(2)),
      critical_alerts: mockGrid.filter(n=>n.risk_zone==="CRITICAL").length,
      warning_alerts:  mockGrid.filter(n=>n.risk_zone==="WARNING").length,
      total_nodes:     mockGrid.length,
    });
  };

  // ── OPTION 2: Run What-If Simulation (capture baseline first) ────────────
  const handleRunSimulation = async () => {
    // Snapshot the current summary as baseline before running simulation
    if (summary) setBaselineSummary(summary);

    setIsSimulating(true);
    try {
      const query = `temp_delta=${tempDelta}&rain_delta=${rainDelta}&drought_mode=${droughtMode}&flood_mode=${floodMode}&sensor_type=${sensorType}`;
      const res = await fetch(`${backendUrl}/api/simulate?${query}`);
      if (res.ok) {
        const data = await res.json();
        setGrid(data.grid);
        setSummary(data.summary);
        setSimSummary(data.summary);     // capture post-simulation summary
      } else {
        throw new Error("Simulation HTTP failure");
      }
    } catch {
      generateLocalMockGrid(dayOffset, tempDelta, rainDelta, droughtMode, floodMode);
      // Capture local mock summary as simSummary too
      setSimSummary(summary);
    } finally {
      setTimeout(() => setIsSimulating(false), 1200);
    }
  };

  // Reset Simulation
  const handleResetSimulation = () => {
    setTempDelta(0); setRainDelta(0);
    setDroughtMode(false); setFloodMode(false);
    setBaselineSummary(null); setSimSummary(null);
    fetchGridData(dayOffset, sensorType);
  };

  // ── OPTION 3: Export Advisory PDF ────────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (!selectedNode) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({
        lat:         selectedNode.lat.toString(),
        lon:         selectedNode.lon.toString(),
        temp:        selectedNode.temp.toString(),
        rain:        selectedNode.rain.toString(),
        humidity:    selectedNode.humidity.toString(),
        heat_stress: selectedNode.heat_stress.toString(),
        risk_zone:   selectedNode.risk_zone,
        sensor_type: sensorType,
      });

      let sections: AdvisorySection[] = [];
      let generatedAt = new Date().toUTCString();
      let sensorLabel = sensorType === "satellite" ? "INSAT Satellite (LST/SST/3RIMG)" : "IMD Ground Station";
      let aiSource = "local_expert";

      try {
        const res = await fetch(`${backendUrl}/api/advisory?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          sections    = data.sections     || [];
          generatedAt = data.generated_at || generatedAt;
          sensorLabel = data.sensor_label || sensorLabel;
          aiSource    = data.ai_source    || aiSource;
        }
      } catch { /* use local fallback sections below */ }

      // If backend unreachable, build local sections
      if (sections.length === 0) {
        sections = [
          { heading: "Executive Summary",        body: `Advisory for Lat ${selectedNode.lat.toFixed(2)}°N / Lon ${selectedNode.lon.toFixed(2)}°E. Risk Zone: ${selectedNode.risk_zone}. Sensor: ${sensorLabel}.` },
          { heading: "Telemetry Snapshot",       body: `Temperature: ${selectedNode.temp}°C | Rainfall: ${selectedNode.rain} mm | Humidity: ${selectedNode.humidity}% | Heat Stress: ${selectedNode.heat_stress}` },
          { heading: "Agricultural Risk",        body: "Crop stress indices elevated. Recommend micro-irrigation activation in flagged districts. Monitor NDVI via INSAT 3DR." },
          { heading: "Disaster Advisory",        body: "Coordinate with SDMA for pre-positioning NDRF units in critical zones. Ensure early-warning communication systems are active." },
          { heading: "7-Day Outlook",            body: "ConvLSTM T+7 projection indicates continued anomaly. Activate threshold-based early-warning triggers at T+3 if trajectory confirmed." },
          { heading: "Recommended Actions",      body: "1. Share with district agricultural officers.\n2. Activate FASAL advisory services.\n3. Monitor INSAT 3D imagery at 6-hourly intervals.\n4. Issue mKisan SMS alerts to farmers." },
        ];
      }

      // Dynamically import jsPDF to keep bundle lean
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const pageW  = doc.internal.pageSize.getWidth();
      const margin = 18;
      const usableW = pageW - margin * 2;
      let y = 0;

      // ── Header band ─────────────────────────────────────────────────────
      doc.setFillColor(2, 6, 23);          // dark navy
      doc.rect(0, 0, pageW, 38, "F");

      doc.setFillColor(0, 209, 255);       // teal accent bar
      doc.rect(0, 38, pageW, 1.5, "F");

      doc.setTextColor(0, 209, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("VAYU-DRISHTI  //  CLIMATE DIGITAL TWIN", margin, 13);

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text("Climate Risk Advisory Report", margin, 23);

      doc.setTextColor(148, 163, 184);     // slate-400
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(`Generated: ${generatedAt}   |   AI Engine: ${aiSource.toUpperCase()}`, margin, 31);
      doc.text(`Sensor: ${sensorLabel}`, margin, 36);

      y = 50;

      // ── Coordinates + Risk badge ──────────────────────────────────────
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, y, usableW, 22, 3, 3, "F");

      doc.setTextColor(0, 209, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("GRID COORDINATES", margin + 4, y + 8);

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.text(`${selectedNode.lat.toFixed(2)}°N  /  ${selectedNode.lon.toFixed(2)}°E`, margin + 4, y + 17);

      // Risk zone pill
      const rz = selectedNode.risk_zone;
      const rzColor: [number,number,number] = rz === "CRITICAL" ? [239,68,68] : rz === "WARNING" ? [245,158,11] : rz === "LOW" ? [52,211,153] : [148,163,184];
      doc.setFillColor(...rzColor);
      doc.roundedRect(pageW - margin - 38, y + 5, 38, 12, 3, 3, "F");
      doc.setTextColor(2, 6, 23);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(rz, pageW - margin - 38 + 19, y + 13, { align: "center" });

      y += 28;

      // ── Telemetry Snapshot Table ──────────────────────────────────────
      doc.setTextColor(0, 209, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("TELEMETRY SNAPSHOT", margin, y + 6);
      y += 10;

      const metrics = [
        ["Temperature",  `${selectedNode.temp} °C`],
        ["Rainfall",     `${selectedNode.rain} mm`],
        ["Humidity",     `${selectedNode.humidity} %`],
        ["Heat Stress",  `${selectedNode.heat_stress}`],
        ["Wind U/V",     `${selectedNode.wind_u.toFixed(1)} / ${selectedNode.wind_v.toFixed(1)} m/s`],
      ];
      if (sensorType === "satellite") {
        if (selectedNode.insat_lst)  metrics.push(["INSAT LST",  `${selectedNode.insat_lst} °C`]);
        if (selectedNode.insat_sst)  metrics.push(["INSAT SST",  `${selectedNode.insat_sst} °C`]);
        if (selectedNode.insat_rain) metrics.push(["INSAT Rain", `${selectedNode.insat_rain} mm`]);
      }

      const colW = usableW / 2;
      metrics.forEach(([label, value], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = margin + col * colW;
        const cy = y + row * 10;
        if (col === 0) {
          doc.setFillColor(i % 4 < 2 ? 15 : 20, i % 4 < 2 ? 23 : 28, i % 4 < 2 ? 42 : 55);
          doc.rect(margin, cy, usableW, 10, "F");
        }
        doc.setTextColor(148, 163, 184);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(label, cx + 3, cy + 7);
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.text(value, cx + colW - 3, cy + 7, { align: "right" });
      });

      y += Math.ceil(metrics.length / 2) * 10 + 8;

      // ── Advisory Sections ─────────────────────────────────────────────
      for (const section of sections) {
        // Check page space
        if (y > 240) {
          doc.addPage();
          y = 18;
        }

        // Section heading bar
        doc.setFillColor(0, 209, 255, 0.12);
        doc.setFillColor(8, 28, 52);
        doc.rect(margin, y, usableW, 9, "F");
        doc.setFillColor(0, 209, 255);
        doc.rect(margin, y, 2, 9, "F");

        doc.setTextColor(0, 209, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(section.heading.toUpperCase(), margin + 5, y + 6.2);
        y += 12;

        // Section body (wrapped)
        doc.setTextColor(203, 213, 225);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.8);
        const lines = doc.splitTextToSize(section.body, usableW);
        lines.forEach((line: string) => {
          if (y > 270) { doc.addPage(); y = 18; }
          doc.text(line, margin, y);
          y += 5;
        });
        y += 5;
      }

      // ── Footer ────────────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages();
      for (let pg = 1; pg <= pageCount; pg++) {
        doc.setPage(pg);
        doc.setFillColor(2, 6, 23);
        doc.rect(0, 285, pageW, 12, "F");
        doc.setFillColor(0, 209, 255);
        doc.rect(0, 285, pageW, 0.8, "F");
        doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text("VAYU-DRISHTI Digital Twin  |  ISRO Climate Intelligence Framework  |  Confidential — For Official Use Only", margin, 291);
        doc.text(`Page ${pg} of ${pageCount}`, pageW - margin, 291, { align: "right" });
      }

      // Save PDF
      const filename = `vayu-drishti-advisory_${selectedNode.lat.toFixed(1)}N_${selectedNode.lon.toFixed(1)}E.pdf`;
      doc.save(filename);
    } finally {
      setIsExporting(false);
    }
  }, [selectedNode, sensorType, backendUrl]);

  // ── Timeline playback ────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setDayOffset((prev) => { if (prev >= 30) return -5; return prev + 1; });
      }, 1000);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [isPlaying]);

  // Refetch when timeline offset or sensor changes
  useEffect(() => {
    fetchGridData(dayOffset, sensorType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset, sensorType]);

  // Fetch forecast chart when summary loads for today
  useEffect(() => {
    if (summary && dayOffset === 0) fetchForecastChart(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, dayOffset]);

  // ── Background Canvas (geospatial grid / simulation mesh) ────────────────
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const handleResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener("resize", handleResize);
    interface MeshPoint { x:number; y:number; vx:number; vy:number; r:number; color:string; }
    const meshPoints: MeshPoint[] = [];
    for (let i = 0; i < 35; i++) {
      meshPoints.push({ x: Math.random()*w, y: Math.random()*h, vx:(Math.random()-0.5)*0.25, vy:(Math.random()-0.5)*0.25, r:Math.random()*1.5+0.5, color:Math.random()>0.6?"0, 209, 255":"20, 184, 166" });
    }
    let simulationPulse = 0;
    const render = () => {
      ctx.clearRect(0, 0, w, h);
      if (isSimulating) {
        simulationPulse += 0.05;
        ctx.strokeStyle = "rgba(0, 209, 255, 0.03)";
        ctx.lineWidth = 0.5;
        meshPoints.forEach((p, idx) => {
          p.x += p.vx * 2; p.y += p.vy * 2;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          const pRadius = p.r + Math.sin(simulationPulse + idx) * 0.5;
          ctx.fillStyle = `rgba(${p.color}, 0.25)`;
          ctx.beginPath(); ctx.arc(p.x, p.y, pRadius + 2, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = `rgba(${p.color}, 0.6)`;
          ctx.beginPath(); ctx.arc(p.x, p.y, pRadius, 0, Math.PI*2); ctx.fill();
          for (let j = idx+1; j < meshPoints.length; j++) {
            const m = meshPoints[j];
            const dist = Math.hypot(p.x-m.x, p.y-m.y);
            if (dist < 150) {
              const alpha = (1-dist/150)*0.08;
              ctx.strokeStyle = `rgba(${p.color}, ${alpha})`;
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.stroke();
            }
          }
        });
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.015)"; ctx.lineWidth = 1;
        const gridSize = 80;
        for (let x = 0; x < w; x += gridSize) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
        for (let y = 0; y < h; y += gridSize) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
        ctx.fillStyle = "rgba(0,209,255,0.05)";
        for (let x = gridSize; x < w; x += gridSize*2) {
          for (let y = gridSize; y < h; y += gridSize*2) { ctx.beginPath(); ctx.arc(x,y,1.2,0,Math.PI*2); ctx.fill(); }
        }
      }
      animId = requestAnimationFrame(render);
    };
    render();
    return () => { window.removeEventListener("resize", handleResize); cancelAnimationFrame(animId); };
  }, [isSimulating]);

  // ── Copilot Chat ─────────────────────────────────────────────────────────
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    const userMsg = inputValue.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInputValue("");
    setIsChatLoading(true);
    try {
      const historyPayload = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(`${backendUrl}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, history: historyPayload, selected_cell: selectedNode, sensor_type: sensorType })
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "model", content: data.response }]);
      } else throw new Error("Chat API failure");
    } catch {
      let reply = "I am ready. Ask me about temperature, rainfall, or water stress simulation in Karnataka.";
      const q = userMsg.toLowerCase();
      if (q.includes("karnataka") || q.includes("south"))
        reply = "### Karnataka LST Thermal Anomaly\n\nRecent INSAT LST data shows **+1.8°C** anomaly above Karnataka baseline. Deccan high-pressure subsidence is the primary driver.";
      else if (q.includes("drought") || q.includes("dry"))
        reply = "### Drought Vulnerability Diagnostic\n\nNorth-West India (Rajasthan/Gujarat) flagged under **High Drought Probability** for T+30.";
      else if (q.includes("flood") || q.includes("rain"))
        reply = "### Precipitation Anomaly\n\nMonsoon simulated triggers (+4mm rain) elevate coastal runoff to **35%** above normal, raising CRITICAL flood hazard indicators.";
      setMessages((prev) => [...prev, { role: "model", content: reply }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // ── Chart Data ───────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (forecastData.length > 0) return forecastData;
    if (!summary) return [];
    return [
      { name: "Today", temp: summary.avg_temp,                                           rain: summary.avg_rain },
      { name: "T+1",  temp: Math.round((summary.avg_temp + 0.2) * 10) / 10,             rain: Math.round((summary.avg_rain + 0.3) * 10) / 10 },
      { name: "T+7",  temp: Math.round((summary.avg_temp + 0.6) * 10) / 10,             rain: Math.round((summary.avg_rain + 1.2) * 10) / 10 },
      { name: "T+30", temp: Math.round((summary.avg_temp + 1.4) * 10) / 10,             rain: Math.round((summary.avg_rain - 0.5) * 10) / 10 },
    ];
  }, [summary, forecastData]);

  // ── OPTION 2: Comparison chart data ──────────────────────────────────────
  const comparisonData = useMemo(() => {
    if (!baselineSummary || !simSummary) return null;
    return [
      { metric: "Avg Temp",   baseline: baselineSummary.avg_temp,        sim: simSummary.avg_temp,        unit: "°C",   delta: +(simSummary.avg_temp - baselineSummary.avg_temp).toFixed(1) },
      { metric: "Avg Rain",   baseline: baselineSummary.avg_rain,        sim: simSummary.avg_rain,        unit: " mm",  delta: +(simSummary.avg_rain - baselineSummary.avg_rain).toFixed(1) },
      { metric: "Heat Stress",baseline: baselineSummary.avg_heat_stress, sim: simSummary.avg_heat_stress, unit: "",     delta: +(simSummary.avg_heat_stress - baselineSummary.avg_heat_stress).toFixed(1) },
      { metric: "Criticals",  baseline: baselineSummary.critical_alerts, sim: simSummary.critical_alerts, unit: " cells",delta: simSummary.critical_alerts - baselineSummary.critical_alerts },
    ];
  }, [baselineSummary, simSummary]);

  // ── OPTION 1: INSAT Satellite band legend data ───────────────────────────
  const insatBands = [
    { name: "LST",   label: "Land Surface Temp",       color: "#F59E0B", desc: "Diurnal skin temp, +3.4°C above air" },
    { name: "SST",   label: "Sea Surface Temp",        color: "#00D1FF", desc: "Thermal inertia buffer, -1.2°C" },
    { name: "3RIMG", label: "Microwave Rainfall (IMC)", color: "#34D399", desc: "Cloud-top proxy ×1.06 + 0.12 mm" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className={`min-h-screen flex flex-col justify-between overflow-hidden relative transition-colors duration-1000 ${
      isSimulating
        ? "bg-gradient-to-br from-[#020617] via-[#0a1020] to-[#020617]"
        : "bg-gradient-to-br from-[#020617] via-[#081226] to-[#030712]"
    } selection:bg-teal-500/25 selection:text-white`}>

      {/* Background canvas */}
      <canvas ref={bgCanvasRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Simulation glow */}
      {isSimulating && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-[20%] left-[20%] w-[350px] h-[350px] rounded-full bg-[#00D1FF]/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[30%] right-[20%] w-[450px] h-[450px] rounded-full bg-emerald-500/8 blur-[130px] animate-pulse" />
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/[0.04] bg-[#020617]/50 backdrop-blur-[12px] z-30 select-none">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-mono text-[9px] tracking-wider uppercase">Portal</span>
          </Link>
          <div className="h-4 w-[1.5px] bg-white/10" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isSimulating ? 'bg-teal-400 animate-spin' : 'bg-teal-500'}`} />
            <h1 className="font-mono text-xs tracking-[0.25em] font-semibold text-white uppercase">
              VAYU-DRISHTI // MET-INTELLIGENCE CENTER
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-6 font-mono text-[9px] text-slate-400">
          {/* OPTION 1: INSAT LIVE badge */}
          {sensorType === "satellite" && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 animate-pulse">
              <Satellite className="w-3 h-3 text-cyan-400" />
              <span className="text-cyan-400 font-bold tracking-widest text-[8px]">INSAT LIVE</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-teal-400" />
            <span className={modelReady ? "text-teal-400" : "text-slate-400"}>
              MODEL: {modelReady ? "CNN v2 ✓" : "SYNTHETIC"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className={dataSource.startsWith("npy") ? "text-emerald-400" : "text-slate-400"}>
              {dataSource.startsWith("npy") ? "IMD REAL DATA" : dataSource.startsWith("netcdf") ? "NETCDF" : "SYNTHETIC"}
            </span>
          </div>
          <div className="h-4 w-[1px] bg-white/[0.06]" />
          <span className="text-slate-200">{hudTime}</span>
        </div>
      </header>

      {/* ── Core Dashboard ──────────────────────────────────────────────────── */}
      <div className="flex-grow grid grid-cols-1 xl:grid-cols-12 gap-5 p-5 z-10 overflow-hidden">

        {/* Left Column: Scenario Simulator + Comparison Chart */}
        <section className="xl:col-span-3 flex flex-col gap-4">
          <div className="glass-card p-6 flex flex-col relative overflow-hidden bg-white/[0.02]">
            <div>
              <div className="flex items-center gap-2 border-b border-white/[0.05] pb-4 mb-5">
                <Sliders className="w-4 h-4 text-teal-400" />
                <h2 className="font-mono text-[11px] tracking-wider text-white font-bold uppercase">
                  Scenario Simulator
                </h2>
              </div>

              {/* Temp Delta */}
              <div className="mb-6">
                <div className="flex justify-between font-mono text-[9px] text-slate-400 mb-2">
                  <span>TEMPERATURE DELTA</span>
                  <span className={`font-semibold ${tempDelta > 0 ? 'text-red-400' : tempDelta < 0 ? 'text-teal-400' : 'text-white'}`}>
                    {tempDelta > 0 ? `+${tempDelta}` : tempDelta}°C
                  </span>
                </div>
                <input type="range" min="-5" max="5" step="0.5" value={tempDelta}
                  onChange={(e) => setTempDelta(parseFloat(e.target.value))} className="w-full cursor-pointer" />
                <div className="flex justify-between font-mono text-[7px] text-slate-500 mt-1">
                  <span>-5.0°C</span><span>NORMAL</span><span>+5.0°C</span>
                </div>
              </div>

              {/* Rain Delta */}
              <div className="mb-6">
                <div className="flex justify-between font-mono text-[9px] text-slate-400 mb-2">
                  <span>PRECIPITATION DELTA</span>
                  <span className={`font-semibold ${rainDelta > 0 ? 'text-teal-400' : rainDelta < 0 ? 'text-amber-500' : 'text-white'}`}>
                    {rainDelta > 0 ? `+${rainDelta}` : rainDelta} mm
                  </span>
                </div>
                <input type="range" min="-10" max="10" step="0.5" value={rainDelta}
                  onChange={(e) => setRainDelta(parseFloat(e.target.value))} className="w-full cursor-pointer" />
                <div className="flex justify-between font-mono text-[7px] text-slate-500 mt-1">
                  <span>-10.0 mm</span><span>NORMAL</span><span>+10.0 mm</span>
                </div>
              </div>

              {/* Simulation Preset Checkboxes */}
              <div className="mb-5 border-t border-white/[0.05] pt-5">
                <span className="font-mono text-[9px] text-slate-500 font-semibold block mb-3 uppercase">Simulation Overlays</span>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] cursor-pointer select-none transition-all">
                    <span className="font-mono text-[9px] text-slate-300">DROUGHT RUNTIME PRESET</span>
                    <input type="checkbox" checked={droughtMode} onChange={(e) => { setDroughtMode(e.target.checked); if (e.target.checked) setFloodMode(false); }}
                      className="rounded border-white/[0.08] bg-slate-950 text-teal-400 focus:ring-0 cursor-pointer w-3.5 h-3.5" />
                  </label>
                  <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] cursor-pointer select-none transition-all">
                    <span className="font-mono text-[9px] text-slate-300">FLOOD MATRIX SIMULATION</span>
                    <input type="checkbox" checked={floodMode} onChange={(e) => { setFloodMode(e.target.checked); if (e.target.checked) setDroughtMode(false); }}
                      className="rounded border-white/[0.08] bg-slate-950 text-teal-400 focus:ring-0 cursor-pointer w-3.5 h-3.5" />
                  </label>
                </div>
              </div>
            </div>

            {/* Run / Reset buttons */}
            <div className="flex flex-col gap-2">
              <button onClick={handleRunSimulation} disabled={isSimulating}
                className="w-full py-3 rounded-full bg-white text-slate-950 font-mono text-[10px] font-bold tracking-wider hover:bg-slate-200 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {isSimulating ? "COMPUTING MODEL METRIC..." : "RUN CLIMATE SIMULATION"}
              </button>
              <button onClick={handleResetSimulation}
                className="w-full py-2.5 rounded-full bg-transparent border border-white/[0.08] hover:border-white/[0.2] font-mono text-[9px] text-slate-400 hover:text-white transition-colors cursor-pointer">
                RESET OVERLAYS
              </button>
            </div>
          </div>

          {/* ── OPTION 2: What-If Comparison Chart Panel ────────────────────── */}
          <div className="glass-card p-5 relative overflow-hidden bg-white/[0.02]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.05] pb-3 mb-4">
              <GitCompare className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase">
                What-If Comparison
              </span>
            </div>

            {comparisonData ? (
              <>
                {/* Delta badges row */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {comparisonData.map((d) => (
                    <div key={d.metric} className={`p-2 rounded-xl border text-center ${
                      Math.abs(d.delta) === 0 ? "border-white/[0.06] bg-white/[0.02]" :
                      d.delta > 0 ? "border-red-500/20 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5"
                    }`}>
                      <div className="font-mono text-[7px] text-slate-500 mb-0.5">{d.metric}</div>
                      <div className={`font-mono text-xs font-bold ${
                        d.delta > 0 ? "text-red-400" : d.delta < 0 ? "text-emerald-400" : "text-slate-300"
                      }`}>
                        {d.delta > 0 ? `+${d.delta}` : d.delta}{d.unit}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bar chart: Baseline vs Simulated */}
                <div className="w-full h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} barCategoryGap="30%" barGap={2}>
                      <XAxis dataKey="metric" stroke="#475569" fontSize={7} tickLine={false} tick={{ fill: "#64748b" }} />
                      <YAxis stroke="#475569" fontSize={7} tickLine={false} axisLine={false} width={20} />
                      <Tooltip
                        contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", fontSize: "9px" }}
                        labelStyle={{ color: "#00D1FF", fontFamily: "monospace" }}
                        itemStyle={{ fontFamily: "monospace" }}
                      />
                      <Bar dataKey="baseline" name="Baseline (IMD)" radius={[3,3,0,0]}>
                        {comparisonData.map((_, i) => (
                          <Cell key={i} fill="rgba(148,163,184,0.3)" />
                        ))}
                      </Bar>
                      <Bar dataKey="sim" name="Simulated" radius={[3,3,0,0]}>
                        {comparisonData.map((entry, i) => (
                          <Cell key={i} fill={entry.delta > 0 ? "rgba(239,68,68,0.6)" : entry.delta < 0 ? "rgba(52,211,153,0.6)" : "rgba(99,102,241,0.6)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-4 font-mono text-[7px] text-slate-500 mt-1 select-none">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-slate-400/30 rounded-sm inline-block" />Baseline</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400/60 rounded-sm inline-block" />Simulated</span>
                </div>
              </>
            ) : (
              <div className="font-mono text-[9px] text-slate-500 py-8 text-center leading-relaxed">
                <GitCompare className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                Adjust sliders above and run<br />a simulation to compare<br />baseline vs. scenario trajectories.
              </div>
            )}
          </div>
        </section>

        {/* Center: Map + Stats */}
        <section className="xl:col-span-6 flex flex-col gap-4">

          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Average Temperature" value={summary ? `${summary.avg_temp}` : "--"} unit="°C" icon={Thermometer} colorClass="text-amber-500" subtext="Subcontinent Average" />
            <StatCard title="Rainfall Density"    value={summary ? `${summary.avg_rain}` : "--"} unit="mm" icon={CloudRain}   colorClass="text-teal-400"  subtext="Precipitation Index" />
            <StatCard title="Atmospheric Flow"    value={summary ? `${summary.avg_heat_stress}` : "--"} icon={Wind}         colorClass="text-emerald-400" subtext="Moisture Vector Flow" />
            <StatCard title="Critical Grid Cells" value={summary ? `${summary.critical_alerts}` : "--"} icon={ShieldAlert}  colorClass="text-red-500"    subtext="Alert coordinates" />
          </div>

          {/* Interactive Map */}
          <div className="relative flex-grow h-[460px] min-h-[400px]">
            <ClimateMap grid={grid} activeOverlay={activeOverlay} onNodeSelect={(node) => setSelectedNode(node)} />

            {/* Map Layer Selectors */}
            <div className="absolute top-4 left-4 p-1.5 rounded-full bg-slate-950/80 border border-white/[0.06] z-20 flex gap-1">
              <button onClick={() => setActiveOverlay("temp")} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-mono text-[9px] border transition-all ${activeOverlay==="temp" ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-transparent border-transparent text-slate-400 hover:text-white"}`}>
                <Thermometer className="w-3.5 h-3.5" />TEMPERATURE
              </button>
              <button onClick={() => setActiveOverlay("rain")} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-mono text-[9px] border transition-all ${activeOverlay==="rain" ? "bg-teal-500/10 border-teal-500/30 text-teal-400" : "bg-transparent border-transparent text-slate-400 hover:text-white"}`}>
                <CloudRain className="w-3.5 h-3.5" />PRECIPITATION
              </button>
              <button onClick={() => setActiveOverlay("risk")} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-mono text-[9px] border transition-all ${activeOverlay==="risk" ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-transparent border-transparent text-slate-400 hover:text-white"}`}>
                <ShieldAlert className="w-3.5 h-3.5" />RISK ALERTS
              </button>
            </div>

            {/* Sensor Source Selector */}
            <div className="absolute top-4 right-16 p-1.5 rounded-full bg-slate-950/80 border border-white/[0.06] z-20 flex gap-1">
              <button onClick={() => setSensorType("ground")} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-mono text-[9px] border transition-all ${sensorType==="ground" ? "bg-[#00D1FF]/10 border-[#00D1FF]/30 text-[#00D1FF]" : "bg-transparent border-transparent text-slate-400 hover:text-white"}`}>
                IMD GROUND
              </button>
              <button onClick={() => setSensorType("satellite")} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-mono text-[9px] border transition-all ${sensorType==="satellite" ? "bg-[#00D1FF]/10 border-[#00D1FF]/30 text-[#00D1FF]" : "bg-transparent border-transparent text-slate-400 hover:text-white"}`}>
                <Satellite className="w-3 h-3" />INSAT SATELLITE
              </button>
            </div>

            {/* ── OPTION 1: INSAT Band Legend ─────────────────────────────────── */}
            {sensorType === "satellite" && (
              <div className="absolute bottom-[80px] left-4 z-20 bg-slate-950/90 border border-cyan-500/20 rounded-2xl p-3 w-[220px] backdrop-blur-sm">
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] pb-2 mb-2.5">
                  <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                  <span className="font-mono text-[8px] tracking-widest text-cyan-400 font-bold uppercase">INSAT Active Bands</span>
                </div>
                <div className="flex flex-col gap-2">
                  {insatBands.map((band) => (
                    <div key={band.name} className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: band.color, boxShadow: `0 0 6px ${band.color}` }} />
                      <div>
                        <div className="font-mono text-[8px] font-bold text-white">{band.name} — {band.label}</div>
                        <div className="font-mono text-[7px] text-slate-500">{band.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-white/[0.05] font-mono text-[7px] text-slate-500">
                  Source: INSAT-3D/3DR  |  6-hourly composite
                </div>
              </div>
            )}
          </div>

          {/* Timeline Playback Bar */}
          <div className="glass-card p-4 flex flex-col md:flex-row items-center gap-4 relative overflow-hidden bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <button onClick={() => setIsPlaying(!isPlaying)} className="p-2.5 rounded-full bg-white text-slate-950 hover:bg-slate-200 transition-all cursor-pointer" title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-slate-950" /> : <Play className="w-3.5 h-3.5 fill-slate-950" />}
              </button>
              <button onClick={() => { setDayOffset(0); setIsPlaying(false); }} className="p-2.5 rounded-full bg-transparent border border-white/[0.08] text-slate-400 hover:text-white transition-all cursor-pointer" title="Reset to Today">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-grow w-full flex flex-col gap-1">
              <div className="flex justify-between font-mono text-[9px] text-slate-400 select-none">
                <span>HISTORICAL RECORDS (-5D)</span>
                <span className="font-bold text-white px-3 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
                  {dayOffset === 0 ? "OBSERVATION MODE (TODAY)" : dayOffset < 0 ? `PREVIOUS DAY ${dayOffset}` : `AI PREDICTED STATE (T+${dayOffset})`}
                </span>
                <span>FORECAST GRID (T+30D)</span>
              </div>
              <input type="range" min="-5" max="30" value={dayOffset}
                onChange={(e) => { setDayOffset(parseInt(e.target.value)); setIsPlaying(false); }}
                className="w-full cursor-pointer" />
            </div>
          </div>
        </section>

        {/* Right Column: Grid Readout + Forecast Chart + Chat */}
        <section className="xl:col-span-3 flex flex-col gap-4">

          {/* ── Grid Cell Readout + INSAT comparison ──────────────────────── */}
          <div className="glass-card p-5 relative overflow-hidden bg-white/[0.02]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.05] pb-3 mb-3">
              <Info className="w-3.5 h-3.5 text-teal-400" />
              <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase">
                Grid Cell Readout
              </span>
            </div>

            {selectedNode ? (
              <div className="font-mono text-[10px] text-slate-300 space-y-2">
                <div className="text-white font-bold text-xs pb-1 flex justify-between border-b border-white/[0.04]">
                  <span>CELL #{selectedNode.id}</span>
                  <span className="text-teal-400">{selectedNode.lat.toFixed(1)}°N / {selectedNode.lon.toFixed(1)}°E</span>
                </div>

                {/* Base fields */}
                <div className="flex justify-between"><span>Temperature:</span><span className="text-amber-400 font-bold">{selectedNode.temp} °C</span></div>
                <div className="flex justify-between"><span>Precipitation:</span><span className="text-teal-400 font-bold">{selectedNode.rain} mm</span></div>
                <div className="flex justify-between"><span>Atmosphere Humid:</span><span className="text-emerald-400">{selectedNode.humidity} %</span></div>
                <div className="flex justify-between"><span>Wind Speed (U, V):</span><span>{selectedNode.wind_u} u, {selectedNode.wind_v} v</span></div>
                <div className="flex justify-between border-t border-white/[0.05] pt-2 mt-2">
                  <span>Risk Quotient:</span>
                  <span className={`font-bold px-2 py-0.5 rounded-full text-[8px] border ${riskBadge(selectedNode.risk_zone)}`}>{selectedNode.risk_zone}</span>
                </div>

                {/* ── OPTION 1: INSAT comparison sub-panel ─────────────────── */}
                {sensorType === "satellite" && (selectedNode.insat_lst || selectedNode.insat_rain) && (
                  <div className="mt-3 pt-3 border-t border-cyan-500/20">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Satellite className="w-3 h-3 text-cyan-400" />
                      <span className="font-mono text-[8px] text-cyan-400 font-bold tracking-widest">INSAT SENSOR DIFF</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9px]">
                      <div className="col-span-2 grid grid-cols-3 text-[7px] text-slate-500 pb-1 border-b border-white/[0.04]">
                        <span>PARAMETER</span><span className="text-center">IMD</span><span className="text-right">INSAT</span>
                      </div>
                      {selectedNode.insat_lst !== undefined && (
                        <>
                          <span className="text-slate-400 col-span-1">LST Temp</span>
                          <div className="col-span-1 grid grid-cols-2 gap-1">
                            <span className="text-center text-slate-300">{selectedNode.temp}°C</span>
                            <span className="text-right text-amber-300 font-bold">{selectedNode.insat_lst}°C</span>
                          </div>
                        </>
                      )}
                      {selectedNode.insat_rain !== undefined && (
                        <>
                          <span className="text-slate-400 col-span-1">3RIMG Rain</span>
                          <div className="col-span-1 grid grid-cols-2 gap-1">
                            <span className="text-center text-slate-300">{(selectedNode.rain / 1.06).toFixed(1)}mm</span>
                            <span className="text-right text-cyan-300 font-bold">{selectedNode.insat_rain}mm</span>
                          </div>
                        </>
                      )}
                      {selectedNode.insat_sst != null && (
                        <>
                          <span className="text-slate-400 col-span-1">SST Temp</span>
                          <div className="col-span-1 grid grid-cols-2 gap-1">
                            <span className="text-center text-slate-300">—</span>
                            <span className="text-right text-blue-300 font-bold">{selectedNode.insat_sst}°C</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="mt-2 text-[7px] text-slate-500 font-mono">
                      Δ calibrated via INSAT-3D sensor model
                    </div>
                  </div>
                )}

                {/* ── OPTION 3: Export Advisory PDF button ──────────────────── */}
                <button
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 hover:border-violet-500/50 hover:text-violet-300 font-mono text-[9px] tracking-wider font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExporting ? (
                    <><Loader2 className="w-3 h-3 animate-spin" />GENERATING PDF...</>
                  ) : (
                    <><FileDown className="w-3 h-3" />EXPORT ADVISORY PDF</>
                  )}
                </button>
              </div>
            ) : (
              <div className="font-mono text-[9px] text-slate-500 py-6 text-center italic">
                Select coordinate point on the map<br />to readout localized telemetry data.
              </div>
            )}
          </div>

          {/* Forecast Trajectory Chart */}
          <div className="glass-card p-5 relative overflow-hidden bg-white/[0.02] flex flex-col justify-between max-h-[220px]">
            <div className="flex items-center justify-between border-b border-white/[0.05] pb-3 mb-3">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase">
                  {modelReady ? "CNN Forecast Trajectory" : "Forecast Trajectory"}
                </span>
              </div>
              {modelReady && (
                <span className="font-mono text-[7px] px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400">CNN MODEL</span>
              )}
            </div>
            <div className="w-full h-28 flex items-center justify-center">
              <LineChart width={250} height={110} data={chartData}>
                <XAxis dataKey="name" stroke="#475569" fontSize={8} tickLine={false} />
                <YAxis stroke="#475569" fontSize={8} width={15} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background:"#020617", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"10px", fontSize:"9px" }} labelStyle={{ color:"#00D1FF", fontFamily:"monospace" }} itemStyle={{ fontFamily:"monospace" }} />
                <Line type="monotone" dataKey="temp" stroke="#F59E0B" strokeWidth={1.5} dot={{ r:1.5 }} />
                <Line type="monotone" dataKey="rain" stroke="#00D1FF" strokeWidth={1.5} dot={{ r:1.5 }} />
              </LineChart>
            </div>
            <div className="flex justify-center gap-4 font-mono text-[8px] text-slate-500 mt-1 select-none">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#F59E0B] rounded-full" />Temp (°C)</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#00D1FF] rounded-full" />Rain (mm)</span>
            </div>
          </div>

          {/* AI Copilot Chat */}
          <div className="glass-card rounded-2xl relative overflow-hidden flex flex-col h-[280px] justify-between bg-white/[0.02]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-4 py-3 bg-white/[0.01]">
              <Terminal className="w-3.5 h-3.5 text-teal-400" />
              <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase">AI Copilot Terminal</span>
            </div>
            <div className="flex-grow p-4 overflow-y-auto font-sans text-[10px] space-y-3 scrollbar-thin scrollbar-thumb-white/[0.06]">
              {messages.map((msg, index) => (
                <div key={index} className={`flex flex-col gap-1 max-w-[90%] ${msg.role==="user" ? "ml-auto items-end" : "mr-auto items-start"}`}>
                  <span className="font-mono text-[7px] text-slate-500">{msg.role==="user" ? "USER // CMD" : "COPILOT // AI"}</span>
                  <div className={`p-3 rounded-2xl leading-relaxed border ${msg.role==="user" ? "bg-white/[0.05] border-white/[0.08] text-white" : "bg-[#020617]/60 border-white/[0.03] text-slate-300"}`}>
                    {msg.content.split("\n").map((line, idx) => (
                      <p key={idx} className="mb-1 last:mb-0">
                        {line.startsWith("###") ? (
                          <span className="text-white font-bold block mt-1 font-mono text-[10px] uppercase border-b border-white/[0.05] pb-1">{line.replace("###","")}</span>
                        ) : line.startsWith("**") ? (
                          <span className="text-white font-semibold">{line.replace(/\*\*/g,"")}</span>
                        ) : line}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="text-slate-500 font-mono text-[8px] animate-pulse">COPILOT COMPILING EXPLANATION METRICS...</div>
              )}
              <div ref={chatBottomRef} />
            </div>
            <form onSubmit={handleSendMessage} className="flex border-t border-white/[0.05] p-2 gap-2 bg-white/[0.01]">
              <input type="text" placeholder="Ask Climate Copilot..." value={inputValue} onChange={(e)=>setInputValue(e.target.value)} disabled={isChatLoading}
                className="flex-grow bg-slate-950 border border-white/[0.04] rounded-full px-4 py-2 font-sans text-[10px] text-white placeholder-slate-500 focus:outline-none focus:border-white/[0.15]" />
              <button type="submit" disabled={isChatLoading} className="p-2 rounded-full bg-white text-slate-950 hover:bg-slate-200 transition-colors disabled:opacity-50 flex items-center justify-center cursor-pointer">
                <Send className="w-3 h-3" />
              </button>
            </form>
          </div>

        </section>
      </div>
    </main>
  );
}
