import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { authAPI } from '../../services/api';

const VerifyEmail = () => {
  const { token }  = useParams();
  const navigate   = useNavigate();
  const { isAuthenticated, refreshUser } = useAuth();

  // 'verifying' | 'success' | 'error'
  const [status,    setStatus]    = useState('verifying');
  const [errorMsg,  setErrorMsg]  = useState('');
  const [countdown, setCountdown] = useState(5);

  // ── Step 1: hit the backend as soon as the page loads ──────────────────────
  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus('error');
        setErrorMsg('No verification token found in the URL. Please use the link from your email.');
        return;
      }

      try {
        const res = await authAPI.verifyEmail(token);
        if (res.data.success) {
          // Update the auth context so isEmailVerified flips immediately in the app
          if (isAuthenticated) await refreshUser();
          setStatus('success');
        } else {
          setStatus('error');
          setErrorMsg(res.data.message || 'Verification failed.');
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          err.response?.data?.message ||
          'The verification link is invalid or has expired. Please request a new one.'
        );
      }
    };

    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Step 2: auto-redirect after success ────────────────────────────────────
  useEffect(() => {
    if (status !== 'success') return;
    if (countdown === 0) {
      navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true });
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown, isAuthenticated, navigate]);

  // ── Verifying (spinner) ────────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <ArrowPathIcon className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
          <p className="text-gray-600 font-medium text-lg">Verifying your email address…</p>
          <p className="text-gray-400 text-sm">This only takes a moment.</p>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-green-100 p-8 text-center space-y-5">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircleIcon className="w-11 h-11 text-green-600" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-gray-900">Email Verified!</h2>
            <p className="text-gray-500 mt-2 text-sm leading-relaxed">
              Your email address has been verified successfully.
              You can now sign in with your new email address and will receive all
              appointment reminders and notifications.
            </p>
          </div>

          <p className="text-sm text-gray-400">
            Redirecting in <span className="font-semibold text-gray-600">{countdown}</span> second{countdown !== 1 ? 's' : ''}…
          </p>

          <button
            onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true })}
            className="w-full py-3 px-4 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
          >
            {isAuthenticated ? 'Go to Dashboard' : 'Sign In'}
          </button>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-red-100 p-8 text-center space-y-5">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <XCircleIcon className="w-11 h-11 text-red-500" />
        </div>

        <div>
          <h2 className="text-2xl font-bold text-gray-900">Verification Failed</h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">{errorMsg}</p>
        </div>

        <div className="space-y-3 pt-1">
          {isAuthenticated ? (
            <>
              <button
                onClick={() => navigate('/dashboard', { replace: true })}
                className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <EnvelopeIcon className="w-5 h-5" />
                Back to Dashboard — Resend from there
              </button>
              <p className="text-xs text-gray-400">
                Use the "Resend verification email" button on the dashboard banner.
              </p>
            </>
          ) : (
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Go to Sign In
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
