import React, { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  HeartIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { authAPI } from '../../services/api';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

function getChecks(pw) {
  return {
    length:    pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    digit:     /\d/.test(pw),
    special:   /[@$!%*?&]/.test(pw),
  };
}

const StrengthBar = ({ password }) => {
  if (!password) return null;
  const checks = getChecks(password);
  const passed = Object.values(checks).filter(Boolean).length;
  const barColor =
    passed <= 2 ? 'bg-red-500' :
    passed <= 3 ? 'bg-yellow-500' :
    passed === 4 ? 'bg-blue-500' : 'bg-green-500';
  const rules = [
    { key: 'length',    label: 'At least 8 characters' },
    { key: 'uppercase', label: 'One uppercase letter' },
    { key: 'lowercase', label: 'One lowercase letter' },
    { key: 'digit',     label: 'One number' },
    { key: 'special',   label: 'One special character (@$!%*?&)' },
  ];
  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-1">
        {[1,2,3,4,5].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= passed ? barColor : 'bg-gray-200'}`} />
        ))}
      </div>
      <ul className="space-y-1">
        {rules.map(({ key, label }) => (
          <li key={key} className={`flex items-center space-x-1.5 text-xs ${checks[key] ? 'text-green-600' : 'text-gray-400'}`}>
            {checks[key]
              ? <CheckCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
              : <XCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ResetPassword = () => {
  const { token }  = useParams();
  const navigate   = useNavigate();

  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword]       = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [errors, setErrors]                   = useState({});
  const [loading, setLoading]                 = useState(false);
  const [serverError, setServerError]         = useState('');
  const [success, setSuccess]                 = useState(false);

  const validate = () => {
    const e = {};
    if (!password) {
      e.password = 'Password is required';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters';
    } else if (!PASSWORD_REGEX.test(password)) {
      e.password = 'Password must contain uppercase, lowercase, number, and a special character (@$!%*?&)';
    }
    if (!confirmPassword) {
      e.confirmPassword = 'Please confirm your new password';
    } else if (password !== confirmPassword) {
      e.confirmPassword = 'Passwords do not match';
    }
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    try {
      setLoading(true);
      setServerError('');
      await authAPI.resetPassword(token, { password, confirmPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (err) {
      setServerError(
        err.response?.data?.message || 'Failed to reset password. The link may have expired.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-gray-50 to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-xl border border-white/20 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircleIcon className="w-9 h-9 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Password Reset!</h2>
            <p className="text-gray-600 mb-2">Your password has been updated successfully.</p>
            <p className="text-sm text-gray-500 mb-6">Redirecting you to sign in...</p>
            <Link
              to="/login"
              className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
            >
              <span>Sign In Now</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-gray-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <HeartIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mt-4">Set New Password</h1>
          <p className="text-gray-600 mt-2">Choose a strong password for your account.</p>
        </div>

        <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-xl border border-white/20 p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {/* New password */}
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-semibold text-gray-700">
                New Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: '' })); }}
                  className={`w-full px-4 py-3 pr-12 bg-gray-50/50 border-2 rounded-xl focus:outline-none focus:bg-white transition-all duration-200 ${
                    errors.password ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'
                  }`}
                  placeholder="Create a strong password"
                />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-red-600">{errors.password}</p>}
              <StrengthBar password={password} />
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-semibold text-gray-700">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); if (errors.confirmPassword) setErrors(p => ({ ...p, confirmPassword: '' })); }}
                  className={`w-full px-4 py-3 pr-12 bg-gray-50/50 border-2 rounded-xl focus:outline-none focus:bg-white transition-all duration-200 ${
                    errors.confirmPassword ? 'border-red-400 focus:border-red-500' :
                    (confirmPassword && confirmPassword === password) ? 'border-green-400' :
                    'border-gray-200 focus:border-blue-500'
                  }`}
                  placeholder="Confirm your password"
                />
                <button type="button" onClick={() => setShowConfirm(p => !p)}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showConfirm ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
              {errors.confirmPassword
                ? <p className="text-sm text-red-600">{errors.confirmPassword}</p>
                : confirmPassword && confirmPassword === password
                ? <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircleIcon className="w-3.5 h-3.5" /> Passwords match</p>
                : null}
            </div>

            {serverError && (
              <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-700">{serverError}</p>
                  {serverError.toLowerCase().includes('expired') && (
                    <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline font-medium">
                      Request a new reset link
                    </Link>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Resetting...</span>
                </>
              ) : (
                <span>Reset Password</span>
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-blue-600 font-medium transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
