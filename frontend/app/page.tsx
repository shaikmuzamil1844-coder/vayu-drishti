"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Shield, Activity } from "lucide-react";

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hudTime, setHudTime] = useState("");

  // Update HUD clock (UTC)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setHudTime(now.toISOString().replace("T", "  ").substring(0, 19) + " UTC");
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Earth Globe & Climate Flows Canvas Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Bounding coordinates of India for overlay positioning
    // Project coordinates onto the globe representation
    interface NetworkNode {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      glow: boolean;
    }

    const nodes: NetworkNode[] = [];
    const nodeCount = 40;
    
    // Create random floating network nodes for climate mesh
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 1,
        glow: Math.random() > 0.8
      });
    }

    // Cloud simulation variables
    let cloudOffset = 0;

    const draw = () => {
      // 1. Fill base dark blue background
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, w, h);

      // 2. Draw animated 3D-like Earth focused on India (centered at right side of viewport)
      const globeX = w * 0.7;
      const globeY = h * 0.5;
      const globeRadius = Math.min(w, h) * 0.38;

      // Subtle atmosphere outer glow
      const atmosphereGlow = ctx.createRadialGradient(globeX, globeY, globeRadius * 0.95, globeX, globeY, globeRadius * 1.25);
      atmosphereGlow.addColorStop(0, "rgba(0, 209, 255, 0.15)");
      atmosphereGlow.addColorStop(0.2, "rgba(20, 184, 166, 0.08)");
      atmosphereGlow.addColorStop(0.6, "rgba(2, 6, 23, 0.3)");
      atmosphereGlow.addColorStop(1, "rgba(2, 6, 23, 0)");
      ctx.fillStyle = atmosphereGlow;
      ctx.beginPath();
      ctx.arc(globeX, globeY, globeRadius * 1.3, 0, Math.PI * 2);
      ctx.fill();

      // Globe background mask (Dark space blue)
      ctx.fillStyle = "#040b1e";
      ctx.beginPath();
      ctx.arc(globeX, globeY, globeRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw faint latitude and longitude lines on the globe
      ctx.strokeStyle = "rgba(0, 209, 255, 0.08)";
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 9; i++) {
        // Latitudes (Horizontal ellipse proxies)
        const latOffset = (i - 5) * (globeRadius / 5);
        const latRad = Math.sqrt(globeRadius * globeRadius - latOffset * latOffset);
        ctx.beginPath();
        ctx.ellipse(globeX, globeY + latOffset, latRad, latRad * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Longitudes (Vertical ellipse proxies)
        ctx.beginPath();
        ctx.ellipse(globeX, globeY, globeRadius * 0.25 * i, globeRadius, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw India landmass abstract shape on the globe
      // We render a glowing polygon representing the subcontinent centered inside our globe
      ctx.shadowBlur = 15;
      ctx.shadowColor = "rgba(20, 184, 166, 0.4)";
      ctx.fillStyle = "rgba(20, 184, 166, 0.12)";
      ctx.strokeStyle = "rgba(20, 184, 166, 0.35)";
      ctx.lineWidth = 1.5;

      const indiaShape = [
        { dx: -0.12, dy: -0.55 }, // Kashmir
        { dx: 0.12, dy: -0.22 },  // NE boundary
        { dx: 0.18, dy: -0.05 },  
        { dx: 0.10, dy: 0.05 },   // Sundarbans
        { dx: 0.05, dy: 0.28 },   // East Coast
        { dx: -0.02, dy: 0.52 },  // South tip (Kanyakumari)
        { dx: -0.15, dy: 0.22 },  // West Coast
        { dx: -0.28, dy: 0.02 },  // Gujarat
        { dx: -0.22, dy: -0.25 }  // Rajasthan
      ];

      ctx.beginPath();
      indiaShape.forEach((pt, idx) => {
        const px = globeX + pt.dx * globeRadius;
        const py = globeY + pt.dy * globeRadius;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // 3. Draw moving atmospheric cloud layer overlays on the globe
      cloudOffset += 0.2;
      ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
      ctx.beginPath();
      // Draw dynamic cloud patches
      for (let j = 0; j < 5; j++) {
        const cx = globeX + Math.sin((cloudOffset + j * 40) * 0.01) * globeRadius * 0.6;
        const cy = globeY + Math.cos((cloudOffset + j * 50) * 0.01) * globeRadius * 0.4;
        ctx.arc(cx, cy, 35 + j * 12, 0, Math.PI * 2);
      }
      ctx.fill();

      // 4. Draw climate telemetry indicator nodes on India landmass
      const sensorPoints = [
        { dx: -0.05, dy: -0.35, val: "22.4", label: "DEL" }, // Delhi area
        { dx: -0.01, dy: 0.38, val: "26.1", label: "BLR" },  // Bengaluru area
        { dx: -0.14, dy: 0.18, val: "29.4", label: "BOM" },  // Mumbai area
        { dx: 0.06, dy: 0.03, val: "28.5", label: "CCU" }   // Kolkata area
      ];

      sensorPoints.forEach((pt) => {
        const sx = globeX + pt.dx * globeRadius;
        const sy = globeY + pt.dy * globeRadius;
        
        // Blink circle
        const pulse = Math.sin(cloudOffset * 0.05) * 4 + 5;
        ctx.fillStyle = "rgba(0, 209, 255, 0.15)";
        ctx.beginPath();
        ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#00D1FF";
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Label details
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.font = "8px monospace";
        ctx.fillText(`${pt.label}:${pt.val}°C`, sx + 6, sy + 3);
      });

      // 5. Draw connecting climate mesh nodes (Floating Network)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 0.5;

      nodes.forEach((n, idx) => {
        n.x += n.vx;
        n.y += n.vy;

        // Bounce
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;

        // Draw node
        ctx.fillStyle = n.glow ? "rgba(0, 209, 255, 0.3)" : "rgba(255, 255, 255, 0.12)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        ctx.fill();

        // Draw connections
        for (let j = idx + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dist = Math.hypot(n.x - m.x, n.y - m.y);
          if (dist < 120) {
            const alpha = (1 - dist / 120) * 0.05;
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
          }
        }
      });

      // 6. Draw clean dark cinematic gradient overlay covering the screen
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(2, 6, 23, 0.25)");
      grad.addColorStop(0.5, "rgba(2, 6, 23, 0.65)");
      grad.addColorStop(1, "rgba(2, 6, 23, 0.95)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col justify-between overflow-hidden bg-[#020617] selection:bg-teal-500/25 selection:text-white">
      {/* Background canvas rendering satellite Earth and meshes */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Top HUD Nav */}
      <header className="relative z-10 w-full flex items-center justify-between px-8 py-5 border-b border-white/[0.04] bg-[#020617]/25 backdrop-blur-[8px]">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" />
          <span className="font-mono text-xs tracking-[0.3em] text-white font-semibold">
            VAYU-DRISHTI // CLIMATE OS
          </span>
        </div>
        <div className="hidden md:flex items-center gap-6 font-mono text-[10px] text-slate-400">
          <span className="text-white/60">SYS // NOMINAL</span>
          <span className="text-white/60">REGION // IND-31X31</span>
          <span className="text-slate-200">{hudTime}</span>
        </div>
      </header>

      {/* Hero Content Area (Left aligned, clean Palantir style) */}
      <section className="relative z-10 flex-grow flex flex-col justify-center px-6 md:px-16 lg:px-24 py-16 max-w-4xl mr-auto text-left">
        <div className="fade-up">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.05] mb-8">
            <Globe className="w-3.5 h-3.5 text-teal-400" />
            <span className="font-mono text-[9px] tracking-wider text-slate-300 uppercase">ISRO climate digital twin framework</span>
          </div>

          <h1 className="text-5xl md:text-8xl font-bold tracking-tight text-white leading-[1.05] font-sans">
            India’s Climate
          </h1>
          <h2 className="text-2xl md:text-4xl text-slate-400 font-mono font-medium tracking-wide mt-4">
            Simulated. Predicted. Understood.
          </h2>

          <p className="mt-8 text-sm md:text-base text-slate-400 max-w-xl font-sans leading-relaxed">
            A high-fidelity climate intelligence platform. By integrating real-time INSAT satellite observations, historical IMD gridded telemetry, and deep-learning ConvLSTM models, VAYU-DRISHTI projects high-resolution atmospheric trajectories and simulates complex weather scenarios across India’s diverse geography.
          </p>
        </div>

        {/* Action buttons with Apple-style premium styling */}
        <div className="mt-12 flex flex-col sm:flex-row gap-4 items-start fade-up" style={{ animationDelay: "0.2s" }}>
          <Link href="/dashboard">
            <button className="flex items-center gap-2.5 px-8 py-3.5 rounded-full bg-white text-slate-950 font-mono text-[11px] font-bold tracking-wider hover:bg-slate-200 hover:shadow-[0_0_30px_rgba(255,255,255,0.15)] transition-all duration-300 transform hover:-translate-y-0.5 cursor-pointer group">
              LAUNCH DASHBOARD
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
            </button>
          </Link>
          <Link href="/dashboard">
            <button className="flex items-center gap-2 px-8 py-3.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-slate-200 font-mono text-[11px] tracking-wider hover:bg-white/[0.08] hover:text-white transition-all duration-300 cursor-pointer">
              EXPLORE TWIN
            </button>
          </Link>
        </div>

        {/* Live system indicators */}
        <div className="mt-20 grid grid-cols-3 gap-6 max-w-lg border-t border-white/[0.05] pt-8 fade-up" style={{ animationDelay: "0.4s" }}>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] text-slate-500 uppercase">Twin Engine</span>
            <span className="font-mono text-xs font-semibold text-white">Active (v1.0.0)</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] text-slate-500 uppercase">Input Latency</span>
            <span className="font-mono text-xs font-semibold text-teal-400">&lt; 1.5s Real-time</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] text-slate-500 uppercase">Target Grid</span>
            <span className="font-mono text-xs font-semibold text-white">IN_31x31_SUB</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 w-full flex flex-col md:flex-row items-center justify-between px-8 py-6 border-t border-white/[0.04] bg-[#020617]/50 backdrop-blur-[8px] select-none font-mono text-[9px] text-slate-500">
        <div>© 2026 VAYU-DRISHTI DIGITAL TWIN PORTAL. POWERED BY SATELLITE DATABASES.</div>
        <div className="mt-3 md:mt-0 flex gap-6">
          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> SECURE CONGESTION</span>
          <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> MODEL COMPUTING: NOMINAL</span>
        </div>
      </footer>
    </main>
  );
}
