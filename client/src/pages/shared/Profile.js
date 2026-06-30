import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  HeartIcon,
  AcademicCapIcon,
  ClockIcon,
  CheckBadgeIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

const Profile = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <LoadingSpinner />;
  if (!user) return null;

  const handleEditClick = () => {
    navigate('/profile/edit');
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
                <span>Basic Details</span>
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

          {/* Right Column - Role Specific Info */}
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

      </div>
    </div>
  );
};

export default Profile;
