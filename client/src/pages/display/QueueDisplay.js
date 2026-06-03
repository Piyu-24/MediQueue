import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
const POLLING_INTERVAL_MS = 5000;

// ── Utility ──────────────────────────────────────────────────────────────────
const formatTime = () =>
  new Date().toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const formatDate = () =>
  new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// ── Public Queue Display Screen ──────────────────────────────────────────────
// Route: /display  (no auth required)
// Designed for large TV/monitor display in the OPD waiting area
const QueueDisplay = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentTime, setCurrentTime] = useState(formatTime());
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const pollingRef = useRef(null);

  // ── Fetch display data ────────────────────────────────────────────────────
  const fetchDisplay = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/queue/display`
      );
      const data = await res.json();
      if (data.success) {
        setRooms(data.data.rooms || []);
        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);
      }
    } catch {
      // Silent — keep showing last known state
      setLoading(false);
    }
  }, []);

  // ── Clock tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(formatTime()), 1000);
    return () => clearInterval(tick);
  }, []);

  // ── Socket.io + polling fallback ──────────────────────────────────────────
  useEffect(() => {
    fetchDisplay();

    // Try Socket.io
    try {
      const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);
        socket.emit('queue:subscribe-display');
        clearInterval(pollingRef.current); // stop polling when socket is alive
      });

      socket.on('disconnect', () => {
        setConnected(false);
        // Fall back to polling
        pollingRef.current = setInterval(fetchDisplay, POLLING_INTERVAL_MS);
      });

      socket.on('queue:created', fetchDisplay);
      socket.on('queue:called', fetchDisplay);
      socket.on('queue:completed', fetchDisplay);
      socket.on('queue:updated', fetchDisplay);
      socket.on('queue:display:update', fetchDisplay);
      socket.on('queue:recalculated', fetchDisplay);
      socket.on('queue:paused', fetchDisplay);
      socket.on('queue:resumed', fetchDisplay);
    } catch {
      // No socket — just poll
      pollingRef.current = setInterval(fetchDisplay, POLLING_INTERVAL_MS);
    }

    return () => {
      socketRef.current?.disconnect();
      clearInterval(pollingRef.current);
    };
  }, [fetchDisplay]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{ fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}
      className="min-h-screen bg-gray-950 text-white flex flex-col select-none"
    >
      {/* ── Top Bar ── */}
      <div className="bg-gradient-to-r from-blue-900 to-blue-800 px-8 py-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-blue-400 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">MediQueue OPD</h1>
            <p className="text-xs text-blue-300">{formatDate()}</p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-4xl font-black text-blue-200 tabular-nums">{currentTime}</div>
          <div className="flex items-center justify-end space-x-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
            <span className="text-xs text-blue-400">
              {connected ? 'Live' : 'Auto-refresh'} · Updated {lastUpdated || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-blue-300 text-xl">Loading queue...</p>
            </div>
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <svg className="w-24 h-24 text-gray-700 mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-3xl font-bold text-gray-500 mb-2">No Active Queue</h2>
              <p className="text-gray-600">Queue will appear here when patients check in</p>
            </div>
          </div>
        ) : (
          <div className={`grid gap-6 h-full ${
            rooms.length === 1 ? 'grid-cols-1 max-w-2xl mx-auto' :
            rooms.length === 2 ? 'grid-cols-2' :
            rooms.length <= 4 ? 'grid-cols-2' :
            'grid-cols-3'
          }`}>
            {rooms.map(room => (
              <RoomPanel key={room.room} room={room} />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="bg-gray-900 px-8 py-3 text-center">
        <p className="text-xs text-gray-600">
          Please remain seated. Your queue number will be called. · MediQueue Hospital Information System
        </p>
      </div>
    </div>
  );
};

// ── Token color by type ───────────────────────────────────────────────────────
const tokenBg = (tokenType, status) => {
  if (status === 'in_consultation' || status === 'in-consultation') return 'from-purple-600 to-purple-700';
  if (status === 'called') return 'from-orange-500 to-orange-600';
  if (tokenType === 'E') return 'from-red-600 to-red-700';
  if (tokenType === 'W') return 'from-amber-500 to-amber-600';
  return 'from-blue-600 to-blue-700';
};

// ── Room Panel Component ──────────────────────────────────────────────────────
const RoomPanel = ({ room }) => {
  const hasNowServing = !!room.nowServing;
  const readyCount = room.readyZone?.length || 0;
  const upNextCount = room.upNext?.length || 0;
  const isPaused = room.sessionStatus === 'paused';

  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 flex flex-col">
      {/* Room Header */}
      <div className="bg-gradient-to-r from-blue-800 to-blue-700 px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">{room.room}</h2>
            <p className="text-xs text-blue-300">{room.department}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-blue-300">Doctor</p>
            <p className="text-sm font-semibold text-blue-100">{room.doctor || 'TBD'}</p>
          </div>
        </div>
      </div>

      {/* Paused / Delay banner */}
      {isPaused && (
        <div className="bg-yellow-500/20 border-b border-yellow-500/30 px-5 py-2 flex items-center gap-2">
          <span className="text-yellow-400 text-lg">⏸</span>
          <p className="text-yellow-300 text-sm font-semibold">
            Queue temporarily paused.
            {room.delayMessage && ` ${room.delayMessage}`}
          </p>
        </div>
      )}

      {/* Now Serving */}
      <div className={`px-5 py-6 flex-1 ${hasNowServing ? 'bg-gray-900' : 'bg-gray-950'}`}>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Now Serving</p>
        {hasNowServing ? (
          <div className="flex items-center space-x-4">
            <div className={`relative flex items-center justify-center rounded-2xl shadow-2xl bg-gradient-to-br ${
              tokenBg(room.nowServing.tokenType, room.nowServing.status)
            }`} style={{ width: 140, height: 100 }}>
              {(room.nowServing.priority === 'urgent' || room.nowServing.tokenType === 'E') && (
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-black">!</span>
                </div>
              )}
              <div className="text-center">
                <p className="text-4xl font-black text-white leading-none">{room.nowServing.queueNumber}</p>
                <p className="text-xs text-white/70 mt-1">{room.nowServing.initials}</p>
              </div>
            </div>
            <div>
              <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                room.nowServing.status === 'in_consultation' || room.nowServing.status === 'in-consultation'
                  ? 'bg-purple-900 text-purple-300'
                  : 'bg-orange-900 text-orange-300'
              }`}>
                {(room.nowServing.status === 'in_consultation' || room.nowServing.status === 'in-consultation')
                  ? '🩺 In Consultation' : '📢 Called'}
              </span>
              {room.completedCount > 0 && (
                <p className="text-xs text-gray-600 mt-2">{room.completedCount} completed today</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-20">
            <p className="text-2xl text-gray-700 font-bold">— —</p>
          </div>
        )}
      </div>

      {/* Please Be Ready — READY zone */}
      {readyCount > 0 && (
        <div className="px-5 py-3 border-t border-amber-700/40 bg-amber-900/20">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2">Please Be Ready</p>
          <div className="flex flex-wrap gap-2">
            {room.readyZone.map((entry, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${
                i === 0
                  ? 'bg-amber-900/60 border-amber-600 text-amber-200'
                  : 'bg-gray-800 border-gray-700 text-gray-400'
              }`}>
                {entry.tokenType === 'E' && <span className="text-red-400 text-xs">🚨</span>}
                {entry.priority === 'urgent' && entry.tokenType !== 'E' && <span className="text-red-400 text-xs">🔴</span>}
                <span className={`text-sm font-bold ${i === 0 ? 'text-amber-100' : 'text-gray-300'}`}>
                  {entry.queueNumber}
                </span>
                <span className="text-xs text-gray-500">{entry.initials}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting tokens */}
      {upNextCount > 0 && (
        <div className="px-5 py-4 border-t border-gray-800 bg-gray-900">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Waiting</p>
          <div className="flex flex-wrap gap-2">
            {room.upNext.map((entry, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border ${
                i === 0
                  ? 'bg-blue-900/60 border-blue-700 text-blue-200'
                  : 'bg-gray-800 border-gray-700 text-gray-400'
              }`}>
                {entry.tokenType === 'E' && <span className="text-red-400 text-xs">🚨</span>}
                {entry.priority === 'urgent' && entry.tokenType !== 'E' && <span className="text-red-400 text-xs">🔴</span>}
                <span className={`text-sm font-bold ${i === 0 ? 'text-blue-100' : 'text-gray-300'}`}>
                  {entry.queueNumber}
                </span>
                <span className="text-xs text-gray-500">{entry.initials}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="px-5 py-2 bg-gray-950 border-t border-gray-800">
        <p className="text-xs text-gray-700 text-center leading-tight">
          Queue order may change due to appointment priority, emergency cases, and doctor availability.
        </p>
      </div>
    </div>
  );
};

export default QueueDisplay;
