import { io } from 'socket.io-client';

/**
 * Singleton Socket.io client for MediQueue real-time features.
 *
 * Usage:
 *   import socketService from '../services/socket';
 *   socketService.on('queue:created', handler);
 *   socketService.joinRoom(userId);
 */

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

let socket = null;

const createSocket = () => {
  if (socket && socket.connected) return socket;

  socket = io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log(`[Socket] Connected: ${socket.id}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${reason}`);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  return socket;
};

const socketService = {
  /** Get (or create) the singleton socket */
  getSocket() {
    if (!socket) createSocket();
    return socket;
  },

  /** Connect and join a user's personal room (for patient push notifications) */
  joinRoom(userId) {
    const s = this.getSocket();
    if (userId) {
      s.emit('join', userId);
    }
  },

  /** Subscribe to display screen queue updates (all rooms) */
  subscribeDisplay() {
    const s = this.getSocket();
    s.emit('queue:subscribe-display');
  },

  /** Join a specific queue room */
  joinQueueRoom(room) {
    const s = this.getSocket();
    s.emit('queue:join-room', room);
  },

  /** Leave a specific queue room */
  leaveQueueRoom(room) {
    if (!socket) return;
    socket.emit('queue:leave-room', room);
  },

  /** Register an event listener */
  on(event, callback) {
    const s = this.getSocket();
    s.on(event, callback);
  },

  /** Remove an event listener */
  off(event, callback) {
    if (!socket) return;
    if (callback) {
      socket.off(event, callback);
    } else {
      socket.off(event);
    }
  },

  /** Disconnect (call on logout) */
  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },

  /** Check connection status */
  isConnected() {
    return socket?.connected ?? false;
  },
};

// Initialize immediately
createSocket();

export default socketService;
