/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { collection, query, orderBy, limit, getDocs, serverTimestamp, doc, setDoc, getDoc, increment, deleteDoc } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { ChevronLeft, ChevronRight, Zap, RefreshCw, XCircle, Trophy, Settings, Play, Info, LogOut, User as UserIcon, ShieldAlert, Rocket, Target, Fuel } from 'lucide-react';
import { db, auth, provider } from './firebase';

// --- Constants ---
const G = 1.62; // Moon gravity
const FUEL_BURN = 15;
const WORLD_W = 2700;

const DIFF_SETTINGS = {
  easy: { SAFE_VY: 3.0, SAFE_VX: 2.0, SAFE_DEG: 15, OBSTACLES: 2 },
  medium: { SAFE_VY: 2.5, SAFE_VX: 1.5, SAFE_DEG: 12, OBSTACLES: 12 },
  hard: { SAFE_VY: 2.0, SAFE_VX: 1.0, SAFE_DEG: 8, OBSTACLES: 35 },
};

type Difficulty = 'easy' | 'medium' | 'hard';
type GameMode = 'classic' | 'explore' | 'fun' | 'training';
type ShipType = 'pioneer' | 'sparrow' | 'tortoise' | 'frog' | 'mantis' | 'goliath' | 'viper' | 'nomad' | 'eclipse' | 'apollo';

interface ShipDef {
  name: string;
  desc: string;
  color: string;
  price: number;
  baseThrust: number;
  baseRot: number;
  baseFuel: number;
  baseHull: number;
  maxUpgrades: number;
  upgradeCostBase: number;
}

const SHIPS: Record<ShipType, ShipDef> = {
  pioneer: { name: 'PIONEER', desc: 'Standard issue starter ship.', color: '#b0b0be', price: 0, baseThrust: 15, baseRot: 4.5, baseFuel: 800, baseHull: 1.0, maxUpgrades: 3, upgradeCostBase: 100 },
  sparrow: { name: 'SPARROW', desc: 'Light, agile, but fragile.', color: '#ffcc00', price: 1000, baseThrust: 18, baseRot: 7.0, baseFuel: 600, baseHull: 0.8, maxUpgrades: 4, upgradeCostBase: 150 },
  tortoise: { name: 'TORTOISE', desc: 'Heavy armor, massive tanks.', color: '#4488ff', price: 1500, baseThrust: 12, baseRot: 3.0, baseFuel: 1500, baseHull: 1.5, maxUpgrades: 4, upgradeCostBase: 200 },
  frog: { name: 'FROG', desc: 'Powerful vertical thrusters.', color: '#44ff44', price: 2500, baseThrust: 25, baseRot: 3.5, baseFuel: 700, baseHull: 1.2, maxUpgrades: 4, upgradeCostBase: 250 },
  mantis: { name: 'MANTIS', desc: 'Precision rotation control.', color: '#ff44ff', price: 3500, baseThrust: 14, baseRot: 9.0, baseFuel: 900, baseHull: 0.9, maxUpgrades: 5, upgradeCostBase: 300 },
  goliath: { name: 'GOLIATH', desc: 'Industrial cargo hauler.', color: '#ff8800', price: 5000, baseThrust: 16, baseRot: 2.5, baseFuel: 2500, baseHull: 1.8, maxUpgrades: 5, upgradeCostBase: 400 },
  viper: { name: 'VIPER', desc: 'Extreme speed racing ship.', color: '#ff2222', price: 8000, baseThrust: 32, baseRot: 11.0, baseFuel: 500, baseHull: 0.7, maxUpgrades: 5, upgradeCostBase: 500 },
  nomad: { name: 'NOMAD', desc: 'Built for deep exploration.', color: '#22ffff', price: 12000, baseThrust: 18, baseRot: 5.5, baseFuel: 2000, baseHull: 1.3, maxUpgrades: 6, upgradeCostBase: 600 },
  eclipse: { name: 'ECLIPSE', desc: 'Advanced stealth technology.', color: '#8822ff', price: 20000, baseThrust: 24, baseRot: 8.0, baseFuel: 1500, baseHull: 1.1, maxUpgrades: 6, upgradeCostBase: 800 },
  apollo: { name: 'APOLLO', desc: 'The ultimate lunar vessel.', color: '#ffffff', price: 50000, baseThrust: 28, baseRot: 9.0, baseFuel: 3000, baseHull: 2.0, maxUpgrades: 7, upgradeCostBase: 1500 },
};

interface ShipUpgrades {
  engine: number;
  rcs: number;
  tank: number;
  hull: number;
}

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
  visited?: boolean;
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
  width: number;
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
  const [registeredName, setRegisteredName] = useState(() => localStorage.getItem('pilotName') || '');
  const [tempName, setTempName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [mode, setMode] = useState<GameMode>('classic');
  const [credits, setCredits] = useState(() => parseInt(localStorage.getItem('credits') || '0'));
  const [completedMissions, setCompletedMissions] = useState<string[]>(() => {
    const saved = localStorage.getItem('completedMissions');
    return saved ? JSON.parse(saved) : [];
  });
  const [unlockedShips, setUnlockedShips] = useState<ShipType[]>(() => {
    const saved = JSON.parse(localStorage.getItem('unlockedShips') || '["pioneer"]');
    return saved.map((s: string) => s === 'classic' ? 'pioneer' : s);
  });
  const [selectedShip, setSelectedShip] = useState<ShipType>(() => {
    const saved = localStorage.getItem('selectedShip') || 'pioneer';
    return saved === 'classic' ? 'pioneer' : (saved as ShipType);
  });
  const [showShop, setShowShop] = useState(false);
  const [shopViewShip, setShopViewShip] = useState<ShipType>(selectedShip);
  const [exploreScore, setExploreScore] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [guestId, setGuestId] = useState<string | null>(localStorage.getItem('guestId'));
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false);
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [missionNotify, setMissionNotify] = useState<string | null>(null);
  const [showMissionsMobile, setShowMissionsMobile] = useState(false);
  const tutorialWaypointRef = useRef<{ x: number, y: number, hit: boolean } | null>(null);
  const tutorialTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [shipUpgrades, setShipUpgrades] = useState<Record<string, ShipUpgrades>>(() => {
    const saved = localStorage.getItem('shipUpgrades');
    if (saved) return JSON.parse(saved);
    const initial: Record<string, ShipUpgrades> = {};
    (Object.keys(SHIPS) as ShipType[]).forEach(k => {
      initial[k] = { engine: 0, rcs: 0, tank: 0, hull: 0 };
    });
    return initial;
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      const effectiveUid = currentUser?.uid || guestId;
      
      if (effectiveUid) {
        setIsAdmin(currentUser?.email === 'meganeirosin@gmail.com');
        // Load profile from Firestore
        const profileRef = doc(db, 'players', effectiveUid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const data = profileSnap.data();
          if (data.displayName) {
            setRegisteredName(data.displayName);
            localStorage.setItem('pilotName', data.displayName);
          } else {
            setRegisteredName(currentUser?.displayName || 'PILOT_' + effectiveUid.substring(0, 5));
          }
          if (data.credits !== undefined) setCredits(data.credits);
          if (data.unlockedShips) setUnlockedShips(data.unlockedShips);
          if (data.selectedShip) setSelectedShip(data.selectedShip);
          if (data.shipUpgrades) setShipUpgrades(data.shipUpgrades);
          
          // If user hasn't seen tutorial, show prompt
          if (!data.hasSeenTutorial) {
            setShowTutorialPrompt(true);
          }
        } else {
          // Initialize profile
          const initialName = currentUser?.displayName || 'PILOT_' + effectiveUid.substring(0, 5);
          setRegisteredName(initialName);
          await setDoc(profileRef, {
            credits: credits,
            unlockedShips: unlockedShips,
            selectedShip: selectedShip,
            shipUpgrades: shipUpgrades,
            displayName: initialName,
            hasSeenTutorial: false
          });
          setShowTutorialPrompt(true);
        }
        setIsProfileLoaded(true);
      } else {
        setIsProfileLoaded(false);
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [guestId]);

  // Save profile changes to Firestore
  useEffect(() => {
    const effectiveUid = user?.uid || guestId;
    if (effectiveUid && isAuthReady && isProfileLoaded && registeredName) {
      const profileRef = doc(db, 'players', effectiveUid);
      setDoc(profileRef, {
        credits,
        unlockedShips,
        selectedShip,
        shipUpgrades,
        displayName: registeredName
      }, { merge: true }).catch(err => console.error('Failed to save profile:', err));
    }
  }, [credits, unlockedShips, selectedShip, shipUpgrades, registeredName, user, guestId, isAuthReady, isProfileLoaded]);

  function getCalculatedStats(type: ShipType, upgrades: ShipUpgrades) {
    const base = SHIPS[type];
    const upg = upgrades || { engine: 0, rcs: 0, tank: 0, hull: 0 };
    return {
      thrust: base.baseThrust * (1 + upg.engine * 0.15),
      rot: base.baseRot * (1 + upg.rcs * 0.15),
      fuel: base.baseFuel * (1 + upg.tank * 0.20),
      hull: base.baseHull * (1 + upg.hull * 0.15),
    };
  }

  function getUpgradeCost(type: ShipType, currentLevel: number) {
    const base = SHIPS[type];
    return Math.floor(base.upgradeCostBase * Math.pow(1.6, currentLevel));
  }

  // Game refs to avoid re-renders during the loop
  const shipRef = useRef<Ship>(mkShip(selectedShip, 'classic'));
  const terrainRef = useRef<Terrain>(mkTerrain('medium', 'classic'));
  const starsRef = useRef<any[]>(mkStars(250));
  const particlesRef = useRef<Particle[]>([]);
  const sparksRef = useRef<Particle[]>([]);
  const debrisRef = useRef<Debris[]>([]);
  const camXRef = useRef(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastTRef = useRef(0);

  function mkShip(type: ShipType = selectedShip, m: GameMode = mode): Ship {
    const stats = getCalculatedStats(type, shipUpgrades[type]);
    return {
      x: m === 'explore' ? 100 : WORLD_W / 2,
      y: 50,
      vx: m === 'explore' ? 10 : (Math.random() - 0.5) * 15,
      vy: 3,
      angle: 0,
      av: 0,
      fuel: stats.fuel,
      thrusting: false,
      dead: false,
      down: false,
    };
  }

  function mkStars(n: number) {
    return Array.from({ length: n }, () => ({
      x: Math.random() * WORLD_W,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.4 + 0.2,
      b: Math.random() * 0.6 + 0.4,
      t: Math.random() * Math.PI * 2,
    }));
  }

  function mkTerrain(diff: Difficulty = 'medium', m: GameMode = mode): Terrain {
    const isExp = m === 'explore';
    const N = isExp ? 2048 : 512;
    const W = isExp ? 15000 : WORLD_W;
    const H = window.innerHeight;
    const ht = new Float32Array(N);
    ht[0] = H * 0.58;
    ht[N - 1] = H * 0.60;

    function subdiv(lo: number, hi: number, amp: number) {
      if (hi - lo <= 1) return;
      const mid = (lo + hi) >> 1;
      ht[mid] = (ht[lo] + ht[hi]) / 2 + (Math.random() - 0.5) * amp;
      subdiv(lo, mid, amp * 0.6);
      subdiv(mid, hi, amp * 0.6);
    }
    subdiv(0, N - 1, H * 0.52);

    for (let i = 0; i < N; i++) ht[i] = Math.max(H * 0.2, Math.min(H * 0.9, ht[i]));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < N - 1; i++) ht[i] = (ht[i - 1] + 2 * ht[i] + ht[i + 1]) / 4;
    }

    const pads: Pad[] = [];
    const usedRanges: { s: number; e: number }[] = [];
    const numPads = isExp ? 30 : (m === 'training' ? 8 : 3);
    for (let p = 0; p < numPads; p++) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const pw = 15 + Math.floor(Math.random() * 12);
        const si = isExp ? Math.floor(30 + p * ((N - 60) / numPads) + (Math.random() - 0.5) * 10) : Math.floor(30 + Math.random() * (N - 60 - pw));
        if (usedRanges.some((r) => si <= r.e + 25 && si + pw >= r.s - 25)) continue;
        const ph = ht[si];
        for (let i = si; i <= si + pw; i++) ht[i] = ph;
        usedRanges.push({ s: si, e: si + pw });
        const xScale = W / (N - 1);
        pads.push({ x1: si * xScale, x2: (si + pw) * xScale, y: ph, cx: (si + pw / 2) * xScale, visited: false });
        break;
      }
    }

    const pts = Array.from({ length: N }, (_, i) => ({ x: i * (W / (N - 1)), y: ht[i] }));
    
    // Generate obstacles
    const obstacles: Obstacle[] = [];
    const numObstacles = isExp ? DIFF_SETTINGS[diff].OBSTACLES * 5 : DIFF_SETTINGS[diff].OBSTACLES;
    const xScale = W / (N - 1);
    
    for (let i = 0; i < numObstacles; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const w = 10 + Math.random() * 20;
        const h = 20 + Math.random() * 60;
        const x = 50 + Math.random() * (W - 100);
        
        // Don't place on or too close to pads
        if (pads.some(p => x > p.x1 - 40 && x < p.x2 + 40)) continue;
        
        // Find terrain height at this x
        const f = (x / W) * (N - 1);
        const lo = Math.floor(f);
        const y = ht[lo];
        
        obstacles.push({ x, y: y - h, w, h });
        break;
      }
    }

    return { pts, pads, obstacles, N, width: W };
  }

  function terrainYAt(wx: number) {
    const t = terrainRef.current;
    const f = (wx / t.width) * (t.N - 1);
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
      const q = query(collection(db, 'leaderboard_v3'), orderBy('score', 'desc'), limit(10));
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
    if (!registeredName || !result || !result.ok || scoreSubmitted) return;
    setIsSubmitting(true);
    try {
      const docId = user ? user.uid : `anon_${registeredName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const playerDocRef = doc(db, 'leaderboard_v3', docId);
      await setDoc(playerDocRef, {
        playerName: registeredName,
        score: increment(result.score),
        difficulty,
        timestamp: serverTimestamp()
      }, { merge: true });
      setScoreSubmitted(true);
      fetchLeaderboard();
    } catch (error) {
      console.error("Error submitting score:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteLeaderboardEntry = async (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this entry?")) return;
    try {
      await deleteDoc(doc(db, 'leaderboard_v3', id));
      fetchLeaderboard();
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  const startGame = () => {
    terrainRef.current = mkTerrain(difficulty, mode);
    shipRef.current = mkShip(selectedShip, mode);
    particlesRef.current = [];
    sparksRef.current = [];
    debrisRef.current = [];
    camXRef.current = shipRef.current.x - window.innerWidth / 2;
    lastTRef.current = performance.now();
    setGameState('playing');
    setResult(null);
    setScoreSubmitted(false);
    setExploreScore(0);
  };

  useEffect(() => {
    if (result?.ok && !scoreSubmitted && gameState === 'landed' && mode === 'classic') {
      submitScore();
    }
  }, [result, scoreSubmitted, gameState, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore keystrokes if the user is typing in an input field
      if (e.target instanceof HTMLInputElement) return;

      keysRef.current[e.key.toLowerCase()] = e.type === 'keydown';
      if (e.type === 'keydown' && (e.key === 'r' || e.key === 'R')) {
        if (registeredName) startGame();
      }
      if (e.type === 'keydown' && e.key === ' ' && gameState !== 'playing') {
        if (registeredName) startGame();
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', handleKey);
    };
  }, [gameState, difficulty, registeredName]);

  useEffect(() => {
    let frameId: number;
    const loop = (ts: number) => {
      const dt = Math.min((ts - lastTRef.current) / 1000, 0.05);
      lastTRef.current = ts;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      // --- Physics ---
      if (gameState === 'playing') {
        const s = shipRef.current;
        const keys = keysRef.current;

        const shipStats = getCalculatedStats(selectedShip, shipUpgrades[selectedShip]);
        const rl = keys['arrowleft'] || keys['a'];
        const rr = keys['arrowright'] || keys['d'];
        const thrust = keys['arrowup'] || keys['w'];
        const currentDeg = Math.min(Math.abs((s.angle * 180 / Math.PI) % 360), 360 - Math.abs((s.angle * 180 / Math.PI) % 360));

        s.av += ((rl ? -1 : 0) + (rr ? 1 : 0)) * shipStats.rot * dt;
        s.av *= Math.pow(0.85, dt * 60);
        s.angle += s.av * dt;

        s.thrusting = !!thrust && (mode === 'fun' || mode === 'training' || s.fuel > 0);
        if (s.thrusting) {
          if (s.down && (mode === 'explore' || mode === 'fun' || mode === 'training')) {
            s.down = false;
            s.vy = -2;
          }
          s.vx += Math.sin(s.angle) * shipStats.thrust * dt;
          s.vy += -Math.cos(s.angle) * shipStats.thrust * dt;
          if (mode !== 'fun' && mode !== 'training') {
            s.fuel = Math.max(0, s.fuel - FUEL_BURN * dt);
          }
          // Exhaust
          for (let i = 0; i < 3; i++) {
            const ang = s.angle + Math.PI + (Math.random() - 0.5) * 0.4;
            const spd = 60 + Math.random() * 90;
            particlesRef.current.push({
              x: s.x - Math.sin(s.angle) * 15, y: s.y + Math.cos(s.angle) * 15,
              vx: Math.sin(ang) * spd + s.vx * 0.3, vy: -Math.cos(ang) * spd + s.vy * 0.3,
              life: 1, decay: 1.5 + Math.random() * 1.5, sz: 1.5 + Math.random() * 3
            });
          }
        }

        s.vy += (mode === 'training' ? G * 0.6 : G) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // Bounds
        const W = terrainRef.current.width;
        if (mode === 'explore') {
          if (s.x < 0) s.x += W;
          if (s.x > W) s.x -= W;
        } else {
          if (s.x < 10) { s.x = 10; s.vx = Math.abs(s.vx) * 0.3; }
          if (s.x > W - 10) { s.x = W - 10; s.vx = -Math.abs(s.vx) * 0.3; }
        }

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
          const hullMult = shipStats.hull;
          const safeVy = (mode === 'training' ? 10 : limits.SAFE_VY) * hullMult;
          const safeVx = (mode === 'training' ? 8 : limits.SAFE_VX) * hullMult;
          const safeDeg = (mode === 'training' ? 45 : limits.SAFE_DEG) * hullMult;

          // FREEZE STATS HERE
          setStats({
            alt: 0,
            vy: finalVy,
            vx: finalVx,
            tilt: currentDeg,
            fuel: (s.fuel / shipStats.fuel) * 100
          });

          if (pad && !hitObstacle && finalVy < safeVy && finalVx < safeVx && currentDeg < safeDeg) {
            if (mode === 'explore' || mode === 'fun' || mode === 'training') {
              if (!pad.visited) {
                pad.visited = true;
                s.fuel = shipStats.fuel;
                let pts = 500 * (difficulty === 'hard' ? 2 : difficulty === 'medium' ? 1.5 : 1);
                if (mode === 'fun') pts = 50; // Fun mode is for fun, not farming
                setExploreScore(prev => prev + pts);
                
                // Check Explore Mission
                if (mode === 'explore') {
                  const visitedCount = terrainRef.current.pads.filter(p => p.visited).length;
                  if (visitedCount >= 5 && !completedMissions.includes('explore')) {
                    const next = [...completedMissions, 'explore'];
                    setCompletedMissions(next);
                    localStorage.setItem('completedMissions', JSON.stringify(next));
                    setMissionNotify('LONG HAUL MISSION COMPLETED!');
                    setTimeout(() => setMissionNotify(null), 4000);
                  }
                }

                setCredits(prev => {
                  const nc = prev + Math.floor(pts / 10);
                  localStorage.setItem('credits', nc.toString());
                  return nc;
                });
              }
              s.down = true; s.vx = 0; s.vy = 0; s.av = 0; s.angle = 0;
            } else {
              s.down = true; s.vx = 0; s.vy = 0; s.av = 0;
              setGameState('landed');
              // Score multiplier based on difficulty
              const diffMult = difficulty === 'hard' ? 2.0 : difficulty === 'medium' ? 1.5 : 1.0;
              const score = Math.round((Math.max(0, 100 - (finalVy / safeVy) * 30 - (finalVx / safeVx) * 20) * 0.55 + (s.fuel / shipStats.fuel) * 45) * diffMult);
              const earnedCredits = Math.floor(score / 2);
              setCredits(prev => {
                const nc = prev + earnedCredits;
                localStorage.setItem('credits', nc.toString());
                return nc;
              });
              setResult({ ok: true, reason: '', score });

              // Check Missions
              const newMissions = [...completedMissions];
              let notified = false;
              if (finalVy < 1 && finalVx < 1 && !completedMissions.includes('precision')) {
                newMissions.push('precision');
                setMissionNotify('PRECISION LANDING COMPLETED!');
                notified = true;
              }
              if (s.fuel / shipStats.fuel > 0.8 && !completedMissions.includes('fuel')) {
                newMissions.push('fuel');
                if (!notified) setMissionNotify('FUEL CONSERVATION COMPLETED!');
                notified = true;
              }
              if (newMissions.length > completedMissions.length) {
                setCompletedMissions(newMissions);
                localStorage.setItem('completedMissions', JSON.stringify(newMissions));
                if (notified) setTimeout(() => setMissionNotify(null), 4000);
              }
            }
          } else if (mode === 'fun') {
            // Bounce logic
            s.vx = -s.vx * 0.6;
            s.vy = -s.vy * 0.6;
            s.av += (Math.random() - 0.5) * 4;
            s.y -= 5; // Push out
            // Add some sparks
            for (let i = 0; i < 10; i++) {
              sparksRef.current.push({
                x: contactX, y: s.y + 10,
                vx: (Math.random() - 0.5) * 150, vy: -Math.random() * 150,
                life: 0.8, decay: 1.5, sz: 1 + Math.random() * 3, col: '#00ffcc'
              });
            }
          } else {
            s.dead = true;
            addExplosion(s.x, s.y);
            spawnDebris(s);
            setGameState('crashed');
            if ((mode === 'explore' || mode === 'fun' || mode === 'training') && exploreScore > 0) {
              setResult({ ok: true, reason: 'MISSION ENDED', score: exploreScore });
            } else {
              const why = hitObstacle ? 'HIT OBSTACLE' :
                !pad ? 'MISSED LANDING PAD' :
                currentDeg >= safeDeg ? `TILT ${currentDeg.toFixed(1)}° > ${safeDeg.toFixed(1)}°` :
                  finalVy >= safeVy ? `VERT ${finalVy.toFixed(2)} m/s > ${safeVy.toFixed(1)}` :
                    `HORIZ ${finalVx.toFixed(2)} m/s > ${safeVx.toFixed(1)}`;
              setResult({ ok: false, reason: why, score: 0 });
            }
          }
        }

        // Camera
        const viewW = canvas.width;
        const viewH = canvas.height;
        const tx = s.x - viewW / 2;
        camXRef.current += (tx - camXRef.current) * 0.1;
        if (mode !== 'explore') {
          camXRef.current = Math.max(0, Math.min(W - viewW, camXRef.current));
        }

        // Update HUD during flight
        const gY = terrainYAt(s.x);
        
        setStats({
          alt: Math.max(0, gY - s.y - 14),
          vy: Math.abs(s.vy),
          vx: Math.abs(s.vx),
          tilt: currentDeg,
          fuel: (s.fuel / shipStats.fuel) * 100
        });
      }

      // --- Rendering ---
      const viewW = canvas.width;
      const viewH = canvas.height;
      ctx.fillStyle = '#000008'; ctx.fillRect(0, 0, viewW, viewH);

      // Stars
      const W = terrainRef.current.width;
      starsRef.current.forEach(s => {
        const tw = 0.6 + 0.4 * Math.sin(ts * 0.0008 + s.t);
        const sx = ((s.x - camXRef.current * 0.2) + W * 5) % viewW;
        ctx.beginPath(); ctx.arc(sx, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.b * tw})`; ctx.fill();
      });

      // Terrain
      ctx.save(); ctx.translate(-camXRef.current, 0);
      const g = ctx.createLinearGradient(0, viewH * 0.3, 0, viewH);
      g.addColorStop(0, '#1a1a2e'); g.addColorStop(1, '#0a0a1a');
      ctx.beginPath(); ctx.moveTo(terrainRef.current.pts[0].x, terrainRef.current.pts[0].y);
      terrainRef.current.pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(W, viewH + 50); ctx.lineTo(0, viewH + 50); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#5555aa'; ctx.lineWidth = 2; ctx.stroke();

      // Pads
      terrainRef.current.pads.forEach(pad => {
        ctx.fillStyle = pad.visited ? '#555555' : '#00ffcc33';
        ctx.fillRect(pad.x1, pad.y - 4, pad.x2 - pad.x1, 8);
        ctx.fillStyle = pad.visited ? '#888888' : '#00ffcc';
        ctx.fillRect(pad.x1, pad.y - 1, pad.x2 - pad.x1, 3);
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

      // Trajectory for training mode
      if (mode === 'training' && gameState === 'playing' && !shipRef.current.dead && !shipRef.current.down) {
        ctx.save();
        ctx.translate(-camXRef.current, 0);
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(68, 255, 68, 0.6)';
        let tx = shipRef.current.x;
        let ty = shipRef.current.y;
        let tvx = shipRef.current.vx;
        let tvy = shipRef.current.vy;
        ctx.moveTo(tx, ty);
        for (let i = 0; i < 100; i++) {
          tvy += G * 0.1;
          tx += tvx * 0.1;
          ty += tvy * 0.1;
          ctx.lineTo(tx, ty);
          if (ty > terrainYAt(tx)) break;
        }
        ctx.stroke();
        ctx.restore();
      }

      // Waypoint for tutorial
      if (isTutorialActive && tutorialStep === 3 && tutorialWaypointRef.current && !tutorialWaypointRef.current.hit) {
        const wp = tutorialWaypointRef.current;
        ctx.save();
        ctx.translate(-camXRef.current, 0);
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, 40, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ffcc';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Pulse effect
        const pulse = Math.sin(Date.now() / 200) * 10;
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, 30 + pulse, 0, Math.PI * 2);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#00ffcc';
        ctx.fill();
        
        // Arrow pointing to waypoint if off-screen
        const dx = wp.x - shipRef.current.x;
        const dy = wp.y - shipRef.current.y;
        if (Math.abs(dx) > canvas.width / 2 || Math.abs(dy) > canvas.height / 2) {
          ctx.restore();
          ctx.save();
          const angle = Math.atan2(dy, dx);
          ctx.translate(canvas.width / 2 + Math.cos(angle) * 100, canvas.height / 2 + Math.sin(angle) * 100);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-15, -10);
          ctx.lineTo(-15, 10);
          ctx.closePath();
          ctx.fillStyle = '#00ffcc';
          ctx.fill();
        }
        ctx.restore();
      }

      // Ship
      if (!shipRef.current.dead) {
        const s = shipRef.current;
        const shipStats = SHIPS[selectedShip];
        ctx.save(); ctx.translate(s.x - camXRef.current, s.y); ctx.rotate(s.angle);
        // Ship drawing logic...
        ctx.fillStyle = shipStats.color; ctx.strokeStyle = '#777799'; ctx.lineWidth = 0.5;
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

      // --- Tutorial Logic ---
      if (isTutorialActive && gameState === 'playing') {
        const s = shipRef.current;
        
        // Step 1: Thrust
        if (tutorialStep === 1 && s.thrusting) {
          if (!tutorialTimerRef.current) tutorialTimerRef.current = Date.now();
          if (Date.now() - tutorialTimerRef.current > 1500) {
            setTutorialStep(2);
            tutorialTimerRef.current = null;
            // Pre-set waypoint for step 3
            tutorialWaypointRef.current = { x: s.x + 500, y: s.y - 300, hit: false };
          }
        } else if (tutorialStep === 2 && Math.abs(s.av) > 0.2) {
          // Step 2: Rotate (Lowered threshold to 0.2)
          if (!tutorialTimerRef.current) tutorialTimerRef.current = Date.now();
          if (Date.now() - tutorialTimerRef.current > 1500) {
            setTutorialStep(3);
            tutorialTimerRef.current = null;
          }
        } else if (tutorialStep === 3 && tutorialWaypointRef.current && !tutorialWaypointRef.current.hit) {
          // Step 3: Waypoint
          const dist = Math.hypot(s.x - tutorialWaypointRef.current.x, s.y - tutorialWaypointRef.current.y);
          if (dist < 60) {
            tutorialWaypointRef.current.hit = true;
            setTutorialStep(4);
          }
        } else if (tutorialStep === 4) {
          // Step 4: Hover
          const alt = terrainYAt(s.x) - s.y;
          if (alt > 5 && alt < 40 && Math.abs(s.vy) < 3 && Math.abs(s.vx) < 5) {
            if (!hoverTimerRef.current) hoverTimerRef.current = Date.now();
            if (Date.now() - hoverTimerRef.current > 2500) {
              setTutorialStep(5);
              hoverTimerRef.current = null;
            }
          } else {
            hoverTimerRef.current = null;
          }
        } else if (tutorialStep === 5 && s.down && !s.dead) {
          // Step 5: Landing (using s.down which is set on successful landing)
          setTutorialStep(6);
        } else if (tutorialStep < 3) {
          // Reset timer if condition not met (for thrust/rotate)
          if (!s.thrusting && tutorialStep === 1) tutorialTimerRef.current = null;
          if (Math.abs(s.av) <= 0.2 && tutorialStep === 2) tutorialTimerRef.current = null;
        }
      }

      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [gameState, isTutorialActive, tutorialStep]);

  const startTutorial = () => {
    setShowTutorialPrompt(false);
    setIsTutorialActive(true);
    setTutorialStep(1);
    tutorialWaypointRef.current = null;
    setMode('training');
    setDifficulty('easy');
    setGameState('playing');
    terrainRef.current = mkTerrain('easy', 'training');
    shipRef.current = mkShip(selectedShip, 'training');
  };

  const completeTutorial = async () => {
    setIsTutorialActive(false);
    setTutorialStep(0);
    if (user) {
      const profileRef = doc(db, 'players', user.uid);
      await setDoc(profileRef, { hasSeenTutorial: true }, { merge: true });
    }
  };

  useEffect(() => {
    if (!isTutorialActive) return;
    if (gameState === 'crashed') {
      // Auto-restart tutorial step if crashed
      setTimeout(() => {
        setGameState('playing');
        setResult(null);
        shipRef.current = mkShip(selectedShip, 'training');
        // Keep current tutorial step
      }, 2000);
    }
  }, [gameState, isTutorialActive]);

  // Tutorial logic moved to game loop for better responsiveness

  const exitToMenu = () => {
    setGameState('menu');
    setResult(null);
    setScoreSubmitted(false);
    terrainRef.current = mkTerrain(difficulty, mode);
    shipRef.current = mkShip(selectedShip, mode);
  };

  const vibrate = (ms: number) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  };

  const handleTouch = (key: string, isDown: boolean) => {
    if (isDown) vibrate(10);
    keysRef.current[key] = isDown;
  };

  return (
    <div className="flex items-center justify-center w-full h-screen bg-black text-[#00ffcc] font-mono overflow-hidden">
      <div 
        className="relative w-full h-full"
      >
        <canvas ref={canvasRef} width={900} height={600} className="bg-[#000008] w-full h-full object-cover" />

        {/* HUD */}
        {gameState !== 'menu' && (
          <div className="absolute inset-0 pointer-events-none p-2 sm:p-4">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto z-50 flex flex-col items-center gap-2">
              <button 
                onClick={exitToMenu} 
                className="px-4 py-2 border border-[#00ffcc44] bg-black/50 text-[#00ffcc88] hover:bg-[#00ffcc] hover:text-black text-xs tracking-widest transition-colors backdrop-blur-sm"
              >
                ABORT MISSION
              </button>
              {mode === 'fun' && <div className="text-[10px] bg-[#ffcc00] text-black px-2 font-bold tracking-widest">FUN MODE</div>}
              {mode === 'training' && <div className="text-[10px] bg-[#44ff44] text-black px-2 font-bold tracking-widest">TRAINING MODE</div>}
            </div>

            {/* HUD (Mobile Optimized) */}
            <div className="absolute top-4 left-4 flex flex-col gap-1 sm:gap-2 pointer-events-none z-40">
              <div className="bg-black/80 border border-[#00ffcc33] p-2 sm:p-3 min-w-[120px] sm:min-w-[160px] backdrop-blur-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:block">
                  <div>
                    <div className="text-[7px] sm:text-[9px] uppercase tracking-widest opacity-50">Altitude</div>
                    <div className="text-xs sm:text-lg font-bold">{stats.alt.toFixed(0)} m</div>
                  </div>
                  <div className="sm:mt-2">
                    <div className="text-[7px] sm:text-[9px] uppercase tracking-widest opacity-50">V-Speed</div>
                    <div className={`text-xs sm:text-lg font-bold ${stats.vy >= DIFF_SETTINGS[difficulty].SAFE_VY * getCalculatedStats(selectedShip, shipUpgrades[selectedShip]).hull ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                      {stats.vy.toFixed(2)} m/s
                    </div>
                  </div>
                  <div className="sm:mt-2">
                    <div className="text-[7px] sm:text-[9px] uppercase tracking-widest opacity-50">H-Speed</div>
                    <div className={`text-xs sm:text-lg font-bold ${stats.vx >= DIFF_SETTINGS[difficulty].SAFE_VX * getCalculatedStats(selectedShip, shipUpgrades[selectedShip]).hull ? 'text-orange-500' : 'text-[#00ffcc]'}`}>
                      {stats.vx.toFixed(2)} m/s
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute top-4 right-4 bg-black/80 border border-[#00ffcc33] p-2 sm:p-3 min-w-[120px] sm:min-w-[160px] text-right backdrop-blur-sm z-40">
              <div className="flex flex-col items-end gap-1 sm:gap-2">
                <button 
                  onClick={() => setGameState('menu')}
                  className="pointer-events-auto bg-red-500/20 border border-red-500/40 text-red-500 px-2 py-0.5 sm:px-3 sm:py-1 text-[7px] sm:text-[10px] uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all mb-1"
                >
                  Abort
                </button>
                
                <div className="w-full">
                  <div className="text-[7px] sm:text-[9px] uppercase tracking-widest opacity-50">Fuel</div>
                  <div className={`text-xs sm:text-lg font-bold ${stats.fuel < 20 ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                    {stats.fuel.toFixed(0)}%
                  </div>
                  <div className="w-full h-1 bg-[#00ffcc11] mt-1 border border-[#00ffcc33]">
                    <div className="h-full bg-gradient-to-r from-red-500 to-[#00ffcc]" style={{ width: `${stats.fuel}%` }} />
                  </div>
                </div>
                
                <div className="mt-1 sm:mt-2">
                  <div className="text-[7px] sm:text-[9px] uppercase tracking-widest opacity-50">Tilt</div>
                  <div className={`text-xs sm:text-lg font-bold ${stats.tilt > DIFF_SETTINGS[difficulty].SAFE_DEG ? 'text-red-500' : 'text-[#00ffcc]'}`}>
                    {stats.tilt.toFixed(1)}°
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-4 left-4 text-[8px] sm:text-[10px] opacity-40">
              SAFE: VY &lt; {(DIFF_SETTINGS[difficulty].SAFE_VY * getCalculatedStats(selectedShip, shipUpgrades[selectedShip]).hull).toFixed(1)} · VX &lt; {(DIFF_SETTINGS[difficulty].SAFE_VX * getCalculatedStats(selectedShip, shipUpgrades[selectedShip]).hull).toFixed(1)} · TILT &lt; {(DIFF_SETTINGS[difficulty].SAFE_DEG * getCalculatedStats(selectedShip, shipUpgrades[selectedShip]).hull).toFixed(1)}°
            </div>

            {/* Mission Notification */}
            {missionNotify && (
              <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-[#00ffcc] text-black px-4 py-2 font-bold tracking-[0.2em] text-xs shadow-[0_0_20px_rgba(0,255,204,0.5)] animate-bounce z-[60]">
                {missionNotify}
              </div>
            )}

            <div className="absolute bottom-4 right-4 flex flex-col gap-2 pointer-events-none sm:bottom-auto sm:top-36">
              <div className="bg-black/60 border border-[#00ffcc22] p-2 backdrop-blur-sm min-w-[140px] sm:min-w-[160px]">
                <div className="text-[7px] tracking-[0.2em] text-[#00ffcc66] mb-1.5 uppercase flex justify-between items-center">
                  <span>Missions</span>
                  <span className="text-[#ffcc00]">{completedMissions.length}/3</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 border border-[#00ffcc44] flex-shrink-0 ${completedMissions.includes('precision') ? 'bg-[#00ffcc]' : ''}`}></div>
                    <div className={`text-[8px] font-bold tracking-wider ${completedMissions.includes('precision') ? 'text-[#00ffcc66] line-through' : 'text-white'}`}>PRECISION</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 border border-[#00ffcc44] flex-shrink-0 ${completedMissions.includes('fuel') ? 'bg-[#00ffcc]' : ''}`}></div>
                    <div className={`text-[8px] font-bold tracking-wider ${completedMissions.includes('fuel') ? 'text-[#00ffcc66] line-through' : 'text-white'}`}>FUEL CONSERV.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 border border-[#00ffcc44] flex-shrink-0 ${completedMissions.includes('explore') ? 'bg-[#00ffcc]' : ''}`}></div>
                    <div className={`text-[8px] font-bold tracking-wider ${completedMissions.includes('explore') ? 'text-[#00ffcc66] line-through' : 'text-white'}`}>LONG HAUL</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Touch Controls (Ergonomic Mobile Layout) */}
            {gameState === 'playing' && (
              <div className="absolute bottom-6 left-0 right-0 flex justify-between px-8 sm:hidden pointer-events-none z-50">
                {/* Left Side: Rotation */}
                <div className="flex gap-4 pointer-events-auto">
                  <button 
                    onPointerDown={() => handleTouch('arrowleft', true)}
                    onPointerUp={() => handleTouch('arrowleft', false)}
                    onPointerLeave={() => handleTouch('arrowleft', false)}
                    className="w-16 h-16 bg-black/40 border-2 border-[#00ffcc]/30 rounded-2xl flex items-center justify-center active:bg-[#00ffcc] active:scale-95 transition-all backdrop-blur-md"
                  >
                    <ChevronLeft className="w-8 h-8 text-[#00ffcc]" />
                  </button>
                  <button 
                    onPointerDown={() => handleTouch('arrowright', true)}
                    onPointerUp={() => handleTouch('arrowright', false)}
                    onPointerLeave={() => handleTouch('arrowright', false)}
                    className="w-16 h-16 bg-black/40 border-2 border-[#00ffcc]/30 rounded-2xl flex items-center justify-center active:bg-[#00ffcc] active:scale-95 transition-all backdrop-blur-md"
                  >
                    <ChevronRight className="w-8 h-8 text-[#00ffcc]" />
                  </button>
                </div>
                
                {/* Right Side: Thrust */}
                <div className="pointer-events-auto">
                  <button 
                    onPointerDown={() => handleTouch('arrowup', true)}
                    onPointerUp={() => handleTouch('arrowup', false)}
                    onPointerLeave={() => handleTouch('arrowup', false)}
                    className="w-20 h-20 bg-black/40 border-2 border-[#ffcc00]/30 rounded-full flex items-center justify-center active:bg-[#ffcc00] active:scale-95 transition-all backdrop-blur-md shadow-[0_0_20px_rgba(255,204,0,0.1)]"
                  >
                    <Zap className="w-10 h-10 text-[#ffcc00]" />
                  </button>
                </div>
              </div>
            )}

            {mode === 'training' && gameState === 'playing' && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center space-y-2">
                {stats.alt > 100 && <div className="text-[#44ff44] text-xs animate-pulse tracking-widest">DESCEND SLOWLY TO A PAD</div>}
                {stats.alt < 50 && stats.vy > 5 && <div className="text-red-500 text-xs animate-pulse tracking-widest font-bold">SLOW DOWN! USE THRUSTERS</div>}
                {Math.abs(stats.tilt) > 20 && <div className="text-orange-500 text-xs animate-pulse tracking-widest">KEEP SHIP UPRIGHT</div>}
              </div>
            )}
          </div>
        )}

        {/* Overlays */}
        {/* Overlays */}
        {showTutorialPrompt && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-md">
            <div className="bg-[#000d22] border-2 border-[#00ffcc] p-8 max-w-md text-center shadow-[0_0_50px_rgba(0,255,204,0.3)]">
              <h2 className="text-2xl font-bold text-white mb-4 tracking-widest">NEW PILOT DETECTED</h2>
              <p className="text-[#00ffcc88] mb-8 leading-relaxed">
                Welcome to the Lunar Descent Program. Would you like to undergo a brief training simulation to learn the flight controls?
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={startTutorial}
                  className="w-full py-3 bg-[#00ffcc] text-black font-bold tracking-widest hover:bg-white transition-colors"
                >
                  START TRAINING
                </button>
                <button
                  onClick={() => {
                    setShowTutorialPrompt(false);
                    completeTutorial();
                  }}
                  className="w-full py-3 border border-[#00ffcc44] text-[#00ffcc88] hover:text-[#00ffcc] transition-colors text-xs tracking-widest"
                >
                  SKIP (I'M AN EXPERT)
                </button>
              </div>
            </div>
          </div>
        )}

        {isTutorialActive && gameState === 'playing' && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 w-full max-w-lg pointer-events-none z-[60]">
            <div className="bg-black/60 border border-[#00ffcc] p-4 backdrop-blur-sm text-center">
              <div className="text-[10px] text-[#00ffcc88] uppercase tracking-[0.2em] mb-1">Training Objective</div>
              <div className="text-lg text-white font-bold tracking-wide">
                {tutorialStep === 1 && "Press W or UP to use THRUSTERS. Get some altitude!"}
                {tutorialStep === 2 && "Use A/D or LEFT/RIGHT to ROTATE. Keep the ship upright."}
                {tutorialStep === 3 && "Fly through the NAVIGATION RING in the sky."}
                {tutorialStep === 4 && "Precision Hover: Stay 10-20m above ground for 3 seconds."}
                {tutorialStep === 5 && "Final Test: Find a green PAD and land GENTLY (Speed < 10m/s)."}
                {tutorialStep === 6 && "EXCELLENT! You have mastered the basics."}
              </div>
              {tutorialStep === 6 && (
                <button
                  onClick={completeTutorial}
                  className="mt-4 px-6 py-2 bg-[#00ffcc] text-black font-bold text-xs tracking-widest pointer-events-auto hover:bg-white transition-colors"
                >
                  FINISH TRAINING
                </button>
              )}
            </div>
          </div>
        )}

        {(gameState === 'menu' || (result && !isTutorialActive)) && (
          <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-4 sm:p-8 z-[100]">
            <div className="relative mt-2 sm:mt-8 mb-4 sm:mb-8 flex flex-col items-center shrink-0">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[160%] bg-[#00ffcc] opacity-20 blur-[30px] sm:blur-[60px] rounded-full pointer-events-none"></div>
              <h1 
                className="text-[28px] sm:text-[52px] font-black text-white tracking-[4px] sm:tracking-[8px] mb-[2px] sm:mb-[6px] relative z-10 ml-[4px] sm:ml-[8px]"
                style={{ textShadow: '0 0 15px #00ffcc, 0 0 30px #00ffcc55', fontFamily: "'Orbitron', sans-serif" }}
              >
                LUNAR
              </h1>
              <p className="text-[8px] sm:text-sm md:text-base tracking-[0.8em] sm:tracking-[1.2em] text-[#00ffcc] relative z-10 ml-[0.8em] sm:ml-[1.2em] font-medium drop-shadow-[0_0_8px_rgba(0,255,204,0.8)]">
                DESCENT
              </p>
            </div>

            {gameState === 'menu' && !user && !guestId ? (
              <div className="flex flex-col items-center gap-6 mb-8 z-10 w-full max-w-xs">
                <div className="text-xs tracking-widest text-[#00ffcc88]">PILOT AUTHENTICATION REQUIRED</div>
                
                <button
                  onClick={() => signInWithPopup(auth, provider).catch(err => console.error(err))}
                  className="w-full px-8 py-3 border border-[#00ffcc] text-[#00ffcc] hover:bg-[#00ffcc] hover:text-black transition-all font-bold tracking-widest flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.74 2.73-3.78 2.73-2.4 0-4.35-1.95-4.35-4.35s1.95-4.35 4.35-4.35c1.08 0 2.07.39 2.84 1.04l2.05-2.05C18.41 5.51 16.55 4.35 14.35 4.35 9.93 4.35 6.35 7.93 6.35 12.35s3.58 8 8 8c4.17 0 7.35-2.94 7.35-7.35 0-.65-.06-1.29-.17-1.9z"
                    />
                  </svg>
                  SIGN IN WITH GOOGLE
                </button>

                <div className="flex items-center w-full gap-4">
                  <div className="h-px bg-[#00ffcc22] flex-1"></div>
                  <div className="text-[10px] text-[#00ffcc44] tracking-widest">OR</div>
                  <div className="h-px bg-[#00ffcc22] flex-1"></div>
                </div>

                <div className="w-full flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="ENTER CALLSIGN"
                      maxLength={15}
                      className="flex-1 bg-black/50 border border-[#00ffcc44] text-[#00ffcc] px-4 py-2 text-xs outline-none focus:border-[#00ffcc] transition-all uppercase tracking-widest"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) {
                            const id = 'GUEST_' + Math.random().toString(36).substring(2, 9);
                            localStorage.setItem('guestId', id);
                            localStorage.setItem('pilotName', val.toUpperCase());
                            setRegisteredName(val.toUpperCase());
                            setGuestId(id);
                          }
                        }
                      }}
                    />
                    <button
                      onClick={(e) => {
                        const input = (e.currentTarget.previousSibling as HTMLInputElement);
                        const val = input.value.trim();
                        if (val) {
                          const id = 'GUEST_' + Math.random().toString(36).substring(2, 9);
                          localStorage.setItem('guestId', id);
                          localStorage.setItem('pilotName', val.toUpperCase());
                          setRegisteredName(val.toUpperCase());
                          setGuestId(id);
                        }
                      }}
                      className="px-4 py-2 border border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc] hover:text-[#00ffcc] text-[10px] tracking-widest transition-all"
                    >
                      GO
                    </button>
                  </div>
                  <div className="text-[9px] text-[#00ffcc44] text-center italic">OR PLAY AS GUEST WITHOUT GMAIL</div>
                </div>
              </div>
            ) : result ? (
              <div className="mb-8 w-full max-w-md">
                <h2 className={`text-4xl font-bold mb-2 ${result.ok ? 'text-green-400' : 'text-red-500'}`}>
                  {result.ok ? '✓ TOUCHDOWN' : '✗ CRASHED'}
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed mb-6">
                  {result.ok ? (
                    <>
                      Mission Score: <span className="text-white font-bold">{result.score}</span><br />
                      Earned Credits: <span className="text-[#ffcc00] font-bold">+{Math.floor(result.score / 2)} CR</span><br />
                      Impact: V {stats.vy.toFixed(2)} · H {stats.vx.toFixed(2)} · T {stats.tilt.toFixed(1)}°
                    </>
                  ) : (
                    <span className="text-red-400 font-bold">{result.reason}</span>
                  )}
                </p>

                {result.ok && !scoreSubmitted && mode === 'classic' && (
                  <div className="flex flex-col items-center gap-3 bg-[#00ffcc11] p-4 border border-[#00ffcc33] mb-6">
                    <div className="text-xs tracking-widest text-[#00ffcc]">TRANSMITTING SCORE...</div>
                  </div>
                )}
                {scoreSubmitted && mode === 'classic' && (
                  <div className="text-green-400 text-sm tracking-widest mb-6">SCORE TRANSMITTED</div>
                )}
              </div>
            ) : showShop ? (
              <div className="flex flex-col md:flex-row w-full max-w-5xl h-[80vh] bg-black/80 border border-[#00ffcc44] text-left">
                {/* Left Panel: Ship List */}
                <div className="w-full md:w-1/3 border-r border-[#00ffcc44] overflow-y-auto p-4 flex flex-col gap-2">
                  <div className="text-xl text-[#00ffcc] mb-2 tracking-widest font-bold text-center">SHIPYARD</div>
                  <div className="text-sm text-[#00ffcc88] mb-4 tracking-widest text-center">CREDITS: <span className="text-[#ffcc00] font-bold">{credits}</span></div>
                  
                  {(Object.entries(SHIPS) as [ShipType, ShipDef][]).map(([type, ship]) => {
                    const isUnlocked = unlockedShips.includes(type);
                    const isSelected = selectedShip === type;
                    const isViewing = shopViewShip === type;
                    
                    return (
                      <button
                        key={type}
                        onClick={() => setShopViewShip(type)}
                        className={`p-3 text-left border transition-all ${isViewing ? 'border-[#00ffcc] bg-[#00ffcc11]' : 'border-[#00ffcc44] hover:border-[#00ffcc88] bg-black/50'} ${!isUnlocked && 'opacity-60'}`}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold tracking-widest" style={{ color: ship.color }}>{ship.name}</span>
                          {isSelected && <span className="text-[9px] bg-[#00ffcc] text-black px-1">ACTIVE</span>}
                        </div>
                        <div className="text-[10px] text-[#00ffcc88]">{isUnlocked ? 'UNLOCKED' : `${ship.price} CR`}</div>
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => setShowShop(false)}
                    className="mt-4 px-4 py-3 border border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc] hover:text-[#00ffcc] transition-all tracking-widest text-xs text-center"
                  >
                    BACK TO MENU
                  </button>
                </div>

                {/* Right Panel: Ship Details & Upgrades */}
                <div className="w-full md:w-2/3 p-6 flex flex-col overflow-y-auto">
                  {(() => {
                    const viewDef = SHIPS[shopViewShip];
                    const isUnlocked = unlockedShips.includes(shopViewShip);
                    const isSelected = selectedShip === shopViewShip;
                    const upg = shipUpgrades[shopViewShip];
                    const calc = getCalculatedStats(shopViewShip, upg);
                    const canAffordShip = credits >= viewDef.price;

                    const renderUpgradeRow = (key: keyof ShipUpgrades, label: string, currentVal: string, nextVal: string) => {
                      const currentLevel = upg[key];
                      const isMax = currentLevel >= viewDef.maxUpgrades;
                      const cost = getUpgradeCost(shopViewShip, currentLevel);
                      const canAffordUpg = credits >= cost;

                      return (
                        <div key={key} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-[#00ffcc22] bg-black/30 mb-2">
                          <div className="mb-2 sm:mb-0">
                            <div className="text-sm font-bold text-[#00ffcc] tracking-widest">{label} <span className="text-[10px] text-[#00ffcc66]">LVL {currentLevel}/{viewDef.maxUpgrades}</span></div>
                            <div className="text-xs text-[#00ffcc88]">
                              {currentVal} {!isMax && <span className="text-[#00ffcc]">→ {nextVal}</span>}
                            </div>
                          </div>
                          {isUnlocked && (
                            <button
                              onClick={() => {
                                if (!isMax && canAffordUpg) {
                                  setCredits(c => {
                                    const nc = c - cost;
                                    localStorage.setItem('credits', nc.toString());
                                    return nc;
                                  });
                                  setShipUpgrades(prev => {
                                    const next = { ...prev, [shopViewShip]: { ...prev[shopViewShip], [key]: currentLevel + 1 } };
                                    localStorage.setItem('shipUpgrades', JSON.stringify(next));
                                    return next;
                                  });
                                }
                              }}
                              disabled={isMax || !canAffordUpg}
                              className={`px-4 py-2 text-xs tracking-widest border ${isMax ? 'border-gray-600 text-gray-500' : canAffordUpg ? 'border-[#ffcc00] text-[#ffcc00] hover:bg-[#ffcc0022]' : 'border-red-900 text-red-700'}`}
                            >
                              {isMax ? 'MAXED' : `UPGRADE (${cost} CR)`}
                            </button>
                          )}
                        </div>
                      );
                    };

                    return (
                      <>
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h2 className="text-3xl font-bold tracking-widest mb-1" style={{ color: viewDef.color }}>{viewDef.name}</h2>
                            <p className="text-sm text-[#00ffcc88]">{viewDef.desc}</p>
                          </div>
                          {isUnlocked ? (
                            <button
                              onClick={() => {
                                setSelectedShip(shopViewShip);
                                localStorage.setItem('selectedShip', shopViewShip);
                              }}
                              disabled={isSelected}
                              className={`px-6 py-2 text-sm tracking-widest border font-bold ${isSelected ? 'bg-[#00ffcc] text-black border-[#00ffcc]' : 'border-[#00ffcc] text-[#00ffcc] hover:bg-[#00ffcc22]'}`}
                            >
                              {isSelected ? 'ACTIVE' : 'SELECT'}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (canAffordShip) {
                                  setCredits(c => {
                                    const nc = c - viewDef.price;
                                    localStorage.setItem('credits', nc.toString());
                                    return nc;
                                  });
                                  setUnlockedShips(prev => {
                                    const next = [...prev, shopViewShip];
                                    localStorage.setItem('unlockedShips', JSON.stringify(next));
                                    return next;
                                  });
                                }
                              }}
                              disabled={!canAffordShip}
                              className={`px-6 py-2 text-sm tracking-widest border font-bold ${canAffordShip ? 'border-[#ffcc00] text-[#ffcc00] hover:bg-[#ffcc0022]' : 'border-red-900 text-red-700'}`}
                            >
                              BUY FOR {viewDef.price} CR
                            </button>
                          )}
                        </div>

                        <div className="mb-6">
                          <div className="text-xs tracking-widest text-[#00ffcc66] mb-2">CURRENT STATS</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                            <div className="p-2 border border-[#00ffcc22] bg-black/50">
                              <div className="text-[9px] text-[#00ffcc66]">THRUST</div>
                              <div className="text-[#00ffcc]">{calc.thrust.toFixed(1)}</div>
                            </div>
                            <div className="p-2 border border-[#00ffcc22] bg-black/50">
                              <div className="text-[9px] text-[#00ffcc66]">ROTATION</div>
                              <div className="text-[#00ffcc]">{calc.rot.toFixed(1)}</div>
                            </div>
                            <div className="p-2 border border-[#00ffcc22] bg-black/50">
                              <div className="text-[9px] text-[#00ffcc66]">FUEL</div>
                              <div className="text-[#00ffcc]">{calc.fuel.toFixed(0)}</div>
                            </div>
                            <div className="p-2 border border-[#00ffcc22] bg-black/50">
                              <div className="text-[9px] text-[#00ffcc66]">HULL (IMPACT RESIST)</div>
                              <div className="text-[#00ffcc]">{calc.hull.toFixed(2)}x</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1">
                          <div className="text-xs tracking-widest text-[#00ffcc66] mb-2">UPGRADE SYSTEMS</div>
                          {renderUpgradeRow('engine', 'MAIN ENGINE', calc.thrust.toFixed(1), (viewDef.baseThrust * (1 + (upg.engine + 1) * 0.15)).toFixed(1))}
                          {renderUpgradeRow('rcs', 'RCS THRUSTERS', calc.rot.toFixed(1), (viewDef.baseRot * (1 + (upg.rcs + 1) * 0.15)).toFixed(1))}
                          {renderUpgradeRow('tank', 'FUEL TANKS', calc.fuel.toFixed(0), (viewDef.baseFuel * (1 + (upg.tank + 1) * 0.20)).toFixed(0))}
                          {renderUpgradeRow('hull', 'HULL PLATING', calc.hull.toFixed(2) + 'x', (viewDef.baseHull * (1 + (upg.hull + 1) * 0.15)).toFixed(2) + 'x')}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full max-w-md">
                <div className="flex items-center justify-between w-full mb-2">
                  {isEditingName ? (
                    <div className="flex items-center gap-2 flex-1 mr-4">
                      <input
                        type="text"
                        maxLength={20}
                        value={editNameInput}
                        onChange={(e) => setEditNameInput(e.target.value)}
                        className="bg-black border border-[#00ffcc] text-[#00ffcc] px-2 py-1 text-sm outline-none uppercase flex-1"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          if (editNameInput.trim()) {
                            const newName = editNameInput.trim().toUpperCase();
                            setRegisteredName(newName);
                            localStorage.setItem('pilotName', newName);
                            setIsEditingName(false);
                          }
                        }}
                        className="text-[10px] text-[#00ffcc] hover:bg-[#00ffcc] hover:text-black border border-[#00ffcc] px-2 py-1 tracking-widest"
                      >
                        SAVE
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-[#00ffcc] tracking-widest flex items-center gap-2">
                      ACTIVE PILOT: <span className="font-bold text-white">{registeredName}</span>
                      {isAdmin && <span className="text-[9px] bg-red-600 text-white px-1 font-bold">ADMIN</span>}
                      <button
                        onClick={() => {
                          setEditNameInput(registeredName);
                          setIsEditingName(true);
                        }}
                        className="text-[10px] text-[#00ffcc88] hover:text-[#00ffcc] px-1"
                        title="Edit Callsign"
                      >
                        ✎
                      </button>
                    </div>
                  )}
                  {!isEditingName && (
                    <button 
                      onClick={() => {
                        if (user) {
                          signOut(auth);
                        }
                        localStorage.removeItem('guestId');
                        setGuestId(null);
                        setUser(null);
                        setIsProfileLoaded(false);
                        setRegisteredName('');
                      }}
                      className="text-[10px] text-red-500 hover:text-red-400 border border-red-500/30 hover:border-red-500 px-2 py-1 tracking-widest"
                    >
                      SIGN OUT
                    </button>
                  )}
                </div>
                <div className="text-xs text-[#00ffcc88] mb-6 tracking-widest">CREDITS: <span className="text-[#ffcc00] font-bold">{credits}</span></div>
                
                <div className="grid grid-cols-2 gap-2 mb-4 w-full">
                  <button
                    onClick={() => { setMode('classic'); vibrate(5); }}
                    className={`py-2 sm:py-4 text-[10px] sm:text-sm tracking-widest border flex flex-col items-center gap-1 sm:gap-2 transition-all ${mode === 'classic' ? 'bg-[#00ffcc] text-black border-[#00ffcc] shadow-[0_0_15px_rgba(0,255,204,0.3)]' : 'border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc]'}`}
                  >
                    <Rocket className="w-4 h-4 sm:w-5 h-5" />
                    CLASSIC
                  </button>
                  <button
                    onClick={() => { setMode('explore'); vibrate(5); }}
                    className={`py-2 sm:py-4 text-[10px] sm:text-sm tracking-widest border flex flex-col items-center gap-1 sm:gap-2 transition-all ${mode === 'explore' ? 'bg-[#00ffcc] text-black border-[#00ffcc] shadow-[0_0_15px_rgba(0,255,204,0.3)]' : 'border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc]'}`}
                  >
                    <Target className="w-4 h-4 sm:w-5 h-5" />
                    EXPLORE
                  </button>
                  <button
                    onClick={() => { setMode('fun'); vibrate(5); }}
                    className={`py-2 sm:py-4 text-[10px] sm:text-sm tracking-widest border flex flex-col items-center gap-1 sm:gap-2 transition-all ${mode === 'fun' ? 'bg-[#ffcc00] text-black border-[#ffcc00] shadow-[0_0_15px_rgba(255,204,0,0.3)]' : 'border-[#ffcc0044] text-[#ffcc0088] hover:border-[#ffcc00]'}`}
                  >
                    <Play className="w-4 h-4 sm:w-5 h-5" />
                    FUN
                  </button>
                  <button
                    onClick={() => { setMode('training'); vibrate(5); }}
                    className={`py-2 sm:py-4 text-[10px] sm:text-sm tracking-widest border flex flex-col items-center gap-1 sm:gap-2 transition-all ${mode === 'training' ? 'bg-[#44ff44] text-black border-[#44ff44] shadow-[0_0_15px_rgba(68,255,68,0.3)]' : 'border-[#44ff4444] text-[#44ff4488] hover:border-[#44ff44]'}`}
                  >
                    <Info className="w-4 h-4 sm:w-5 h-5" />
                    TRAINING
                  </button>
                </div>

                {mode === 'classic' && (
                  <div className="flex gap-2 sm:gap-4 mb-4 w-full justify-center">
                    {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                      <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={`px-3 py-1 sm:px-4 sm:py-2 text-[10px] sm:text-xs tracking-widest border ${difficulty === d ? 'bg-[#00ffcc] text-black border-[#00ffcc]' : 'border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc]'}`}
                      >
                        {d.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}

                {mode === 'explore' && (
                  <div className="text-[10px] text-[#00ffcc88] mb-4 text-center max-w-sm">
                    Infinite terrain. Land on stations to refuel and earn credits. Take off again by thrusting. How far can you go?
                  </div>
                )}

                {mode === 'fun' && (
                  <div className="text-[10px] text-[#ffcc0088] mb-4 text-center max-w-sm">
                    Infinite fuel. No crashing. Bounce off everything! Perfect for stunts and relaxing flight.
                  </div>
                )}

                {mode === 'training' && (
                  <div className="text-[10px] text-[#44ff4488] mb-4 text-center max-w-sm">
                    Infinite fuel. Very forgiving landing conditions. Learn the basics without the pressure.
                  </div>
                )}

            {/* Missions Panel (Menu) */}
            {gameState === 'menu' && (
              <div className="sm:absolute sm:top-4 sm:right-4 w-full max-w-md sm:w-64 bg-black/80 border border-[#00ffcc22] p-2 sm:p-4 backdrop-blur-md shadow-[0_0_30px_rgba(0,255,204,0.1)] z-50 mb-4 sm:mb-0">
                <div 
                  className="text-[8px] sm:text-[10px] tracking-[0.3em] text-[#00ffcc] mb-1 sm:mb-3 uppercase flex justify-between items-center border-b border-[#00ffcc22] pb-1 sm:pb-2 cursor-pointer sm:cursor-default"
                  onClick={() => setShowMissionsMobile(!showMissionsMobile)}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-1 h-1 sm:w-1.5 h-1.5 bg-[#00ffcc] animate-pulse"></span>
                    PILOT MISSIONS
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[#ffcc00] font-bold">{completedMissions.length}/3</span>
                    <span className="sm:hidden text-[#00ffcc]">{showMissionsMobile ? '▲' : '▼'}</span>
                  </div>
                </div>
                <div className={`${showMissionsMobile ? 'grid' : 'hidden'} sm:grid grid-cols-1 gap-1 sm:block sm:space-y-3`}>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className={`w-2 h-2 sm:w-4 h-4 border border-[#00ffcc44] mt-0.5 flex-shrink-0 flex items-center justify-center ${completedMissions.includes('precision') ? 'bg-[#00ffcc22] border-[#00ffcc]' : ''}`}>
                      {completedMissions.includes('precision') && <span className="text-[#00ffcc] text-[7px] sm:text-[10px]">✓</span>}
                    </div>
                    <div>
                      <div className={`text-[8px] sm:text-[10px] font-bold tracking-widest ${completedMissions.includes('precision') ? 'text-[#00ffcc44] line-through' : 'text-white'}`}>PRECISION LANDING</div>
                      <div className="text-[6px] sm:text-[8px] text-[#00ffcc66] mt-0.5">Speed &lt; 1m/s</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className={`w-2 h-2 sm:w-4 h-4 border border-[#00ffcc44] mt-0.5 flex-shrink-0 flex items-center justify-center ${completedMissions.includes('fuel') ? 'bg-[#00ffcc22] border-[#00ffcc]' : ''}`}>
                      {completedMissions.includes('fuel') && <span className="text-[#00ffcc] text-[7px] sm:text-[10px]">✓</span>}
                    </div>
                    <div>
                      <div className={`text-[8px] sm:text-[10px] font-bold tracking-widest ${completedMissions.includes('fuel') ? 'text-[#00ffcc44] line-through' : 'text-white'}`}>FUEL CONSERVATION</div>
                      <div className="text-[6px] sm:text-[8px] text-[#00ffcc66] mt-0.5">Fuel &gt; 80%</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className={`w-2 h-2 sm:w-4 h-4 border border-[#00ffcc44] mt-0.5 flex-shrink-0 flex items-center justify-center ${completedMissions.includes('explore') ? 'bg-[#00ffcc22] border-[#00ffcc]' : ''}`}>
                      {completedMissions.includes('explore') && <span className="text-[#00ffcc] text-[7px] sm:text-[10px]">✓</span>}
                    </div>
                    <div>
                      <div className={`text-[8px] sm:text-[10px] font-bold tracking-widest ${completedMissions.includes('explore') ? 'text-[#00ffcc44] line-through' : 'text-white'}`}>LONG HAUL</div>
                      <div className="text-[6px] sm:text-[8px] text-[#00ffcc66] mt-0.5">5 pads in Explore</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

                {/* Mobile/Small Screen Missions (Menu) - REMOVED, now using absolute corner panel */}

                {leaderboard.length > 0 && mode === 'classic' && (
                  <div className="hidden sm:block w-full bg-black/50 border border-[#00ffcc22] p-4 mb-4 text-left">
                    <div className="text-xs tracking-widest text-[#00ffcc88] mb-3 text-center">TOP PILOTS</div>
                    <div className="space-y-2">
                      {leaderboard.map((entry, i) => (
                        <div key={entry.id} className="flex justify-between items-center text-sm">
                          <div className="flex gap-3">
                            <span className="text-[#00ffcc44] w-4">{i + 1}.</span>
                            <span className="text-white">{entry.playerName}</span>
                            <span className="text-[10px] text-[#00ffcc66] self-center">[{entry.difficulty}]</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-[#00ffcc]">{entry.score}</span>
                            {isAdmin && (
                              <button
                                onClick={() => entry.id && deleteLeaderboardEntry(entry.id)}
                                className="text-red-500 hover:text-red-400 text-[10px] border border-red-500/30 px-1"
                              >
                                DEL
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {registeredName && !showShop && (
              <div className="flex flex-col items-center gap-2 mt-2 w-full">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full max-w-xs sm:max-w-none justify-center px-4 sm:px-0">
                  <button
                    onClick={() => { startGame(); vibrate(15); }}
                    className="w-full sm:w-auto px-6 sm:px-12 py-2 sm:py-5 border-2 border-[#00ffcc] text-[#00ffcc] hover:bg-[#00ffcc] hover:text-black transition-all duration-200 tracking-widest font-bold text-[10px] sm:text-base shadow-[0_0_20px_rgba(0,255,204,0.2)] active:scale-95"
                  >
                    {gameState === 'menu' ? 'INITIATE DESCENT' : 'RETRY MISSION'}
                  </button>
                  {gameState === 'menu' && (
                    <button
                      onClick={() => { setShowShop(true); vibrate(10); }}
                      className="w-full sm:w-auto px-6 sm:px-12 py-2 sm:py-5 border-2 border-[#ffcc00] text-[#ffcc00] hover:bg-[#ffcc00] hover:text-black transition-all duration-200 tracking-widest font-bold text-[10px] sm:text-base shadow-[0_0_20px_rgba(255,204,0,0.2)] active:scale-95"
                    >
                      SHIPYARD
                    </button>
                  )}
                  {gameState !== 'menu' && (
                    <button
                      onClick={() => { exitToMenu(); vibrate(10); }}
                      className="w-full sm:w-auto px-8 sm:px-12 py-2 sm:py-5 border-2 border-[#00ffcc44] text-[#00ffcc88] hover:border-[#00ffcc] hover:text-[#00ffcc] transition-all duration-200 tracking-widest font-bold text-[10px] sm:text-base active:scale-95"
                    >
                      MENU
                    </button>
                  )}
                </div>
                {gameState === 'menu' && (
                  <button
                    onClick={startTutorial}
                    className="text-[8px] sm:text-[10px] text-[#00ffcc66] hover:text-[#00ffcc] tracking-[0.2em] sm:tracking-[0.3em] transition-all"
                  >
                    — REPLAY TRAINING SIMULATION —
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
