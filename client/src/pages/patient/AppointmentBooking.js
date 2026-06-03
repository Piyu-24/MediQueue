import React, { useState, useEffect, useRef } from 'react';
import { 
  CalendarIcon, 
  ClockIcon, 
  UserIcon, 
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { userAPI, appointmentAPI } from '../../services/api';
import toast from 'react-hot-toast';

// Slot status → visual style mapping
const SLOT_STYLES = {
  AVAILABLE:          'border-gray-200 hover:border-blue-500 hover:bg-blue-50 text-gray-700 cursor-pointer',
  LIMITED_AVAILABILITY:'border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-700 cursor-pointer',
  FULLY_BOOKED:       'border-red-200 bg-red-50 text-red-400 cursor-not-allowed opacity-70',
  PAST_SLOT:          'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed',
  PATIENT_CONFLICT:   'border-orange-200 bg-orange-50 text-orange-400 cursor-not-allowed opacity-80',
  DOCTOR_UNAVAILABLE: 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60',
  SELECTED:           'border-blue-600 bg-blue-600 text-white shadow-lg scale-105',
};

const AppointmentBooking = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Ref prevents double-submit across rapid re-renders or multiple open tabs
  const submittingRef = useRef(false);

  // State management
  const [loading, setLoading] = useState(false);
  const [selectedStep, setSelectedStep] = useState(1);
  const [doctors, setDoctors] = useState([]);
  const [filteredDoctors, setFilteredDoctors] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialization, setSelectedSpecialization] = useState('all');

  // Booking details
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [appointmentType, setAppointmentType] = useState('consultation');
  const [chiefComplaint, setChiefComplaint] = useState('');

  // Slot availability from the new API (enriched status per slot)
  const [slotGrid, setSlotGrid] = useState([]);     // all slots with status
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState(null); // doctor-level unavailability message

  // Reschedule context — pre-filled when navigating from dashboard
  const [rescheduleFromId, setRescheduleFromId] = useState(null);

  // Fetch doctors on component mount
  useEffect(() => {
    fetchDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const doctorId        = params.get('doctorId');
    const prefillComplaint = params.get('chiefComplaint');
    const prefillType      = params.get('appointmentType');
    const fromId           = params.get('rescheduleFrom');

    if (fromId) setRescheduleFromId(fromId);
    if (prefillComplaint) setChiefComplaint(decodeURIComponent(prefillComplaint));
    if (prefillType) setAppointmentType(prefillType);

    if (!doctorId || doctors.length === 0) return;
    const matchedDoctor = doctors.find((doc) => doc._id === doctorId);
    if (matchedDoctor) {
      setSelectedDoctor(matchedDoctor);
      setSelectedStep(2);
    }
  }, [location.search, doctors]);


  // Filter doctors when search or specialization changes
  useEffect(() => {
    filterDoctors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctors, searchQuery, selectedSpecialization]);

  // Fetch available slots when doctor and date are selected
  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      fetchAvailableSlots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoctor, selectedDate]);

  const fetchDoctors = async () => {
    try {
      setLoading(true);
      const response = await userAPI.getDoctors({
        specialization: selectedSpecialization === 'all' ? undefined : selectedSpecialization
      });
      
      if (response.data.success) {
        setDoctors(response.data.data.doctors);
        setFilteredDoctors(response.data.data.doctors);
      }
    } catch (error) {
      console.error('Error fetching doctors:', error);
      toast.error('Failed to load doctors');
    } finally {
      setLoading(false);
    }
  };



  const filterDoctors = () => {
    let filtered = doctors;
    
    if (selectedSpecialization !== 'all') {
      filtered = filtered.filter(doc => 
        doc.specialization?.toLowerCase() === selectedSpecialization.toLowerCase()
      );
    }
    
    if (searchQuery.trim()) {
      filtered = filtered.filter(doc =>
        doc.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.lastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.specialization?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    setFilteredDoctors(filtered);
  };

  const fetchAvailableSlots = async () => {
    try {
      setLoadingSlots(true);
      setSlotError(null);
      setSlotGrid([]);
      setSelectedTime('');

      const response = await appointmentAPI.getSlotAvailability(
        selectedDoctor._id,
        selectedDate,
        user?._id || user?.id || null
      );

      if (response.data.success) {
        const result = response.data.data;
        if (!result.available && result.slots.length === 0) {
          setSlotError(result.reason || 'Doctor is not available on this date');
        } else {
          setSlotGrid(result.slots || []);
        }
      }
    } catch (error) {
      console.error('Error fetching slot availability:', error);
      setSlotError('Unable to load slots. Please try again.');
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleDoctorSelect = (doctor) => {
    setSelectedDoctor(doctor);
    setSelectedStep(2);
    setSelectedTime(''); // Reset time when doctor changes
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedTime(''); // Reset time when date changes
  };

  const handleTimeSelect = (time) => {
    const slot = slotGrid.find(s => s.startTime === time);
    if (slot && !slot.isSelectable) {
      toast.error(slot.reason || 'This slot is not available');
      return;
    }
    setSelectedTime(time);
  };

  const handleContinueToConfirm = () => {
    if (!selectedDate) { toast.error('Please select a date'); return; }
    if (!selectedTime) { toast.error('Please select a time slot'); return; }

    // Verify selected slot is still selectable (guard against stale state)
    const slot = slotGrid.find(s => s.startTime === selectedTime);
    if (slot && !slot.isSelectable) {
      toast.error(slot.reason || 'This slot is no longer available. Please select another.');
      setSelectedTime('');
      return;
    }

    if (!appointmentType) { toast.error('Please select appointment type'); return; }
    if (!chiefComplaint.trim()) { toast.error('Please describe your reason for visit'); return; }
    if (chiefComplaint.trim().length < 10) {
      toast.error(`Reason must be at least 10 characters (currently ${chiefComplaint.trim().length})`);
      return;
    }
    if (chiefComplaint.trim().length > 500) {
      toast.error('Reason for visit is too long. Maximum 500 characters allowed.');
      return;
    }
    setSelectedStep(3);
  };

  const handleBookAppointment = async () => {
    // Prevent double-submit (covers rapid re-clicks and multiple open tabs in the
    // same session — the server partial unique index is the final safety net)
    if (submittingRef.current) return;

    if (chiefComplaint.trim().length < 10) {
      toast.error('Reason for visit must be at least 10 characters. Please provide more details.');
      return;
    }
    if (chiefComplaint.trim().length > 500) {
      toast.error('Reason for visit is too long. Maximum 500 characters allowed.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const appointmentData = {
        doctor: selectedDoctor._id,
        appointmentDate: selectedDate,
        appointmentTime: selectedTime,
        duration: 15,
        appointmentType,
        chiefComplaint: chiefComplaint.trim(),
        ...(rescheduleFromId && { rescheduledFromAppointmentId: rescheduleFromId })
      };

      const response = await appointmentAPI.createAppointment(appointmentData);

      if (response.data.success) {
        const msg = rescheduleFromId
          ? 'Appointment rescheduled successfully.'
          : 'Appointment scheduled successfully.';
        toast.success(msg);
        setTimeout(() => {
          navigate('/dashboard?tab=overview', { replace: true });
        }, 2000);
      }
    } catch (error) {
      console.error('Error booking appointment:', error.response?.data);
      if (error.response?.data?.errors) {
        const msgs = error.response.data.errors.map(e => e.msg).join(' | ');
        toast.error(`Validation error: ${msgs}`);
      } else {
        toast.error(error.response?.data?.message || 'Failed to create appointment');
      }
      submittingRef.current = false; // allow retry only on error
    } finally {
      setLoading(false);
    }
  };

  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const getMaxDate = () => {
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 3);
    return maxDate.toISOString().split('T')[0];
  };

  // Get unique specializations for filter
  const specializations = [...new Set(doctors.map(d => d.specialization).filter(Boolean))];

  const appointmentTypes = [
    { value: 'consultation', label: 'Consultation' },
    { value: 'follow-up', label: 'Follow-up' },
    { value: 'check-up', label: 'Check-up' },
    { value: 'emergency', label: 'Emergency' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white shadow-xl">
            <h1 className="text-4xl font-bold mb-2">Book Your Appointment</h1>
            <p className="text-blue-100 text-lg">Find the right doctor and schedule your visit</p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4">
            {[
              { step: 1, title: 'Choose Doctor', icon: UserIcon },
              { step: 2, title: 'Select Date & Time', icon: CalendarIcon },
              { step: 3, title: 'Confirm & Book', icon: CheckCircleIcon }
            ].map(({ step, title, icon: Icon }, index, array) => (
              <div key={step} className="flex items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  selectedStep >= step 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-400'
                }`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className={`ml-3 ${selectedStep >= step ? 'text-blue-600' : 'text-gray-400'}`}>
                  <p className="text-sm font-semibold">{title}</p>
                </div>
                {step < array.length && (
                  <ArrowRightIcon className="w-5 h-5 ml-8 text-gray-300" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step 1: Choose Doctor */}
        {selectedStep === 1 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Choose Your Doctor</h2>
            
            {/* Search and Filter */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or specialization..."
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={selectedSpecialization}
                onChange={(e) => setSelectedSpecialization(e.target.value)}
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Specializations</option>
                {specializations.map(spec => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </div>

            {/* Doctors List */}
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-600 mt-4">Loading doctors...</p>
              </div>
            ) : filteredDoctors.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredDoctors.map((doctor) => (
                  <div
                    key={doctor._id}
                    onClick={() => handleDoctorSelect(doctor)}
                    className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-all duration-300 cursor-pointer hover:border-blue-500 transform hover:-translate-y-1"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                        {doctor.firstName?.charAt(0)}{doctor.lastName?.charAt(0)}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900">
                          Dr. {doctor.firstName} {doctor.lastName}
                        </h3>
                        <p className="text-blue-600 font-medium">{doctor.specialization}</p>
                        <p className="text-sm text-gray-600 mt-1">{doctor.experience || 'Experienced'}</p>
                        
                        <div className="mt-3 flex items-center justify-end">
                          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                            Select Doctor
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <UserIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No doctors found</p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedSpecialization('all');
                  }}
                  className="mt-4 text-blue-600 hover:text-blue-700"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Select Date & Time */}
        {selectedStep === 2 && selectedDoctor && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Select Date & Time</h2>
              <button
                onClick={() => setSelectedStep(1)}
                className="text-blue-600 hover:text-blue-700 flex items-center space-x-2"
              >
                <ArrowLeftIcon className="w-5 h-5" />
                <span>Change Doctor</span>
              </button>
            </div>

            {/* Reschedule notice */}
            {rescheduleFromId && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                <span className="text-amber-500 text-lg">⚠</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Rescheduling appointment</p>
                  <p className="text-xs text-amber-700 mt-0.5">Your previous appointment details have been pre-filled. Select a new date and time slot.</p>
                </div>
              </div>
            )}

            {/* Selected Doctor Info */}
            <div className="bg-blue-50 rounded-xl p-4 mb-6">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                  {selectedDoctor.firstName?.charAt(0)}{selectedDoctor.lastName?.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    Dr. {selectedDoctor.firstName} {selectedDoctor.lastName}
                  </p>
                  <p className="text-sm text-blue-600">{selectedDoctor.specialization}</p>
                </div>
              </div>
            </div>

            {/* Date Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateSelect(e.target.value)}
                min={getMinDate()}
                max={getMaxDate()}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Time Slots — rich visual availability grid */}
            {selectedDate && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">Select Time Slot</label>
                  {slotGrid.length > 0 && (
                    <span className="text-xs text-blue-600 font-medium">
                      {slotGrid.filter(s => s.isSelectable).length} of {slotGrid.length} slots available
                    </span>
                  )}
                </div>

                {loadingSlots ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-gray-600 mt-2 text-sm">Loading slot availability...</p>
                  </div>
                ) : slotError ? (
                  <div className="text-center py-8 bg-red-50 rounded-lg border border-red-200">
                    <ClockIcon className="w-12 h-12 text-red-300 mx-auto mb-2" />
                    <p className="text-red-600 font-medium">{slotError}</p>
                    <p className="text-sm text-red-400 mt-1">Please select a different date or doctor</p>
                  </div>
                ) : slotGrid.length > 0 ? (
                  <>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-80 overflow-y-auto p-1">
                      {slotGrid.map((slot) => {
                        const isSelected = selectedTime === slot.startTime;
                        const styleKey = isSelected ? 'SELECTED' : slot.status;
                        return (
                          <div key={slot.startTime} className="relative group">
                            <button
                              onClick={() => slot.isSelectable && handleTimeSelect(slot.startTime)}
                              disabled={!slot.isSelectable}
                              title={slot.reason || slot.status}
                              className={`w-full py-2 px-1 rounded-lg border-2 transition-all duration-150 text-xs font-medium ${SLOT_STYLES[styleKey] || SLOT_STYLES.AVAILABLE}`}
                            >
                              <span className="block">{slot.startTime}</span>
                              {slot.status === 'LIMITED_AVAILABILITY' && !isSelected && (
                                <span className="block text-[10px] mt-0.5 text-amber-600">{slot.reason}</span>
                              )}
                              {slot.status === 'FULLY_BOOKED' && (
                                <span className="block text-[10px] mt-0.5">Full</span>
                              )}
                              {slot.status === 'PAST_SLOT' && (
                                <span className="block text-[10px] mt-0.5">Past</span>
                              )}
                              {slot.status === 'PATIENT_CONFLICT' && (
                                <span className="block text-[10px] mt-0.5">Your slot</span>
                              )}
                              {slot.status === 'DOCTOR_UNAVAILABLE' && (
                                <span className="block text-[10px] mt-0.5">Unavail.</span>
                              )}
                            </button>
                            {/* Tooltip on hover for non-selectable slots */}
                            {slot.reason && !slot.isSelectable && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-[160px] text-center">
                                {slot.reason}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Legend */}
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-2">Slot Status:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-gray-300 inline-block"></span> Available</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-amber-400 bg-amber-50 inline-block"></span> Limited</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600 inline-block"></span> Selected</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-200 inline-block"></span> Full</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-50 border border-orange-200 inline-block"></span> Your slot</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block"></span> Unavailable</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                    <ClockIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">No slots found for this date</p>
                    <p className="text-sm text-gray-400 mt-1">Please select a different date</p>
                  </div>
                )}
              </div>
            )}

            {/* Appointment Type */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Appointment Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {appointmentTypes.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setAppointmentType(type.value)}
                    className={`py-3 px-4 rounded-lg border-2 transition-all duration-200 ${
                      appointmentType === type.value
                        ? 'border-blue-600 bg-blue-50 text-blue-600 font-semibold'
                        : 'border-gray-200 hover:border-blue-300 text-gray-700'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chief Complaint */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason for Visit * <span className="text-red-600">(Required - Min 10 chars)</span>
              </label>
              <div className={`mb-2 p-3 rounded-lg border ${
                chiefComplaint.trim().length > 0 && chiefComplaint.trim().length < 10
                  ? 'bg-red-50 border-red-300'
                  : chiefComplaint.trim().length >= 10
                  ? 'bg-green-50 border-green-300'
                  : 'bg-blue-50 border-blue-200'
              }`}>
                <p className={`text-sm font-medium ${
                  chiefComplaint.trim().length > 0 && chiefComplaint.trim().length < 10
                    ? 'text-red-700'
                    : chiefComplaint.trim().length >= 10
                    ? 'text-green-700'
                    : 'text-blue-700'
                }`}>
                  {chiefComplaint.trim().length > 0 && chiefComplaint.trim().length < 10
                    ? '❌ Description too short - please add more details'
                    : chiefComplaint.trim().length >= 10
                    ? '✅ Good! Your description meets the requirement'
                    : '📝 Please provide a detailed description (minimum 10 characters, maximum 500 characters)'
                  }
                </p>
              </div>
              <textarea
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="Example: I've been experiencing severe headaches for the past 3 days, accompanied by nausea and sensitivity to light..."
                rows={5}
                maxLength={500}
                className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 transition-colors ${
                  chiefComplaint.trim().length > 0 && chiefComplaint.trim().length < 10
                    ? 'border-red-400 bg-red-50'
                    : chiefComplaint.trim().length >= 10
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-300'
                }`}
              />
              <div className="mt-2 flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <div className={`text-sm font-semibold ${
                    chiefComplaint.trim().length < 10 
                      ? 'text-red-600' 
                      : chiefComplaint.trim().length > 450 
                      ? 'text-orange-600' 
                      : 'text-green-600'
                  }`}>
                    {chiefComplaint.trim().length < 10 
                      ? `⚠️ Need ${10 - chiefComplaint.trim().length} more characters` 
                      : `✓ Valid (${chiefComplaint.trim().length} characters)`
                    }
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-600">{chiefComplaint.length}/500</p>
              </div>
            </div>

            {/* Continue Button */}
            <button
              onClick={handleContinueToConfirm}
              disabled={!selectedDate || !selectedTime || !appointmentType || !chiefComplaint.trim() || chiefComplaint.trim().length < 10}
              className="w-full py-3 px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue to Confirm
            </button>
          </div>
        )}

        {/* Step 3: Confirm Details */}
        {selectedStep === 3 && selectedDoctor && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Confirm Appointment</h2>
              <button
                onClick={() => setSelectedStep(2)}
                className="text-blue-600 hover:text-blue-700 flex items-center space-x-2"
              >
                <ArrowLeftIcon className="w-5 h-5" />
                <span>Edit Details</span>
              </button>
            </div>

            {/* Summary */}
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-blue-50 to-gray-50 rounded-xl p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Appointment Summary</h3>
                
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <UserIcon className="w-5 h-5 text-blue-600 mt-1" />
                    <div>
                      <p className="text-sm text-gray-600">Doctor</p>
                      <p className="font-semibold text-gray-900">
                        Dr. {selectedDoctor.firstName} {selectedDoctor.lastName}
                      </p>
                      <p className="text-sm text-blue-600">{selectedDoctor.specialization}</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3">
                    <CalendarIcon className="w-5 h-5 text-blue-600 mt-1" />
                    <div>
                      <p className="text-sm text-gray-600">Date & Time</p>
                      <p className="font-semibold text-gray-900">
                        {new Date(selectedDate).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </p>
                      <p className="text-sm text-gray-700">{selectedTime} <span className="text-xs text-gray-500">(15 min slot)</span></p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3">
                    <ClockIcon className="w-5 h-5 text-blue-600 mt-1" />
                    <div>
                      <p className="text-sm text-gray-600">Appointment Type</p>
                      <p className="font-semibold text-gray-900 capitalize">{appointmentType}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-600 mb-1">Reason for Visit</p>
                    <p className="text-gray-900">{chiefComplaint}</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-4">
                <button
                  onClick={() => setSelectedStep(2)}
                  className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
                >
                  Back
                </button>
                <button
                  onClick={handleBookAppointment}
                  disabled={loading}
                  className="flex-1 py-3 px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Booking...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircleIcon className="w-5 h-5" />
                      <span>Confirm & Book Appointment</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppointmentBooking;
