/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// --- Constants ---
const G = 1.62; // Moon gravity
const THRUST_ACC = 18.0;
const ROT_SPEED = 5.5; // Increased for snappier rotation
const ROT_DAMP = 0.85;
const MAX_FUEL = 1000;
const FUEL_BURN = 15;
const WORLD_W = 2700;
const CANVAS_W = 900;
const CANVAS_H = 600;

const DIFF_SETTINGS = {
  easy: { SAFE_VY: 3.0, SAFE_VX: 2.0, SAFE_DEG: 15, OBSTACLES: 2 },
  medium: { SAFE_VY: 2.5, SAFE_VX: 1.5, SAFE_DEG: 12, OBSTACLES: 12 },
  hard: { SAFE_VY: 2.0, SAFE_VX: 1.0, SAFE_DEG: 8, OBSTACLES: 35 },
};

type Difficulty = 'easy' | 'medium' | 'hard';

interface LeaderboardEntry {
  id?: string;
  playerName: string;
  score: number;
  difficulty: Difficulty;
  timestamp: any;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  sz: number;
  col?: string;
}

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;
  drawFn: (ctx: CanvasRenderingContext2D) => void;
}

interface Pad {
  x1: number;
  x2: number;
  y: number;
  cx: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Terrain {
  pts: { x: number; y: number }[];
  pads: Pad[];
  obstacles: Obstacle[];
  N: number;
}

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;
  fuel: number;
  thrusting: boolean;
  dead: boolean;
  down: boolean;
}

interface GameStats {
  alt: number;
  vy: number;
  vx: number;
  tilt: number;
  fuel: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'landed' | 'crashed'>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [stats, setStats] = useState<GameStats>({ alt: 0, vy: 0, vx: 0, tilt: 0, fuel: 100 });
  const [result, setResult] = useState<{ ok: boolean; reason: string; score: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);

  // Game refs to avoid re-renders during the loop
  const shipRef = useRef<Ship>(mkShip());
  const terrainRef = useRef<Terrain>({ pts: [], pads: [], obstacles: [], N: 0 });
  const starsRef = useRef<any[]>(mkStars(250));
  const particlesRef = useRef<Particle[]>([]);
  const sparksRef = useRef<Particle[]>([]);
  const debrisRef = useRef<Debris[]>([]);
  const camXRef = useRef(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastTRef = useRef(0);

  function mkShip(): Ship {
    return {
      x: WORLD_W / 2,
      y: 50,
      vx: (Math.random() - 0.5) * 15,
      vy: 3,
      angle: 0,
      av: 0,
      fuel: MAX_FUEL,
      thrusting: false,
      dead: false,
      down: false,
    };
  }

  function mkStars(n: number) {
    return Array.from({ length: n }, () => ({
      x: Math.random() * WORLD_W,
      y: Math.random() * CANVAS_H,
      r: Math.random() * 1.4 + 0.2,
      b: Math.random() * 0.6 + 0.4,
      t: Math.random() * Math.PI * 2,
    }));
  }

  function mkTerrain(diff: Difficulty = 'medium'): Terrain {
    const N = 512;
    const ht = new Float32Array(N);
    ht[0] = CANVAS_H * 0.58;
    ht[N - 1] = CANVAS_H * 0.60;

    function subdiv(lo: number, hi: number, amp: number) {
      if (hi - lo <= 1) return;
      const mid = (lo + hi) >> 1;
      ht[mid] = (ht[lo] + ht[hi]) / 2 + (Math.random() - 0.5) * amp;
      subdiv(lo, mid, amp * 0.6);
      subdiv(mid, hi, amp * 0.6);
    }
    subdiv(0, N - 1, CANVAS_H * 0.52);

    for (let i = 0; i < N; i++) ht[i] = Math.max(CANVAS_H * 0.2, Math.min(CANVAS_H * 0.9, ht[i]));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < N - 1; i++) ht[i] = (ht[i - 1] + 2 * ht[i] + ht[i + 1]) / 4;
    }

    const pads: Pad[] = [];
    const usedRanges: { s: number; e: number }[] = [];
    for (let p = 0; p < 3; p++) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const pw = 15 + Math.floor(Math.random() * 12);
        const si = Math.floor(30 + Math.random() * (N - 60 - pw));
        if (usedRanges.some((r) => si > r.e + 25 || si + pw < r.s - 25)) continue;
        const ph = ht[si];
        for (let i = si; i <= si + pw; i++) ht[i] = ph;
        usedRanges.push({ s: si, e: si + pw });
        const xScale = WORLD_W / (N - 1);
        pads.push({ x1: si * xScale, x2: (si + pw) * xScale, y: ph, cx: (si + pw / 2) * xScale });
        break;
      }
    }

    const pts = Array.from({ length: N }, (_, i) => ({ x: i * (WORLD_W / (N - 1)), y: ht[i] }));
    
    // Generate obstacles
    const obstacles: Obstacle[] = [];
    const numObstacles = DIFF_SETTINGS[diff].OBSTACLES;
    const xScale = WORLD_W / (N - 1);
    
    for (let i = 0; i < numObstacles; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const w = 10 + Math.random() * 20;
        const h = 20 + Math.random() * 60;
        const x = 50 + Math.random() * (WORLD_W - 100);
        
        // Don't place on or too close to pads
        if (pads.some(p => x > p.x1 - 40 && x < p.x2 + 40)) continue;
        
        // Find terrain height at this x
        const f = (x / WORLD_W) * (N - 1);
        const lo = Math.floor(f);
        const y = ht[lo];
        
        obstacles.push({ x, y: y - h, w, h });
        break;
      }
    }

    return { pts, pads, obstacles, N };
  }

  function terrainYAt(wx: number) {
    const t = terrainRef.current;
    const f = (wx / WORLD_W) * (t.N - 1);
    const lo = Math.max(0, Math.min(t.N - 2, Math.floor(f)));
    const frac = f - lo;
    return t.pts[lo].y * (1 - frac) + t.pts[lo + 1].y * frac;
  }

  function padAt(wx: number) {
    return terrainRef.current.pads.find((p) => wx >= p.x1 && wx <= p.x2) || null;
  }

  function spawnDebris(s: Ship) {
    const addPart = (ox: number, oy: number, drawFn: (ctx: CanvasRenderingContext2D) => void) => {
      const c = Math.cos(s.angle), si = Math.sin(s.angle);
      const px = s.x + ox * c - oy * si;
      const py = s.y + ox * si + oy * c;
      const expForce = 8 + Math.random() * 25;
      const ang = Math.atan2(oy, ox) + s.angle + (Math.random() - 0.5);
      debrisRef.current.push({
        x: px, y: py,
        vx: s.vx * 0.6 + Math.cos(ang) * expForce,
        vy: s.vy * 0.6 + Math.sin(ang) * expForce,
        angle: s.angle,
        av: s.av + (Math.random() - 0.5) * 20,
        drawFn,
      });
    };

    // Capsule
    addPart(0, -6, (ctx) => {
      ctx.fillStyle = '#ccccdc'; ctx.strokeStyle = '#777799'; ctx.lineWidth = 0.5;
      rrect(ctx, -8, -7.5, 16, 15, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000d22'; ctx.beginPath(); ctx.ellipse(0, -1.5, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
    });
    // Base
    addPart(0, 8, (ctx) => {
      ctx.fillStyle = '#b0b0be'; ctx.strokeStyle = '#777799'; ctx.lineWidth = 0.5;
      rrect(ctx, -11, -5.5, 22, 11, 2); ctx.fill(); ctx.stroke();
    });
    // Legs
    addPart(-12, 10, (ctx) => {
      ctx.strokeStyle = '#7788aa'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(3, -5); ctx.lineTo(-3, 5); ctx.lineTo(-5, 5); ctx.stroke();
    });
    addPart(12, 10, (ctx) => {
      ctx.strokeStyle = '#7788aa'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(3, 5); ctx.lineTo(5, 5); ctx.stroke();
    });
  }

  function addExplosion(x: number, y: number) {
    const colors = ['#ff4400', '#ff8800', '#ffcc00', '#ffffff'];
    for (let i = 0; i < 100; i++) {
      const ang = Math.random() * Math.PI * 2, spd = 20 + Math.random() * 150;
      sparksRef.current.push({
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: 1, decay: 0.4 + Math.random() * 0.8, sz: 1 + Math.random() * 5, col: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      const entries: LeaderboardEntry[] = [];
      snapshot.forEach(doc => {
        entries.push({ id: doc.id, ...doc.data() } as LeaderboardEntry);
      });
      setLeaderboard(entries);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const submitScore = async () => {
    if (!playerName.trim() || !result || !result.ok || scoreSubmitted) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'leaderboard'), {
        playerName: playerName.trim().substring(0, 20),
        score: result.score,
        difficulty,
        timestamp: serverTimestamp()
      });
      setScoreSubmitted(true);
      fetchLeaderboard();
    } catch (error) {
      console.error("Error submitting score:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startGame = () => {
    terrainRef.current = mkTerrain(difficulty);
    shipRef.current = mkShip();
    particlesRef.current = [];
    sparksRef.current = [];
    debrisRef.current = [];
    camXRef.current = shipRef.current.x - CANVAS_W / 2;
    lastTRef.current = performance.now();
    setGameState('playing');
    setResult(null);
    setScoreSubmitted(false);
    setPlayerName('');
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore keystrokes if the user is typing in an input field
      if (e.target instanceof HTMLInputElement) return;

      keysRef.current[e.key.toLowerCase()] = e.type === 'keydown';
      if (e.type === 'keydown' && (e.key === 'r' || e.key === 'R')) startGame();
      if (e.type === 'keydown' && e.key === ' ' && gameState !== 'playing') startGame();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', handleKey);
    };
  }, [gameState, difficulty]);

  useEffect(() => {
    let frameId: number;
    const loop = (ts: number) => {
      const dt = Math.min((ts - lastTRef.current) / 1000, 0.05);
      lastTRef.current = ts;

      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      // --- Physics ---
      if (gameState === 'playing') {
        const s = shipRef.current;
        const keys = keysRef.current;

        const rl = keys['arrowleft'] || keys['a'];
        const rr = keys['arrowright'] || keys['d'];
        const thrust = keys['arrowup'] || keys['w'];
        const currentDeg = Math.min(Math.abs((s.angle * 180 / Math.PI) % 360), 360 - Math.abs((s.angle * 180 / Math.PI) % 360));

        s.av += ((rl ? -1 : 0) + (rr ? 1 : 0)) * ROT_SPEED * dt;
        s.av *= Math.pow(ROT_DAMP, dt * 60);
        s.angle += s.av * dt;

        s.thrusting = !!thrust && s.fuel > 0;
        if (s.thrusting) {
          s.vx += Math.sin(s.angle) * THRUST_ACC * dt;
          s.vy += -Math.cos(s.angle) * THRUST_ACC * dt;
          s.fuel = Math.max(0, s.fuel - FUEL_BURN * dt);
          // Exhaust
          for (let i = 0; i < 3; i++) {
            const ang = s.angle + Math.PI + (Math.random() - 0.5) * 0.4;
            const spd = 60 + Math.random() * 90;
            particlesRef.current.push({
              x: s.x + Math.sin(s.angle) * 15, y: s.y + Math.cos(s.angle) * 15,
              vx: Math.sin(ang) * spd + s.vx * 0.3, vy: -Math.cos(ang) * spd + s.vy * 0.3,
              life: 1, decay: 1.5 + Math.random() * 1.5, sz: 1.5 + Math.random() * 3
            });
          }
        }

        s.vy += G * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // Bounds
        if (s.x < 10) { s.x = 10; s.vx = Math.abs(s.vx) * 0.3; }
        if (s.x > WORLD_W - 10) { s.x = WORLD_W - 10; s.vx = -Math.abs(s.vx) * 0.3; }

        // Collision
        const probes = [[-9, 14], [0, 16], [9, 14], [-11, 3], [11, 3], [0, -11]];
        let contact = false;
        let contactX = s.x;
        let hitObstacle = false;
        
        for (const [ox, oy] of probes) {
          const c = Math.cos(s.angle), si = Math.sin(s.angle);
          const px = s.x + ox * c - oy * si;
          const py = s.y + ox * si + oy * c;
          
          if (py >= terrainYAt(px)) { contact = true; contactX = px; break; }
          
          // Check obstacles
          for (const obs of terrainRef.current.obstacles) {
            if (px >= obs.x - obs.w/2 && px <= obs.x + obs.w/2 && py >= obs.y && py <= obs.y + obs.h) {
              contact = true;
              contactX = px;
              hitObstacle = true;
              break;
            }
          }
          if (contact) break;
        }

        if (contact) {
          const finalVx = Math.abs(s.vx);
          const finalVy = Math.abs(s.vy);
          const pad = padAt(contactX);
          const limits = DIFF_SETTINGS[difficulty];

          // FREEZE STATS HERE
          setStats({
            alt: 0,
            vy: finalVy,
            vx: finalVx,
            tilt: currentDeg,
            fuel: (s.fuel / MAX_FUEL) * 100
          });

          if (pad && !hitObstacle && finalVy < limits.SAFE_VY && finalVx < limits.SAFE_VX && currentDeg < limits.SAFE_DEG) {
            s.down = true; s.vx = 0; s.vy = 0; s.av = 0;
            setGameState('landed');
            // Score multiplier based on difficulty
            const diffMult = difficulty === 'hard' ? 2.0 : difficulty === 'medium' ? 1.5 : 1.0;
            const score = Math.round((Math.max(0, 100 - (finalVy / limits.SAFE_VY) * 30 - (finalVx / limits.SAFE_VX) * 20) * 0.55 + (s.fuel / MAX_FUEL) * 45) * diffMult);
            setResult({ ok: true, reason: '', score });
          } else {
            s.dead = true;
            addExplosion(s.x, s.y);
            spawnDebris(s);
            setGameState('crashed');
            const why = hitObstacle ? 'HIT OBSTACLE' :
              !pad ? 'MISSED LANDING PAD' :
              currentDeg >= limits.SAFE_DEG ? `TILT ${currentDeg.toFixed(1)}° > ${limits.SAFE_DEG}°` :
                finalVy >= limits.SAFE_VY ? `VERT ${finalVy.toFixed(2)} m/s > ${limits.SAFE_VY.toFixed(1)}` :
                  `HORIZ ${finalVx.toFixed(2)} m/s > ${limits.SAFE_VX.toFixed(1)}`;
            setResult({ ok: false, reason: why, score: 0 });
          }
        }

        // Camera
        const tx = s.x - CANVAS_W / 2;
        camXRef.current += (tx - camXRef.current) * 0.1;
        camXRef.current = Math.max(0, Math.min(WORLD_W - CANVAS_W, camXRef.current));

        // Update HUD during flight
        const gY = terrainYAt(s.x);
        
        setStats({
          alt: Math.max(0, gY - s.y - 14),
          vy: Math.abs(s.vy),
          vx: Math.abs(s.vx),
          tilt: currentDeg,
          fuel: (s.fuel / MAX_FUEL) * 100
        });
      }

      // --- Rendering ---
      ctx.fillStyle = '#000008'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Stars
      starsRef.current.forEach(s => {
        const tw = 0.6 + 0.4 * Math.sin(ts * 0.0008 + s.t);
        const sx = ((s.x - camXRef.current * 0.2) + WORLD_W * 5) % CANVAS_W;
        ctx.beginPath(); ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.b * tw})`; ctx.fill();
      });

      // Terrain
      ctx.save(); ctx.translate(-camXRef.current, 0);
      const g = ctx.createLinearGradient(0, CANVAS_H * 0.3, 0, CANVAS_H);
      g.addColorStop(0, '#1a1a2e'); g.addColorStop(1, '#0a0a1a');
      ctx.beginPath(); ctx.moveTo(terrainRef.current.pts[0].x, terrainRef.current.pts[0].y);
      terrainRef.current.pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(WORLD_W, CANVAS_H + 50); ctx.lineTo(0, CANVAS_H + 50); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#5555aa'; ctx.lineWidth = 2; ctx.stroke();

      // Pads
      terrainRef.current.pads.forEach(pad => {
        ctx.fillStyle = '#00ffcc33'; ctx.fillRect(pad.x1, pad.y - 4, pad.x2 - pad.x1, 8);
        ctx.fillStyle = '#00ffcc'; ctx.fillRect(pad.x1, pad.y - 1, pad.x2 - pad.x1, 3);
      });

      // Obstacles
      terrainRef.current.obstacles.forEach(obs => {
        ctx.fillStyle = '#11111a';
        ctx.fillRect(obs.x - obs.w/2, obs.y, obs.w, obs.h);
        ctx.strokeStyle = '#333344';
        ctx.strokeRect(obs.x - obs.w/2, obs.y, obs.w, obs.h);
        
        // Blinking red light on top
        if (Math.floor(ts / 500) % 2 === 0) {
          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(obs.x, obs.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.restore();

      // Particles
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      particlesRef.current.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
        const a = Math.max(0, p.life);
        ctx.beginPath(); ctx.arc(p.x - camXRef.current, p.y, p.sz * a, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,150,255,${a * 0.6})`; ctx.fill();
      });

      // Sparks
      sparksRef.current = sparksRef.current.filter(p => p.life > 0);
      sparksRef.current.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += G * dt * 40; p.life -= p.decay * dt;
        const a = Math.max(0, p.life);
        ctx.beginPath(); ctx.arc(p.x - camXRef.current, p.y, p.sz * a, 0, Math.PI * 2);
        ctx.fillStyle = p.col || '#fff'; ctx.fill();
      });

      // Debris
      debrisRef.current.forEach(d => {
        d.vy += G * dt * 6; d.x += d.vx * dt; d.y += d.vy * dt; d.angle += d.av * dt;
        const ty = terrainYAt(d.x);
        if (d.y > ty - 2) {
          d.y = ty - 2; d.vy = -d.vy * 0.4; d.vx *= 0.7; d.av *= 0.6;
        }
        ctx.save(); ctx.translate(d.x - camXRef.current, d.y); ctx.rotate(d.angle); d.drawFn(ctx); ctx.restore();
      });

      // Ship
      if (!shipRef.current.dead) {
        const s = shipRef.current;
        ctx.save(); ctx.translate(s.x - camXRef.current, s.y); ctx.rotate(s.angle);
        // Ship drawing logic...
        ctx.fillStyle = '#b0b0be'; ctx.strokeStyle = '#777799'; ctx.lineWidth = 0.5;
        rrect(ctx, -11, 3, 22, 11, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ccccdc'; rrect(ctx, -8, -11, 16, 15, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#000d22'; ctx.beginPath(); ctx.ellipse(0, -5, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7788aa'; ctx.lineWidth = 1.5;
        [[-9, 5, -15, 15, -17, 15], [9, 5, 15, 15, 17, 15]].forEach(([x1, y1, x2, y2, x3, y3]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
        });
        ctx.restore();
      }

      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [gameState]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-[#00ffcc] font-mono overflow-hidden">
      <div className="relative w-[900px] h-[600px] border border-[#00ffcc22] shadow-2xl">
        <canvas ref={canvasRef} width={900} height={600} className="bg-[#000008]" />

        {/* HUD */}
        {gameState !== 'menu' && (
          <div className="absolute inset-0 pointer-events-none p-4">
            <div className="absolute top-4 left-4 bg-black/80 border border-[#00ffcc33] p-3 min-w-[160px] backdrop-blur-sm">
              <div className="text-[9px] uppercase tracking-widest opacity-50">Altitude</div>
              <div className="text-lg font-bold">{stats.alt.toFixed(0)} m</div>
              <div className="mt-2 text-[9px] uppercase tracking-widest opacity-50">Vert Speed</div>
              <div className={`text-lg font-bold ${stats.vy >= DIFF_SETTINGS[difficulty].SAFE_VY ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                {stats.vy.toFixed(2)} m/s
              </div>
              <div className="mt-2 text-[9px] uppercase tracking-widest opacity-50">Horiz Speed</div>
              <div className={`text-lg font-bold ${stats.vx >= DIFF_SETTINGS[difficulty].SAFE_VX ? 'text-orange-500' : 'text-[#00ffcc]'}`}>
                {stats.vx.toFixed(2)} m/s
              </div>
            </div>

            <div className="absolute top-4 right-4 bg-black/80 border border-[#00ffcc33] p-3 min-w-[160px] text-right backdrop-blur-sm">
              <div className="text-[9px] uppercase tracking-widest opacity-50">Fuel</div>
              <div className={`text-lg font-bold ${stats.fuel < 20 ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                {stats.fuel.toFixed(0)}%
              </div>
              <div className="w-full h-1 bg-[#00ffcc11] mt-1 border border-[#00ffcc33]">
                <div className="h-full bg-gradient-to-r from-red-500 to-[#00ffcc]" style={{ width: `${stats.fuel}%` }} />
              </div>
              <div className="mt-2 text-[9px] uppercase tracking-widest opacity-50">Tilt</div>
              <div className={`text-lg font-bold ${stats.tilt > DIFF_SETTINGS[difficulty].SAFE_DEG ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                {stats.tilt.toFixed(1)}°
              </div>
            </div>

            <div className="absolute bottom-4 left-4 text-[10px] opacity-40">
              SAFE: VY &lt; {DIFF_SETTINGS[difficulty].SAFE_VY.toFixed(1)} · VX &lt; {DIFF_SETTINGS[difficulty].SAFE_VX.toFixed(1)} · TILT &lt; {DIFF_SETTINGS[difficulty].SAFE_DEG}°
            </div>
          </div>
        )}

        {/* Overlays */}
        {(gameState === 'menu' || result) && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center text-center p-8">
            <h1 className="text-6xl font-black tracking-[0.2em] text-white drop-shadow-[0_0_20px_#00ffcc]">LUNAR</h1>
            <p className="text-xs tracking-[0.5em] text-[#00ffcc88] mb-12">D E S C E N T</p>

            {result ? (
              <div className="mb-8 w-full max-w-md">
                <h2 className={`text-4xl font-bold mb-2 ${result.ok ? 'text-green-400' : 'text-red-500'}`}>
                  {result.ok ? '✓ TOUCHDOWN' : '✗ CRASHED'}
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed mb-6">
                  {result.ok ? (
                    <>
                      Mission Score: <span className="text-white font-bold">{result.score}</span><br />
                      Impact: V {stats.vy.toFixed(2)} · H {stats.vx.toFixed(2)} · T {stats.tilt.toFixed(1)}°
                    </>
                  ) : (
                    <span className="text-red-400 font-bold">{result.reason}</span>
                  )}
                </p>

                {result.ok && !scoreSubmitted && (
                  <div className="flex flex-col items-center gap-3 bg-[#00ffcc11] p-4 border border-[#00ffcc33] mb-6">
                    <div className="text-xs tracking-widest">SUBMIT TO LEADERBOARD</div>
                    <div className="flex gap-2 w-full">
                      <input
                        type="text"
                        maxLength={20}
                        placeholder="PILOT NAME"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="bg-black border border-[#00ffcc] text-[#00ffcc] px-3 py-2 w-full outline-none focus:bg-[#00ffcc11]"
                      />
                      <button
                        onClick={submitScore}
                        disabled={isSubmitting || !playerName.trim()}
                        className="bg-[#00ffcc] text-black px-4 py-2 font-bold disabled:opacity-50"
                      >
                        {isSubmitting ? '...' : 'SEND'}
                      </button>
                    </div>
                  </div>
                )}
                {scoreSubmitted && (
                  <div className="text-green-400 text-sm tracking-widest mb-6">SCORE TRANSMITTED</div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center w-full max-w-md">
                <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-xs text-[#00ffcc66] mb-8">
                  <div><span className="bg-[#00ffcc11] border border-[#00ffcc44] px-2 py-0.5 mr-2 text-[#00ffcc]">↑ / W</span>Thrust</div>
                  <div><span className="bg-[#00ffcc11] border border-[#00ffcc44] px-2 py-0.5 mr-2 text-[#00ffcc]">← → / A D</span>Rotate</div>
                </div>

                <div className="flex gap-4 mb-8">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`px-4 py-2 text-xs tracking-widest border ${difficulty === d ? 'bg-[#00ffcc] text-black border-[#00ffcc]' : 'border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc]'}`}
                    >
                      {d.toUpperCase()}
                    </button>
                  ))}
                </div>

                {leaderboard.length > 0 && (
                  <div className="w-full bg-black/50 border border-[#00ffcc22] p-4 mb-8 text-left">
                    <div className="text-xs tracking-widest text-[#00ffcc88] mb-3 text-center">TOP PILOTS</div>
                    <div className="space-y-2">
                      {leaderboard.map((entry, i) => (
                        <div key={entry.id} className="flex justify-between text-sm">
                          <div className="flex gap-3">
                            <span className="text-[#00ffcc44] w-4">{i + 1}.</span>
                            <span className="text-white">{entry.playerName}</span>
                            <span className="text-[10px] text-[#00ffcc66] self-center">[{entry.difficulty}]</span>
                          </div>
                          <span className="font-bold text-[#00ffcc]">{entry.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={startGame}
              className="px-12 py-4 border border-[#00ffcc] text-[#00ffcc] hover:bg-[#00ffcc] hover:text-black transition-all duration-200 tracking-widest font-bold"
            >
              {gameState === 'menu' ? 'INITIATE DESCENT' : 'RETRY MISSION'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
