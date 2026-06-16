import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

/**
 * Wrap any sensitive action with this modal.
 *
 * Usage:
 *   const [showReAuth, setShowReAuth] = useState(false);
 *
 *   <ReAuthModal
 *     isOpen={showReAuth}
 *     onClose={() => setShowReAuth(false)}
 *     onConfirmed={() => { setShowReAuth(false); doSensitiveAction(); }}
 *     actionLabel="delete this record"
 *   />
 */
const ReAuthModal = ({ isOpen, onClose, onConfirmed, actionLabel = 'perform this action' }) => {
  const { reAuthenticate, unlockScreen } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError('');

    const result = await reAuthenticate(password);

    if (result.success) {
      if (result.token) unlockScreen(result.token);
      setPassword('');
      onConfirmed();
    } else {
      setError(result.message || 'Incorrect password');
    }

    setLoading(false);
  };

  const handleClose = () => {
    setPassword('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center mb-4">
          <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-5V7m0 0a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          </div>
          <div>
            <h3 className="text-gray-900 font-semibold text-lg">Confirm Identity</h3>
            <p className="text-gray-500 text-sm">Re-enter your password to {actionLabel}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Your current password"
            autoFocus
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {error && <p className="mt-1 text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium text-sm transition"
            >
              {loading ? 'Verifying…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReAuthModal;
