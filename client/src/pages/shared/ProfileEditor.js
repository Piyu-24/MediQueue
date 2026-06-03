import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserIcon,
  PhoneIcon,
  MapPinIcon,
  HeartIcon,
  AcademicCapIcon,
  ClockIcon,
  CheckCircleIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { userAPI } from '../../services/api';
import toast from 'react-hot-toast';

const ProfileEditor = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    address: { street: '', city: '', state: '', zipCode: '', country: '' },
    // Patient
    medicalInfo: {
      bloodType: '',
      allergies: [],
      chronicConditions: [],
      currentMedications: [],
      emergencyContact: { name: '', relationship: '', phoneNumber: '' },
      insuranceProvider: '',
      insurancePolicyNumber: '',
      height: '',
      weight: ''
    },
    // Doctor
    specialization: '',
    experience: '',
    qualifications: [],
    licenseNumber: '',
    consultationFee: '',
    bio: '',
    languages: [],
    workingDays: [],
    workingHours: { start: '', end: '' }
  });

  const [newAllergy, setNewAllergy] = useState('');
  const [newCondition, setNewCondition] = useState('');
  const [newMedication, setNewMedication] = useState('');
  const [newQualification, setNewQualification] = useState('');
  const [newLanguage, setNewLanguage] = useState('');

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const specializations = [
    'Cardiology', 'Dermatology', 'Endocrinology', 'Gastroenterology',
    'General Medicine', 'Neurology', 'Orthopedics', 'Pediatrics',
    'Psychiatry', 'Surgery', 'Urology', 'Other'
  ];

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phone: user.phone || user.phoneNumber || '',
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.split('T')[0] : '',
        gender: user.gender || '',
        address: user.address || { street: '', city: '', state: '', zipCode: '', country: '' },
        medicalInfo: {
          bloodType: user.medicalInfo?.bloodType || '',
          allergies: user.medicalInfo?.allergies || [],
          chronicConditions: user.medicalInfo?.chronicConditions || [],
          currentMedications: user.medicalInfo?.currentMedications || [],
          emergencyContact: {
            name: user.medicalInfo?.emergencyContact?.name || '',
            relationship: user.medicalInfo?.emergencyContact?.relationship || '',
            phoneNumber: user.medicalInfo?.emergencyContact?.phoneNumber || ''
          },
          insuranceProvider: user.medicalInfo?.insuranceProvider || '',
          insurancePolicyNumber: user.medicalInfo?.insurancePolicyNumber || '',
          height: user.medicalInfo?.height || '',
          weight: user.medicalInfo?.weight || ''
        },
        specialization: user.specialization || '',
        experience: user.experience || '',
        qualifications: user.qualifications || [],
        licenseNumber: user.licenseNumber || '',
        consultationFee: user.consultationFee || '',
        bio: user.bio || '',
        languages: user.languages || [],
        workingDays: user.workingDays || [],
        workingHours: user.workingHours || { start: '', end: '' }
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    if (name.startsWith('address.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, address: { ...prev.address, [field]: value } }));
    } else if (name.startsWith('medicalInfo.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, medicalInfo: { ...prev.medicalInfo, [field]: value } }));
    } else if (name.startsWith('emergencyContact.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        medicalInfo: { ...prev.medicalInfo, emergencyContact: { ...prev.medicalInfo.emergencyContact, [field]: value } }
      }));
    } else if (name.startsWith('workingHours.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({ ...prev, workingHours: { ...prev.workingHours, [field]: value } }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleWorkingDayToggle = (day) => {
    setFormData(prev => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter(d => d !== day)
        : [...prev.workingDays, day]
    }));
  };

  const handleArrayAdd = (field, value, setValue) => {
    if (value.trim()) {
      if (['allergies', 'chronicConditions', 'currentMedications'].includes(field)) {
        setFormData(prev => ({
          ...prev,
          medicalInfo: { ...prev.medicalInfo, [field]: [...prev.medicalInfo[field], value.trim()] }
        }));
      } else {
        setFormData(prev => ({
          ...prev,
          [field]: [...prev[field], value.trim()]
        }));
      }
      setValue('');
    }
  };

  const handleArrayRemove = (field, index) => {
    if (['allergies', 'chronicConditions', 'currentMedications'].includes(field)) {
      setFormData(prev => ({
        ...prev,
        medicalInfo: { ...prev.medicalInfo, [field]: prev.medicalInfo[field].filter((_, i) => i !== index) }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: prev[field].filter((_, i) => i !== index)
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      // Update endpoint might be /profile instead of /users/:id/profile based on user routes
      const response = await userAPI.updateProfile(formData);
      
      if (response.data.success) {
        updateUser(response.data.data.user);
        toast.success('Profile updated successfully');
        navigate('/profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Edit Profile</h1>
            <p className="text-gray-600 mt-2">Update your personal and role-specific information</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Shared: Personal Information */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
              <UserIcon className="w-6 h-6 text-blue-600" />
              <span>Personal Information</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">First Name *</label>
                <input type="text" name="firstName" value={formData.firstName} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name *</label>
                <input type="text" name="lastName" value={formData.lastName} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Email *</label>
                <input type="email" name="email" value={formData.email} disabled className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number</label>
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Date of Birth</label>
                <input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Gender</label>
                <select name="gender" value={formData.gender} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors">
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer-not-to-say">Prefer not to say</option>
                </select>
              </div>
            </div>
          </div>

          {/* Shared: Address */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
              <MapPinIcon className="w-6 h-6 text-blue-600" />
              <span>Address</span>
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Street Address</label>
                <input type="text" name="address.street" value={formData.address.street} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">City</label>
                  <input type="text" name="address.city" value={formData.address.city} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">State</label>
                  <input type="text" name="address.state" value={formData.address.state} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">ZIP Code</label>
                  <input type="text" name="address.zipCode" value={formData.address.zipCode} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors" />
                </div>
              </div>
            </div>
          </div>

          {/* PATIENT ONLY: Medical Information */}
          {user?.role === 'patient' && (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <HeartIcon className="w-6 h-6 text-red-500" />
                  <span>Medical Information</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Blood Type</label>
                    <select name="medicalInfo.bloodType" value={formData.medicalInfo.bloodType} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500">
                      <option value="">Select</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Height (cm)</label>
                    <input type="number" name="medicalInfo.height" value={formData.medicalInfo.height} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Weight (kg)</label>
                    <input type="number" name="medicalInfo.weight" value={formData.medicalInfo.weight} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                {/* Arrays for Medical Info */}
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Allergies</label>
                    <div className="flex space-x-2">
                      <input type="text" value={newAllergy} onChange={e => setNewAllergy(e.target.value)} onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleArrayAdd('allergies', newAllergy, setNewAllergy))} className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" placeholder="Add allergy" />
                      <button type="button" onClick={() => handleArrayAdd('allergies', newAllergy, setNewAllergy)} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.medicalInfo.allergies.map((item, index) => (
                        <span key={index} className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm border border-red-100">
                          {typeof item === 'string' ? item : item.allergen} <button type="button" onClick={() => handleArrayRemove('allergies', index)} className="ml-1 font-bold">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Chronic Conditions</label>
                    <div className="flex space-x-2">
                      <input type="text" value={newCondition} onChange={e => setNewCondition(e.target.value)} onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleArrayAdd('chronicConditions', newCondition, setNewCondition))} className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" placeholder="Add condition" />
                      <button type="button" onClick={() => handleArrayAdd('chronicConditions', newCondition, setNewCondition)} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.medicalInfo.chronicConditions.map((item, index) => (
                        <span key={index} className="px-3 py-1 bg-yellow-50 text-yellow-700 rounded-full text-sm border border-yellow-100">
                          {item} <button type="button" onClick={() => handleArrayRemove('chronicConditions', index)} className="ml-1 font-bold">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* PATIENT ONLY: Emergency Contact */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <PhoneIcon className="w-6 h-6 text-orange-500" />
                  <span>Emergency Contact</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                    <input type="text" name="emergencyContact.name" value={formData.medicalInfo.emergencyContact.name} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Relationship</label>
                    <input type="text" name="emergencyContact.relationship" value={formData.medicalInfo.emergencyContact.relationship} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number</label>
                    <input type="tel" name="emergencyContact.phoneNumber" value={formData.medicalInfo.emergencyContact.phoneNumber} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                </div>
              </div>

              {/* PATIENT ONLY: Identity Verification (View only snippet for editor) */}
              {!user?.isVerified && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 rounded-xl p-6">
                  <div className="flex items-start space-x-4">
                    <DocumentTextIcon className="w-10 h-10 text-orange-500" />
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Identity Not Verified</h3>
                      <p className="text-sm text-gray-700 mt-1">Please go to your Documents tab on the dashboard to upload your ID and verify your identity.</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* DOCTOR ONLY: Professional Information */}
          {user?.role === 'doctor' && (
            <>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <AcademicCapIcon className="w-6 h-6 text-indigo-600" />
                  <span>Professional Information</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Specialization *</label>
                    <select name="specialization" value={formData.specialization} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg">
                      <option value="">Select Specialization</option>
                      {specializations.map(spec => <option key={spec} value={spec}>{spec}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">License Number</label>
                    <input type="text" name="licenseNumber" value={formData.licenseNumber} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Years of Experience</label>
                    <input type="text" name="experience" value={formData.experience} onChange={handleChange} placeholder="e.g., 10 years" className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Consultation Fee ($)</label>
                    <input type="number" name="consultationFee" value={formData.consultationFee} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Qualifications</label>
                    <div className="flex space-x-2">
                      <input type="text" value={newQualification} onChange={e => setNewQualification(e.target.value)} onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleArrayAdd('qualifications', newQualification, setNewQualification))} className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" placeholder="Add qualification (e.g., MD, PhD)" />
                      <button type="button" onClick={() => handleArrayAdd('qualifications', newQualification, setNewQualification)} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.qualifications.map((item, index) => (
                        <span key={index} className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm border border-indigo-100">
                          {item} <button type="button" onClick={() => handleArrayRemove('qualifications', index)} className="ml-1 font-bold">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Professional Bio</label>
                    <textarea name="bio" value={formData.bio} onChange={handleChange} rows={4} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" placeholder="Tell patients about your expertise..."></textarea>
                  </div>
                </div>
              </div>

              {/* DOCTOR ONLY: Schedule */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center space-x-2">
                  <ClockIcon className="w-6 h-6 text-indigo-600" />
                  <span>Working Schedule</span>
                </h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Working Days</label>
                    <div className="flex flex-wrap gap-2">
                      {weekDays.map(day => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => handleWorkingDayToggle(day)}
                          className={`px-4 py-2 rounded-lg border-2 transition-colors font-medium ${
                            formData.workingDays.includes(day)
                              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 hover:border-gray-300 text-gray-600'
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Start Time</label>
                      <input type="time" name="workingHours.start" value={formData.workingHours.start} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">End Time</label>
                      <input type="time" name="workingHours.end" value={formData.workingHours.end} onChange={handleChange} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg" />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl disabled:opacity-50 flex items-center space-x-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-6 h-6" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileEditor;
