import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  HeartIcon,
  AcademicCapIcon,
  ClockIcon,
  CheckBadgeIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  KeyIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { authAPI, userAPI } from '../../services/api';
import toast from 'react-hot-toast';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NICVerification from '../../components/Patient/NICVerification';

// Password must: 8+ chars, uppercase, lowercase, digit, special char (@$!%*?&)
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const PASSWORD_RULE = 'Must contain uppercase, lowercase, number, and special character (@$!%*?&)';

function getStrengthChecks(password) {
  return {
    length:    password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    digit:     /\d/.test(password),
    special:   /[@$!%*?&]/.test(password),
  };
}

function StrengthIndicator({ password }) {
  if (!password) return null;
  const checks = getStrengthChecks(password);
  const passed = Object.values(checks).filter(Boolean).length;
  const labels = [
    { key: 'length',    text: 'At least 8 characters' },
    { key: 'uppercase', text: 'One uppercase letter' },
    { key: 'lowercase', text: 'One lowercase letter' },
    { key: 'digit',     text: 'One number' },
    { key: 'special',   text: 'One special character (@$!%*?&)' },
  ];
  const barColor =
    passed <= 2 ? 'bg-red-500' :
    passed <= 3 ? 'bg-yellow-500' :
    passed === 4 ? 'bg-blue-500' :
    'bg-green-500';

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= passed ? barColor : 'bg-gray-200'}`} />
        ))}
      </div>
      <ul className="space-y-1">
        {labels.map(({ key, text }) => (
          <li key={key} className={`flex items-center space-x-1.5 text-xs ${checks[key] ? 'text-green-600' : 'text-gray-500'}`}>
            {checks[key]
              ? <CheckCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
              : <XCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PasswordInput({ id, label, value, onChange, showPassword, onToggle, error }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={id === 'currentPassword' ? 'current-password' : 'new-password'}
          className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            error ? 'border-red-400 focus:ring-red-400' : 'border-gray-300'
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
          tabIndex={-1}
        >
          {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const INITIAL_FORM = { currentPassword: '', newPassword: '', confirmPassword: '' };
const INITIAL_SHOW = { current: false, new: false, confirm: false };

const Profile = () => {
  const { user, loading, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  // Email edit state (patients only)
  const [emailEditing, setEmailEditing]   = useState(false);
  const [emailValue, setEmailValue]       = useState('');
  const [emailLoading, setEmailLoading]   = useState(false);
  const [emailError, setEmailError]       = useState('');
  const [resendLoading, setResendLoading] = useState(false);

  // Change-password panel state
  const [pwOpen, setPwOpen]         = useState(false);
  const [form, setForm]             = useState(INITIAL_FORM);
  const [showPw, setShowPw]         = useState(INITIAL_SHOW);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formResult, setFormResult] = useState(null); // { type: 'success'|'error', message }
  const [countdown, setCountdown]   = useState(null);
  const countdownRef                = useRef(null);
  const formRef                     = useRef(null);

  // Auto-scroll to form when opened
  useEffect(() => {
    if (pwOpen && formRef.current) {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }, [pwOpen]);

  // Countdown then sign-out after successful change
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      logout();
      navigate('/login');
      return;
    }
    countdownRef.current = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(countdownRef.current);
  }, [countdown, logout, navigate]);

  const handleResend = async () => {
    try {
      setResendLoading(true);
      const res = await authAPI.resendVerification();
      const msg = res.data?.message || `Verification email sent to ${user.email}. Please check your inbox.`;
      toast.success(msg, { duration: 7000 });
    } catch (err) {
      const msg     = err.response?.data?.message || 'Failed to resend. Please try again.';
      const seconds = err.response?.data?.retryAfterSeconds;
      toast.error(seconds ? `${msg} (retry in ${seconds}s)` : msg, { duration: 6000 });
    } finally {
      setResendLoading(false);
    }
  };

  const handleEmailEdit = () => {
    setEmailValue(user.email);
    setEmailError('');
    setEmailEditing(true);
  };

  const handleEmailCancel = () => {
    setEmailEditing(false);
    setEmailError('');
  };

  const handleEmailSave = async () => {
    const trimmed = emailValue.trim().toLowerCase();
    if (!trimmed) { setEmailError('Email address is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailError('Please enter a valid email address.'); return; }
    if (trimmed === user.email) { setEmailEditing(false); return; }

    try {
      setEmailLoading(true);
      setEmailError('');
      const res = await userAPI.updateProfile(user._id, { email: trimmed });
      // Refresh auth context so the dashboard banner immediately has the correct email
      await refreshUser();
      setEmailEditing(false);
      const sent = res.data?.data?.emailVerificationSent === true;
      // Navigate to dashboard — the verification banner there shows the correct
      // email from the freshly refreshed auth context
      navigate('/dashboard', { state: { emailChanged: true, emailVerificationSent: sent, newEmail: trimmed } });
    } catch (err) {
      setEmailError(err.response?.data?.message || 'Failed to update email. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!user) return null;

  const handleEditClick = () => {
    navigate('/profile/edit');
  };

  const toggleOpen = () => {
    setPwOpen(prev => !prev);
    setForm(INITIAL_FORM);
    setShowPw(INITIAL_SHOW);
    setFieldErrors({});
    setFormResult(null);
  };

  const setField = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    if (fieldErrors[field]) setFieldErrors(prev => ({ ...prev, [field]: '' }));
    if (formResult?.type === 'error') setFormResult(null);
  };

  const validate = () => {
    const errors = {};
    if (!form.currentPassword) errors.currentPassword = 'Current password is required';
    if (!form.newPassword) {
      errors.newPassword = 'New password is required';
    } else if (form.newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters';
    } else if (!PASSWORD_REGEX.test(form.newPassword)) {
      errors.newPassword = PASSWORD_RULE;
    }
    if (!form.confirmPassword) {
      errors.confirmPassword = 'Please confirm your new password';
    } else if (form.newPassword && form.newPassword !== form.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    try {
      setSubmitting(true);
      setFormResult(null);
      await authAPI.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      });
      setForm(INITIAL_FORM);
      setFieldErrors({});
      setFormResult({ type: 'success', message: 'Password updated. Signing you out in 3 seconds…' });
      setCountdown(3);
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to update password. Please try again.';
      setFormResult({ type: 'error', message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-6 sm:py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6 sm:mb-8">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-5 sm:px-8 py-6 sm:py-10 text-white flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center space-x-4 sm:space-x-6 min-w-0">
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm border-2 border-white/30 flex-shrink-0">
                <UserIcon className="w-9 h-9 sm:w-12 sm:h-12 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold break-words">{user.firstName} {user.lastName}</h1>
                <p className="text-blue-100 mt-1 capitalize tracking-wide font-medium">{user.role}</p>
                {user.identityVerificationStatus === 'verified' && (
                  <span className="inline-flex items-center space-x-1 bg-green-500/20 text-green-100 text-xs px-2.5 py-1 rounded-full mt-2 border border-green-500/30">
                    <CheckBadgeIcon className="w-4 h-4" />
                    <span>Verified</span>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleEditClick}
              className="bg-white/10 hover:bg-white/20 text-white px-6 py-2.5 rounded-xl font-medium transition-all backdrop-blur-sm border border-white/20 w-full sm:w-auto flex-shrink-0"
            >
              Edit Profile
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-8">
          {/* Left Column - Personal Details */}
          <div className="space-y-8 md:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center space-x-2">
                <UserIcon className="w-5 h-5 text-blue-600" />
                <span>Personal Details</span>
              </h2>
              <div className="space-y-5">
                <div className="flex items-start space-x-3 text-gray-600">
                  <EnvelopeIcon className="w-5 h-5 mt-0.5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Email</p>
                    <p className="font-medium text-gray-900 break-words">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 text-gray-600">
                  <PhoneIcon className="w-5 h-5 mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Phone</p>
                    <p className="font-medium text-gray-900">{user.phone || user.phoneNumber || 'Not provided'}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 text-gray-600">
                  <MapPinIcon className="w-5 h-5 mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Address</p>
                    {user.address?.street ? (
                      <p className="font-medium text-gray-900">
                        {user.address.street}, {user.address.city}, {user.address.state} {user.address.zipCode}
                      </p>
                    ) : (
                      <p className="font-medium text-gray-900">Not provided</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start space-x-3 text-gray-600">
                  <UserIcon className="w-5 h-5 mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Gender</p>
                    <p className="font-medium text-gray-900 capitalize">{user.gender || 'Not provided'}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 text-gray-600">
                  <ClockIcon className="w-5 h-5 mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Date of Birth</p>
                    <p className="font-medium text-gray-900">
                      {user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : 'Not provided'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Role-specific Info */}
          <div className="md:col-span-2 space-y-8">
            {user.role === 'patient' && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <HeartIcon className="w-5 h-5 text-red-500" />
                  <span>Medical Information</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Blood Type</p>
                    <p className="font-medium text-gray-900">{user.medicalInfo?.bloodType || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Emergency Contact</p>
                    <p className="font-medium text-gray-900">
                      {user.medicalInfo?.emergencyContact?.name
                        ? `${user.medicalInfo.emergencyContact.name} (${user.medicalInfo.emergencyContact.phoneNumber})`
                        : 'Not provided'}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Allergies</p>
                    <div className="flex flex-wrap gap-2">
                      {user.medicalInfo?.allergies?.length > 0 ? (
                        user.medicalInfo.allergies.map((allergy, i) => (
                          <span key={i} className="px-3 py-1 bg-red-50 text-red-700 text-sm rounded-full border border-red-100">
                            {typeof allergy === 'string' ? allergy : allergy.allergen}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500 italic text-sm">No allergies listed</span>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Chronic Conditions</p>
                    <div className="flex flex-wrap gap-2">
                      {user.medicalInfo?.chronicConditions?.length > 0 ? (
                        user.medicalInfo.chronicConditions.map((condition, i) => (
                          <span key={i} className="px-3 py-1 bg-yellow-50 text-yellow-700 text-sm rounded-full border border-yellow-100">
                            {condition}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500 italic text-sm">No conditions listed</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {user.role === 'doctor' && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <AcademicCapIcon className="w-5 h-5 text-indigo-600" />
                  <span>Professional Information</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Specialization</p>
                    <p className="font-medium text-gray-900">{user.specialization || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">License Number</p>
                    <p className="font-medium text-gray-900">{user.licenseNumber || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Experience</p>
                    <p className="font-medium text-gray-900">{user.experience || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Consultation Fee</p>
                    <p className="font-medium text-gray-900">{user.consultationFee ? `$${user.consultationFee}` : 'Not set'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Qualifications</p>
                    <div className="flex flex-wrap gap-2">
                      {user.qualifications?.length > 0 ? (
                        user.qualifications.map((qual, i) => (
                          <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100">
                            {qual}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500 italic text-sm">No qualifications listed</span>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Working Schedule</p>
                    <div className="flex flex-col space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {user.workingDays?.map(day => (
                          <span key={day} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs rounded font-medium">
                            {day}
                          </span>
                        ))}
                      </div>
                      {(user.workingHours?.start && user.workingHours?.end) && (
                        <p className="text-sm text-gray-600 mt-2 font-medium">
                          <ClockIcon className="w-4 h-4 inline mr-1 text-gray-400" />
                          {user.workingHours.start} - {user.workingHours.end}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Identity Verification — patients only */}
        {user.role === 'patient' && (
          <div className="mb-8">
            <div className="flex items-center space-x-2 mb-4">
              <ShieldCheckIcon className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold text-gray-900">Identity Verification</h2>
            </div>
            <NICVerification />
          </div>
        )}

        {/* Account Settings */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center space-x-2">
            <Cog6ToothIcon className="w-5 h-5 text-gray-600" />
            <span>Account Settings</span>
          </h2>

          <div className="space-y-2">
            {/* Change Password row */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Header row — always visible */}
              <button
                type="button"
                onClick={toggleOpen}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center">
                    <KeyIcon className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900 text-sm">Password</p>
                    <p className="text-xs text-gray-500">Change your account password</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-blue-600 font-medium">
                    {pwOpen ? 'Cancel' : 'Change Password'}
                  </span>
                  {pwOpen
                    ? <ChevronUpIcon className="w-4 h-4 text-blue-600" />
                    : <ChevronDownIcon className="w-4 h-4 text-blue-500" />}
                </div>
              </button>

              {/* Inline form — expands when open */}
              {pwOpen && (
                <div ref={formRef} className="border-t border-gray-200 px-4 py-5 bg-gray-50">
                  {/* Success banner */}
                  {formResult?.type === 'success' && (
                    <div className="mb-4 flex items-start space-x-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                      <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-green-800">{formResult.message}</p>
                        {countdown !== null && (
                          <p className="text-xs text-green-700 mt-0.5">
                            Redirecting to login in <strong>{countdown}</strong>…
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error banner */}
                  {formResult?.type === 'error' && (
                    <div className="mb-4 flex items-start space-x-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                      <XCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{formResult.message}</p>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} noValidate className="space-y-4 max-w-sm">
                    <PasswordInput
                      id="currentPassword"
                      label="Current Password"
                      value={form.currentPassword}
                      onChange={setField('currentPassword')}
                      showPassword={showPw.current}
                      onToggle={() => setShowPw(p => ({ ...p, current: !p.current }))}
                      error={fieldErrors.currentPassword}
                    />

                    <div>
                      <PasswordInput
                        id="newPassword"
                        label="New Password"
                        value={form.newPassword}
                        onChange={setField('newPassword')}
                        showPassword={showPw.new}
                        onToggle={() => setShowPw(p => ({ ...p, new: !p.new }))}
                        error={fieldErrors.newPassword}
                      />
                      <StrengthIndicator password={form.newPassword} />
                    </div>

                    <PasswordInput
                      id="confirmPassword"
                      label="Confirm New Password"
                      value={form.confirmPassword}
                      onChange={setField('confirmPassword')}
                      showPassword={showPw.confirm}
                      onToggle={() => setShowPw(p => ({ ...p, confirm: !p.confirm }))}
                      error={fieldErrors.confirmPassword}
                    />

                    <button
                      type="submit"
                      disabled={submitting || formResult?.type === 'success'}
                      className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
                    >
                      {submitting && (
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      <span>{submitting ? 'Updating…' : 'Update Password'}</span>
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Email row */}
            <div className={`px-4 py-3.5 border rounded-xl transition-colors ${emailEditing ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`}>
              {!emailEditing ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${user.isEmailVerified === false ? 'bg-amber-100' : 'bg-gray-100'}`}>
                      <EnvelopeIcon className={`w-5 h-5 ${user.isEmailVerified === false ? 'text-amber-600' : 'text-gray-600'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm">Email Address</p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      {user.role === 'patient' && user.isEmailVerified === false && (
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                            Unverified
                          </span>
                          <button
                            onClick={handleResend}
                            disabled={resendLoading}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50 underline underline-offset-2"
                          >
                            {resendLoading ? 'Sending…' : 'Resend verification email'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {user.role === 'patient' ? (
                    <button
                      onClick={handleEmailEdit}
                      className="shrink-0 px-3 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                    >
                      Edit
                    </button>
                  ) : (
                    <span className="shrink-0 px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Primary</span>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center space-x-3 mb-1">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                      <EnvelopeIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="font-medium text-gray-900 text-sm">Change Email Address</p>
                  </div>
                  <input
                    type="email"
                    value={emailValue}
                    onChange={e => { setEmailValue(e.target.value); setEmailError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleEmailSave(); if (e.key === 'Escape') handleEmailCancel(); }}
                    autoFocus
                    placeholder="new@email.com"
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${emailError ? 'border-red-400' : 'border-gray-300'}`}
                  />
                  {emailError && <p className="text-xs text-red-600">{emailError}</p>}
                  <p className="text-xs text-gray-500">You will need to verify the new address before it is fully active.</p>
                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      onClick={handleEmailSave}
                      disabled={emailLoading}
                      className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {emailLoading ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={handleEmailCancel}
                      disabled={emailLoading}
                      className="px-4 py-1.5 text-xs font-semibold bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Profile;
