# Lunar Descent Pro 🚀🌕

A modern, physics-based reimagining of the classic Lunar Lander arcade game, built entirely with React, HTML5 Canvas, and TypeScript.

![Game Preview](https://img.shields.io/badge/Status-Playable-brightgreen)
![Tech Stack](https://img.shields.io/badge/Tech-React%20%7C%20TypeScript%20%7C%20Canvas-blue)
![Database](https://img.shields.io/badge/Database-Firebase-orange)

## 🎮 Features

*   **Realistic Physics Engine:** Custom-built physics for gravity, thrust, inertia, and rotational momentum.
*   **Dynamic Destruction:** If you crash, the ship physically shatters into debris (capsule, base, legs) that bounce and react to gravity.
*   **Difficulty Levels:** 
    *   **EASY:** Forgiving landing speeds, minimal obstacles.
    *   **MEDIUM:** Standard limits, moderate obstacles.
    *   **HARD:** Strict landing limits, heavy obstacle density.
*   **Global Leaderboard:** Compete with other pilots! Scores are saved to a real-time Firebase database.
*   **Live Telemetry:** HUD displays real-time altitude, vertical/horizontal speed, tilt angle, and fuel. Stats freeze upon impact for accurate feedback.

## 🕹️ Controls

*   `W` or `Up Arrow` - Main Thruster
*   `A` / `D` or `Left/Right Arrows` - Rotate Ship
*   `R` - Quick Restart (disabled while typing in the leaderboard)

## 🛠️ Tech Stack

*   **Frontend:** React 19, TypeScript, Vite
*   **Rendering:** HTML5 `<canvas>` API
*   **Styling:** Tailwind CSS
*   **Backend/Database:** Firebase Firestore (for the leaderboard)

## 🚀 How to Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/lunar-descent-pro.git
   cd lunar-descent-pro
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up Firebase (Optional, for leaderboard):
   * Create a Firebase project and Firestore database.
   * Add your `firebase-applet-config.json` to the root directory.

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000` (or the port provided by Vite).

## 👨‍🚀 Author
Created by MrPauk335 (and AI Assistant).
