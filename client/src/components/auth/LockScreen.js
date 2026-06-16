import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-hot-toast';

const LockScreen = () => {
  const { user, unlockScreen, reAuthenticate, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError('');

    const result = await reAuthenticate(password);

    if (result.success) {
      unlockScreen(result.token);
      setPassword('');
      toast.success('Screen unlocked');
    } else {
      setError(result.message || 'Incorrect password');
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    await logout();
  };

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-95 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4">
        {/* Avatar */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold mb-3 shadow-lg">
            {initials}
          </div>
          <h2 className="text-white text-xl font-semibold">
            {user ? `${user.firstName} ${user.lastName}` : 'Session Locked'}
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Your session was locked due to inactivity
          </p>
        </div>

        {/* Unlock form */}
        <form onSubmit={handleUnlock} className="bg-gray-800 rounded-2xl p-6 shadow-2xl">
          <label className="block text-gray-300 text-sm font-medium mb-2">
            Enter your password to continue
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Password"
            autoFocus
            className="w-full px-4 py-3 rounded-lg bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
          />
          {error && (
            <p className="mt-2 text-red-400 text-sm">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="mt-4 w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold transition"
          >
            {loading ? 'Verifying…' : 'Unlock'}
          </button>
        </form>

        {/* Logout option */}
        <div className="mt-4 text-center">
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white text-sm underline transition"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
};

export default LockScreen;
