import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BuildingOffice2Icon,
  CheckBadgeIcon,
  IdentificationIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { adminAPI, userAPI } from '../../services/api';

// Internal roles whose professional credentials must be verified by an
// administrator before clinical/system access is granted.
const STAFF_ROLE_CONFIGS = [
  { role: 'doctor', label: 'Doctors', icon: ShieldCheckIcon, accent: 'text-blue-600', ring: 'border-blue-200' },
  { role: 'pharmacist', label: 'Pharmacists', icon: UserGroupIcon, accent: 'text-orange-600', ring: 'border-orange-200' },
  { role: 'receptionist', label: 'Receptionists', icon: BuildingOffice2Icon, accent: 'text-purple-600', ring: 'border-purple-200' },
  { role: 'staff', label: 'Support Staff', icon: UserIcon, accent: 'text-green-600', ring: 'border-green-200' },
];

const PATIENT_CONFIG = { role: 'patient', label: 'Patients', icon: IdentificationIcon };

// Every role we load data for (staff roles + patients).
const ALL_ROLE_CONFIGS = [...STAFF_ROLE_CONFIGS, PATIENT_CONFIG];

const STATUS_STYLES = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-red-100 text-red-800',
  verified: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  unverified: 'bg-slate-100 text-slate-700',
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
};

const maskNicNumber = (value) => {
  if (!value) return 'N/A';
  const nic = String(value).trim();
  if (nic.length <= 6) return nic;
  return `${nic.slice(0, 3)}••••${nic.slice(-2)}`;
};

const staffStatus = (user) => user.credentialVerificationStatus || 'unverified';
const patientStatus = (user) => user.identityVerificationStatus || 'unverified';

const StatusBadge = ({ status }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.unverified;
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unverified';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
};

const AccountVerificationStatus = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleData, setRoleData] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const [patientVerificationRes, ...roleResults] = await Promise.all([
        userAPI.getPatientsForVerification('all'),
        ...ALL_ROLE_CONFIGS.map(async ({ role }) => {
          const usersRes = await userAPI.searchUsers('', { role });
          return {
            role,
            users: usersRes.data?.data?.users || [],
          };
        }),
      ]);

      const verificationMap = new Map(
        (patientVerificationRes.data?.data || []).map((patient) => [String(patient._id), patient])
      );

      const nextData = {};
      for (const result of roleResults) {
        nextData[result.role] = {
          users: (result.users || [])
            .map((user) => {
              if (user.role !== 'patient') return user;
              const verification = verificationMap.get(String(user._id));
              return verification
                ? {
                    ...user,
                    identityVerificationStatus: verification.identityVerificationStatus,
                    verificationNote: verification.verificationNote,
                    verifiedBy: verification.verifiedBy,
                    verifiedAt: verification.verifiedAt,
                    nicNumber: verification.nicNumber || user.nicNumber,
                  }
                : user;
            })
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
        };
      }

      setRoleData(nextData);
    } catch (fetchError) {
      console.error('Account verification status load failed:', fetchError);
      setError('Failed to load account verification status');
      toast.error('Failed to load account verification status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVerify = async (userId, role, status) => {
    if (status === 'rejected' &&
        !window.confirm('Remove this account’s access? They will lose access to clinical features until re-approved.')) {
      return;
    }
    try {
      setVerifyingId(userId);
      const res = await adminAPI.verifyStaffCredentials(userId, status);
      if (res.data.success) {
        toast.success(res.data.message || 'Credentials updated');
        setRoleData((prev) => ({
          ...prev,
          [role]: {
            ...prev[role],
            users: (prev[role]?.users || []).map((u) =>
              u._id === userId ? { ...u, credentialVerificationStatus: status } : u
            ),
          },
        }));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update credentials');
    } finally {
      setVerifyingId(null);
    }
  };

  // Summary across internal staff roles.
  const staffSummary = useMemo(() => {
    const summary = { total: 0, verified: 0, pending: 0, unverified: 0 };
    for (const { role } of STAFF_ROLE_CONFIGS) {
      for (const u of roleData[role]?.users || []) {
        summary.total += 1;
        const s = staffStatus(u);
        if (s === 'verified') summary.verified += 1;
        else if (s === 'pending') summary.pending += 1;
        else summary.unverified += 1;
      }
    }
    return summary;
  }, [roleData]);

  const patientData = roleData.patient || { users: [] };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5">
              <CheckBadgeIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Account Verification</h1>
              <p className="mt-1 text-sm text-slate-600">
                Verify professional credentials for internal staff accounts before granting system access.
              </p>
            </div>
          </div>

          {/* Staff verification summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Verified', value: staffSummary.verified, color: 'text-green-600' },
              { label: 'Pending', value: staffSummary.pending, color: 'text-amber-600' },
              { label: 'Unverified', value: staffSummary.unverified, color: 'text-slate-600' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-center">
                <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
          <p className="mt-4 text-sm text-slate-600">Loading account status...</p>
        </div>
      ) : (
        <>
          {/* SECTION A — Internal staff (admin-verified) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheckIcon className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900">Internal Staff &amp; Clinical Accounts</h2>
            </div>
            <p className="mb-5 text-sm text-slate-600">
              Created by administrators. Credentials must be <strong>verified</strong> before the account can access clinical or system features.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {STAFF_ROLE_CONFIGS.map(({ role, label, icon: Icon, accent, ring }) => {
                const data = roleData[role] || { users: [] };
                return (
                  <div key={role} className={`flex flex-col rounded-2xl border ${ring} bg-slate-50/60`}>
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${accent}`} />
                        <h3 className="text-sm font-bold text-slate-900">{label}</h3>
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow-sm">
                        {data.users.length}
                      </span>
                    </div>

                    <div className="max-h-[460px] space-y-3 overflow-y-auto p-3">
                      {data.users.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 text-center text-xs text-slate-500">
                          No accounts.
                        </div>
                      ) : (
                        data.users.map((user) => {
                          const status = staffStatus(user);
                          const busy = verifyingId === user._id;
                          return (
                            <div key={user._id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">
                                    {user.firstName} {user.lastName}
                                  </div>
                                  <div className="truncate text-xs text-slate-500">{user.email}</div>
                                </div>
                                <StatusBadge status={status} />
                              </div>

                              <div className="mt-2.5 space-y-1 text-xs text-slate-500">
                                <div className="flex items-center justify-between gap-2">
                                  <span>Account</span>
                                  <span className={`font-semibold ${user.isActive ? 'text-green-700' : 'text-red-600'}`}>
                                    {user.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span>Created</span>
                                  <span className="font-medium text-slate-700">{formatDate(user.createdAt)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span>Created by</span>
                                  <span className="font-medium text-slate-700">{user.registeredBy || 'Unknown'}</span>
                                </div>
                              </div>

                              {/* Verification action */}
                              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                                {status !== 'verified' ? (
                                  <button
                                    onClick={() => handleVerify(user._id, role, 'verified')}
                                    disabled={busy}
                                    className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {busy ? 'Saving…' : 'Approve'}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleVerify(user._id, role, 'rejected')}
                                    disabled={busy}
                                    className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                                  >
                                    {busy ? 'Saving…' : 'Remove Access'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SECTION B — Patients (verified at reception, view-only) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <IdentificationIcon className="h-5 w-5 text-slate-600" />
              <h2 className="text-lg font-bold text-slate-900">Patient Accounts</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {patientData.users.length}
              </span>
            </div>

            <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <UserGroupIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
              <p>Identity is verified at <strong>reception</strong>.</p>
            </div>

            {patientData.users.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No patient accounts found.
              </div>
            ) : (
              <div className="grid max-h-[560px] grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
                {patientData.users.map((user) => {
                  const status = patientStatus(user);
                  const verifierName = user.verifiedBy
                    ? `${user.verifiedBy.firstName || ''} ${user.verifiedBy.lastName || ''}`.trim()
                    : '';
                  return (
                    <div key={user._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {user.firstName} {user.lastName}
                          </div>
                          <div className="truncate text-xs text-slate-500">{user.email}</div>
                        </div>
                        <StatusBadge status={status} />
                      </div>
                      <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="flex items-center justify-between gap-2">
                          <span>NIC</span>
                          <span className="font-mono text-slate-800">{maskNicNumber(user.nicNumber)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span>Registered</span>
                          <span className="font-medium text-slate-800">{formatDate(user.createdAt)}</span>
                        </div>
                        {status === 'verified' && (
                          <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1.5">
                            <span>Verified</span>
                            <span className="font-medium text-green-700">
                              {formatDate(user.verifiedAt)}{verifierName ? ` · ${verifierName}` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AccountVerificationStatus;
