import React, { useEffect, useState } from 'react';
import {
  BuildingOffice2Icon,
  IdentificationIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { reportAPI, userAPI } from '../../services/api';

const ROLE_CONFIGS = [
  { role: 'doctor', label: 'Doctor', icon: ShieldCheckIcon, accent: 'from-blue-50 to-blue-100 text-blue-800 border-blue-200' },
  { role: 'pharmacist', label: 'Pharmacist', icon: UserGroupIcon, accent: 'from-orange-50 to-orange-100 text-orange-800 border-orange-200' },
  { role: 'receptionist', label: 'Receptionist', icon: BuildingOffice2Icon, accent: 'from-purple-50 to-purple-100 text-purple-800 border-purple-200' },
  { role: 'staff', label: 'Staff', icon: UserIcon, accent: 'from-green-50 to-green-100 text-green-800 border-green-200' },
  { role: 'patient', label: 'Patient', icon: IdentificationIcon, accent: 'from-slate-50 to-slate-100 text-slate-800 border-slate-200' },
];

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

const getStatusLabel = (user) => {
  if (user.role !== 'patient') {
    return user.isActive ? 'active' : 'inactive';
  }

  return user.identityVerificationStatus || 'unverified';
};

const AccountVerificationStatus = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleData, setRoleData] = useState({});

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      setError('');

      try {
        const [patientVerificationRes, ...roleResults] = await Promise.all([
          userAPI.getPatientsForVerification('all'),
          ...ROLE_CONFIGS.map(async ({ role }) => {
            const [reportRes, usersRes] = await Promise.all([
              reportAPI.getUserReports({ role }),
              userAPI.searchUsers('', { role }),
            ]);

            return {
              role,
              reportUsers: reportRes.data?.data?.users || [],
              users: usersRes.data?.data?.users || [],
            };
          }),
        ]);

        if (!mounted) return;

        const verificationMap = new Map(
          (patientVerificationRes.data?.data || []).map((patient) => [String(patient._id), patient])
        );

        const nextData = {};
        for (const result of roleResults) {
          nextData[result.role] = {
            activeCount: result.reportUsers.length,
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
        if (!mounted) return;
        console.error('Account verification status load failed:', fetchError);
        setError('Failed to load account verification status');
        toast.error('Failed to load account verification status');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const renderStatusBadge = (status) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.unverified;
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unverified';

    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
        {label}
      </span>
    );
  };

  const renderPatientVerification = (patient) => {
    const status = patient.identityVerificationStatus || 'unverified';
    if (status === 'verified') {
      const verifiedByName = patient.verifiedBy
        ? `${patient.verifiedBy.firstName || ''} ${patient.verifiedBy.lastName || ''}`.trim()
        : 'Receptionist';
      const verifierRole = patient.verifiedBy?.role
        ? patient.verifiedBy.role.charAt(0).toUpperCase() + patient.verifiedBy.role.slice(1)
        : 'Receptionist';

      return (
        <div className="space-y-1 text-xs text-slate-700">
          <div className="font-medium text-green-700">Verified</div>
          <div>By: {verifierRole}{verifiedByName ? ` (${verifiedByName})` : ''}</div>
          <div>Date: {formatDate(patient.verifiedAt)}</div>
        </div>
      );
    }

    if (status === 'pending') {
      return <div className="text-xs font-medium text-amber-700">Pending review</div>;
    }

    if (status === 'rejected') {
      return <div className="text-xs font-medium text-red-700">Rejected</div>;
    }

    return <div className="text-xs font-medium text-slate-600">Unverified</div>;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Account Verification Status</h1>
            <p className="mt-1 text-sm text-slate-600">
              Read-only visibility across doctor, pharmacist, receptionist, staff, and patient accounts.
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            No verification actions available in admin view
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
          <p className="mt-4 text-sm text-slate-600">Loading account status...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {ROLE_CONFIGS.map(({ role, label, icon: Icon, accent }) => {
            const data = roleData[role] || { activeCount: 0, users: [] };

            return (
              <section key={role} className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${accent}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      <h2 className="text-lg font-bold">{label}</h2>
                    </div>
                    <p className="mt-1 text-xs font-medium opacity-80">
                      Active accounts: {data.activeCount}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {data.users.length}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {data.users.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/60 bg-white/40 p-4 text-sm text-slate-600">
                      No accounts found.
                    </div>
                  ) : (
                    data.users.map((user) => {
                      const status = getStatusLabel(user);

                      return (
                        <div key={user._id} className="rounded-xl border border-white/60 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-slate-900">
                                {user.firstName} {user.lastName}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">{user.email}</div>
                            </div>
                            {renderStatusBadge(status)}
                          </div>

                          <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                            <div className="flex items-center justify-between gap-3">
                              <span>Created</span>
                              <span className="font-medium text-slate-800">{formatDate(user.createdAt)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Account</span>
                              <span className="font-medium text-slate-800">{user.isActive ? 'Active' : 'Inactive'}</span>
                            </div>

                            {role !== 'patient' && (
                              <div className="flex items-center justify-between gap-3">
                                <span>Created by</span>
                                <span className="font-medium text-slate-800">
                                  {user.registeredBy || 'Unknown'}
                                </span>
                              </div>
                            )}

                            {role === 'doctor' && (
                              <div className="flex items-center justify-between gap-3">
                                <span>Admin-created</span>
                                <span className={`font-semibold ${user.registeredBy === 'Admin' ? 'text-green-700' : 'text-slate-700'}`}>
                                  {user.registeredBy === 'Admin' ? 'Yes' : 'No'}
                                </span>
                              </div>
                            )}

                            {role === 'patient' && (
                              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span>NIC</span>
                                  <span className="font-mono text-slate-800">{maskNicNumber(user.nicNumber)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span>Status</span>
                                  <span>{renderStatusBadge(status)}</span>
                                </div>
                                {renderPatientVerification(user)}
                                {user.verifiedBy && (
                                  <div className="text-xs text-slate-600">
                                    Verified by {user.verifiedBy.firstName || ''} {user.verifiedBy.lastName || ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AccountVerificationStatus;