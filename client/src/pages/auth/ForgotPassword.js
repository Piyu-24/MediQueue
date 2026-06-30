import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EnvelopeIcon,
  HeartIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { authAPI } from '../../services/api';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

const ForgotPassword = () => {
  const [email, setEmail]         = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [serverError, setServerError] = useState('');

  const validateEmail = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Email address is required';
    if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address (e.g. yourname@example.com)';
    return '';
  };

  const handleBlur = () => {
    setEmailError(validateEmail(email));
  };

  const handleChange = (e) => {
    setEmail(e.target.value);
    if (emailError) setEmailError('');
    if (serverError) setServerError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const error = validateEmail(email);
    if (error) { setEmailError(error); return; }

    try {
      setLoading(true);
      setServerError('');
      await authAPI.forgotPassword({ email: email.trim().toLowerCase() });
      setSubmitted(true);
    } catch (err) {
      setServerError(
        err.response?.data?.message || 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-gray-50 to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-xl border border-white/20 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircleIcon className="w-9 h-9 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Check Your Inbox</h2>
            <p className="text-gray-600 mb-2">
              If an account exists for <span className="font-semibold text-gray-800">{email.trim()}</span>, a
              password reset link has been sent.
            </p>
            <p className="text-sm text-gray-500 mb-8">
              The link expires in <strong>10 minutes</strong>. Check your spam folder if you
              don't see it.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isEmailValid = EMAIL_REGEX.test(email.trim());

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-gray-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <HeartIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mt-4">Forgot Password?</h1>
          <p className="text-gray-600 mt-2">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        <div className="bg-white/80 backdrop-blur-lg rounded-3xl shadow-xl border border-white/20 p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-semibold text-gray-700">
                Email Address
              </label>
              <div className="relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                  value={email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 pr-10 bg-gray-50/50 border-2 rounded-xl focus:outline-none focus:bg-white transition-all duration-200 ${
                    emailError
                      ? 'border-red-400 focus:border-red-500'
                      : isEmailValid
                      ? 'border-green-400 focus:border-green-500'
                      : 'border-gray-200 focus:border-blue-500'
                  }`}
                  placeholder="yourname@example.com"
                />
                <div className="absolute right-3 top-3">
                  {emailError ? (
                    <ExclamationCircleIcon className="w-5 h-5 text-red-500" />
                  ) : isEmailValid ? (
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                  ) : (
                    <EnvelopeIcon className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>
              {emailError && (
                <p className="text-sm text-red-600">{emailError}</p>
              )}
            </div>

            {serverError && (
              <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{serverError}</p>
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
                  <span>Sending...</span>
                </>
              ) : (
                <span>Send Reset Link</span>
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

export default ForgotPassword;
