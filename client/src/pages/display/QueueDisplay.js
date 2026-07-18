import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
const POLLING_INTERVAL_MS = 5000;

// Utilities

const formatTime = () =>
  new Date().toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const formatDate = () =>
  new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// Token visual maps (token type → display style)

// Now-Serving card gradient
const NOW_SERVING_BG = {
  A: 'from-blue-600  to-blue-700',
  W: 'from-amber-500 to-amber-600',
  E: 'from-red-600   to-red-700',
};

// Ready / Waiting chip styles
const CHIP_STYLE = {
  A: { border: 'border-blue-600',  bg: 'bg-blue-600/20',  text: 'text-blue-200',  label: 'A' },
  W: { border: 'border-amber-500', bg: 'bg-amber-500/20', text: 'text-amber-200', label: 'W' },
  E: { border: 'border-red-500',   bg: 'bg-red-500/20',   text: 'text-red-200',   label: 'E' },
};

const chipStyle = (tokenType) => CHIP_STYLE[tokenType] || CHIP_STYLE.A;

// Token Chip

const TokenChip = ({ entry, size = 'md', highlight = false }) => {
  const cs = chipStyle(entry.tokenType);
  const isEmergency = entry.isEmergency || entry.tokenType === 'E';
  const isLate = entry.isLate;

  return (
    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 transition-all ${cs.border} ${
      highlight ? cs.bg + ' shadow-lg' : 'bg-gray-800/60'
    }`}>
      {/* Token type prefix badge */}
      <span className={`text-[10px] font-black uppercase tracking-widest opacity-60 ${cs.text}`}>
        {entry.tokenType}
      </span>

      {/* Token number */}
      <span className={`font-black ${cs.text} ${size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base'}`}>
        {entry.queueNumber}
      </span>

      {/* Initials */}
      <span className="text-xs text-gray-500 hidden sm:inline">{entry.initials}</span>

      {/* Badges */}
      {isEmergency && <span className="text-red-400 text-xs"></span>}
      {isLate      && <span className="text-orange-400 text-xs" title="Late arrival"></span>}
      {entry.priority === 'urgent' && !isEmergency && <span className="text-red-400 text-xs"></span>}
    </div>
  );
};

// Room Panel

const RoomPanel = ({ room }) => {
  const hasNowServing  = !!room.nowServing;
  const readyCount     = room.readyZone?.length || 0;
  const upNextCount    = room.upNext?.length || 0;
  const isPaused       = room.sessionStatus === 'paused';
  const hasEmergency   = room.upNext?.some(e => e.isEmergency || e.tokenType === 'E') ||
                         room.readyZone?.some(e => e.isEmergency || e.tokenType === 'E') ||
                         room.nowServing?.tokenType === 'E';
  const hasLate        = room.upNext?.some(e => e.isLate) ||
                         room.readyZone?.some(e => e.isLate);

  const nowBg = room.nowServing
    ? NOW_SERVING_BG[room.nowServing.tokenType] || NOW_SERVING_BG.A
    : 'from-gray-700 to-gray-800';

  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 flex flex-col">

      {/* Room Header */}
      <div className="bg-gradient-to-r from-blue-900 to-blue-800 px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white">{room.room}</h2>
            <p className="text-xs text-blue-300">{room.department}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-blue-400">Doctor</p>
            <p className="text-sm font-semibold text-blue-100">{room.doctor || 'TBD'}</p>
          </div>
        </div>
      </div>

      {/* Emergency banner */}
      {hasEmergency && (
        <div className="bg-red-600/20 border-b border-red-600/30 px-5 py-2 flex items-center gap-2">
          <span className="text-red-400 text-base"></span>
          <p className="text-red-300 text-xs font-semibold">
            Emergency patient in queue — priority override in effect.
          </p>
        </div>
      )}

      {/* Paused / Delay banner */}
      {isPaused && (
        <div className="bg-yellow-500/15 border-b border-yellow-500/25 px-5 py-2 flex items-center gap-2">
          <span className="text-yellow-400 text-base"></span>
          <p className="text-yellow-300 text-xs font-semibold">
            Queue temporarily paused.{room.delayMessage && ` ${room.delayMessage}`}
          </p>
        </div>
      )}

      {/* Late arrival notice */}
      {hasLate && !isPaused && (
        <div className="bg-orange-500/10 border-b border-orange-500/20 px-5 py-1.5 flex items-center gap-2">
          <span className="text-orange-400 text-xs"></span>
          <p className="text-orange-300 text-xs">
            Late arrival(s) in queue — order adjusted per hospital policy.
          </p>
        </div>
      )}

      {/* Now Serving */}
      <div className="px-5 py-5 bg-gray-900">
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Now Serving</p>
        {hasNowServing ? (
          <div className="flex items-center gap-4">
            {/* Large token card */}
            <div className={`relative flex flex-col items-center justify-center rounded-2xl shadow-2xl bg-gradient-to-br ${nowBg}`}
              style={{ minWidth: 120, height: 90 }}>
              {/* Urgent / Emergency indicator */}
              {(room.nowServing.priority === 'urgent' || room.nowServing.tokenType === 'E') && (
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-black">!</span>
                </div>
              )}
              {/* Type prefix */}
              <span className="text-white/50 text-[9px] font-black uppercase tracking-widest leading-none mb-1">
                {room.nowServing.tokenType === 'E' ? 'EMERGENCY' :
                 room.nowServing.tokenType === 'W' ? 'WALK-IN' : 'APPOINTMENT'}
              </span>
              {/* Token number */}
              <p className="text-4xl font-black text-white leading-none">{room.nowServing.queueNumber}</p>
              <p className="text-xs text-white/60 mt-1">{room.nowServing.initials}</p>
            </div>

            {/* Status label + assigned room badge */}
            <div>
              <span className={`inline-block px-3 py-1.5 rounded-full text-sm font-bold ${
                room.nowServing.status === 'in_consultation'
                  ? 'bg-purple-900 text-purple-300'
                  : 'bg-orange-900/80 text-orange-300'
              }`}>
                {room.nowServing.status === 'in_consultation' ? ' In Consultation' : ' Called'}
              </span>
              {room.nowServing.room && (
                <p className="mt-2 text-xs font-mono font-semibold text-gray-500">
                   {room.nowServing.room}
                </p>
              )}
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

      {/* Please Be Ready */}
      {readyCount > 0 && (
        <div className="px-5 py-3 border-t border-amber-800/40 bg-amber-900/10">
          <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2">
            Please Be Ready
          </p>
          <div className="flex flex-wrap gap-2">
            {room.readyZone.map((entry, i) => (
              <TokenChip key={i} entry={entry} highlight={i === 0} size="md" />
            ))}
          </div>
        </div>
      )}

      {/* Waiting */}
      {upNextCount > 0 && (
        <div className="px-5 py-3 border-t border-gray-800 bg-gray-900">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Waiting</p>
          <div className="flex flex-wrap gap-2">
            {room.upNext.map((entry, i) => (
              <TokenChip key={i} entry={entry} highlight={false} size="sm" />
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-auto px-5 py-2 bg-gray-950 border-t border-gray-800">
        <p className="text-[10px] text-gray-700 text-center leading-tight">
          Queue order may change due to appointment priority, emergency cases, and doctor availability.
        </p>
      </div>
    </div>
  );
};

// Token Legend

const TokenLegend = () => (
  <div className="flex items-center gap-5 text-xs text-gray-500">
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />
      <span>A — Appointment</span>
    </span>
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" />
      <span>W — Walk-in</span>
    </span>
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm bg-red-600 inline-block" />
      <span>E — Emergency</span>
    </span>
    <span className="flex items-center gap-1.5">
      <span className="text-orange-400"></span>
      <span>Late arrival</span>
    </span>
  </div>
);

// Main Component

const QueueDisplay = () => {
  const [rooms, setRooms]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentTime, setCurrentTime] = useState(formatTime());
  const [connected, setConnected]     = useState(false);
  const socketRef  = useRef(null);
  const pollingRef = useRef(null);

  const fetchDisplay = useCallback(async () => {
    try {
      const res  = await fetch(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5000/api'}/queue/display`
      );
      const data = await res.json();
      if (data.success) {
        setRooms(data.data.rooms || []);
        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, []);

  // Clock tick
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(formatTime()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Socket.io + polling fallback
  useEffect(() => {
    fetchDisplay();
    try {
      const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);
        socket.emit('queue:subscribe-display');
        clearInterval(pollingRef.current);
      });
      socket.on('disconnect', () => {
        setConnected(false);
        pollingRef.current = setInterval(fetchDisplay, POLLING_INTERVAL_MS);
      });

      const refresh = () => fetchDisplay();
      ['queue:created', 'queue:called', 'queue:completed', 'queue:updated',
       'queue:display:update', 'queue:recalculated', 'queue:paused', 'queue:resumed'
      ].forEach(ev => socket.on(ev, refresh));
    } catch {
      pollingRef.current = setInterval(fetchDisplay, POLLING_INTERVAL_MS);
    }

    return () => {
      socketRef.current?.disconnect();
      clearInterval(pollingRef.current);
    };
  }, [fetchDisplay]);

  // Global emergency flag across all rooms
  const anyEmergency = rooms.some(r =>
    r.nowServing?.tokenType === 'E' ||
    r.readyZone?.some(e => e.tokenType === 'E') ||
    r.upNext?.some(e => e.tokenType === 'E')
  );

  return (
    <div
      style={{ fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}
      className="min-h-screen bg-gray-950 text-white flex flex-col select-none"
    >
      {/* Top Bar */}
      <div className="bg-gradient-to-r from-blue-900 to-blue-800 px-8 py-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-500/30 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">MediQueue OPD</h1>
            <p className="text-xs text-blue-300">{formatDate()}</p>
          </div>
        </div>

        {/* Clock + connection */}
        <div className="text-right">
          <div className="text-4xl font-black text-blue-100 tabular-nums">{currentTime}</div>
          <div className="flex items-center justify-end gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
            <span className="text-xs text-blue-400">
              {connected ? 'Live' : 'Auto-refresh'} · {lastUpdated || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Global emergency ticker */}
      {anyEmergency && (
        <div className="bg-red-700/80 px-8 py-2 flex items-center justify-center gap-3 border-b border-red-600/50">
          <span className="text-xl animate-pulse"></span>
          <p className="text-sm font-bold text-red-100">
            Emergency patient present — emergency cases are prioritised above all queue positions.
          </p>
          <span className="text-xl animate-pulse"></span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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

      {/* Footer */}
      <div className="bg-gray-900 px-8 py-3 border-t border-gray-800 flex items-center justify-between">
        <TokenLegend />
        <p className="text-xs text-gray-600">
          Patients are called based on appointment tokens, check-in status, emergency priority, and doctor availability.
        </p>
      </div>
    </div>
  );
};

export default QueueDisplay;
