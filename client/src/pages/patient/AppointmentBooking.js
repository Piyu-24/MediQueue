import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  BuildingOffice2Icon,
  TicketIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { appointmentAPI, departmentAPI } from '../../services/api';
import toast from 'react-hot-toast';

// ── Visual style maps ─────────────────────────────────────────────────────────

const BLOCK_STYLES = {
  AVAILABLE:    'border-blue-200 hover:border-blue-500 hover:bg-blue-50 bg-white cursor-pointer',
  LIMITED:      'border-amber-300 hover:border-amber-500 hover:bg-amber-50 bg-amber-50/30 cursor-pointer',
  FULLY_BOOKED: 'border-red-200 bg-red-50 cursor-not-allowed opacity-60',
  CLOSED:       'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50',
  CONFLICT:     'border-red-300 bg-red-50/80 hover:border-red-400 hover:bg-red-100 cursor-pointer',
  SELECTED:     'border-blue-600 bg-blue-600 text-white shadow-lg cursor-pointer',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt12 = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDate = (dateStr) =>
  new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

// ── Steps ─────────────────────────────────────────────────────────────────────

const STEPS      = ['Choose Department', 'Select Date & Session', 'Confirm & Book'];
const STEP_ICONS = [BuildingOffice2Icon, CalendarIcon, CheckCircleIcon];

// ── Token Success Card ────────────────────────────────────────────────────────

const TokenCard = ({ result, onDone }) => {
  const { appointment, token } = result;
  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-lg mx-auto">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <CheckCircleIcon className="w-10 h-10 text-green-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Appointment Confirmed!</h2>
      <p className="text-gray-500 mb-8">Your appointment has been booked successfully.</p>

      {token?.number && (
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 mb-6 text-white">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TicketIcon className="w-6 h-6 opacity-80" />
            <span className="text-sm font-medium uppercase tracking-widest opacity-80">Your Appointment Token</span>
          </div>
          <div className="text-6xl font-black tracking-wider mb-4">{token.number}</div>
          {token.reportingTime && (
            <div className="bg-white/20 rounded-xl p-3">
              <p className="text-sm opacity-80 mb-1">Please arrive by</p>
              <p className="text-2xl font-bold">{fmt12(token.reportingTime)}</p>
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Reference</span>
          <span className="font-mono font-semibold text-gray-800">{appointment?.appointmentReference}</span>
        </div>
        {token?.timeBlock && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Date</span>
              <span className="font-semibold text-gray-800">{fmtDate(token.timeBlock.date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Consultation Time</span>
              <span className="font-semibold text-gray-800">
                {fmt12(token.timeBlock.startTime)} – {fmt12(token.timeBlock.endTime)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800 text-left flex gap-3">
        <InformationCircleIcon className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <p>{token?.patientMessage || 'Please arrive on time and check in at reception. Your token will be activated after check-in.'}</p>
      </div>

      <button
        onClick={onDone}
        className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
      >
        Go to Dashboard
      </button>
    </div>
  );
};

// ── Time Block Grid ───────────────────────────────────────────────────────────

const TimeBlockGrid = ({ blocks, selectedBlock, onSelect, loading, error }) => {
  if (loading) return (
    <div className="text-center py-10">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
      <p className="text-gray-500 mt-3 text-sm">Loading available sessions...</p>
    </div>
  );

  if (error) return (
    <div className="text-center py-8 bg-red-50 rounded-xl border border-red-200">
      <ClockIcon className="w-10 h-10 text-red-300 mx-auto mb-2" />
      <p className="text-red-600 font-medium">{error}</p>
      <p className="text-sm text-red-400 mt-1">Please select a different date</p>
    </div>
  );

  if (!blocks || blocks.length === 0) return (
    <div className="text-center py-8 bg-gray-50 rounded-xl border border-gray-200">
      <ClockIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-500">No sessions available for this date</p>
      <p className="text-sm text-gray-400 mt-1">Please select a different date</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        const isSelected  = selectedBlock?._id === block._id;
        const isClosed    = block.availabilityStatus === 'CLOSED';
        const isFull      = block.availabilityStatus === 'FULLY_BOOKED';
        const isConflict   = Boolean(block.patientConflict);
        const isDisabled  = isClosed || isFull;

        let styleKey;
        if (isSelected)                                   styleKey = 'SELECTED';
        else if (isConflict)                              styleKey = 'CONFLICT';
        else if (isClosed)                                styleKey = 'CLOSED';
        else if (isFull)                                  styleKey = 'FULLY_BOOKED';
        else if (block.availabilityStatus === 'LIMITED')  styleKey = 'LIMITED';
        else                                              styleKey = 'AVAILABLE';

        return (
          <button
            key={block._id}
            onClick={() => !isDisabled && onSelect(block)}
            disabled={isDisabled}
            className={`w-full rounded-xl border-2 p-4 text-left transition-all duration-200 ${BLOCK_STYLES[styleKey]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className={`text-center min-w-[90px] ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                  <p className="text-lg font-bold">{fmt12(block.startTime)}</p>
                  <p className={`text-xs ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                    – {fmt12(block.endTime)}
                  </p>
                </div>
                <div>
                  {block.sessionName && (
                    <p className={`font-semibold text-sm ${isSelected ? 'text-white' : isClosed ? 'text-gray-400' : 'text-gray-800'}`}>
                      {block.sessionName}
                    </p>
                  )}
                  {block.reportingTime && !isClosed && (
                    <p className={`text-xs mt-0.5 ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                      Arrive by {fmt12(block.reportingTime)}
                    </p>
                  )}
                  {isConflict && !isClosed && !isFull && (
                    <p className="text-xs mt-0.5 text-red-600 font-medium">
                    You already have a booking during this time.
                    </p>
                  )}
                  {isClosed && <p className="text-xs mt-0.5 text-gray-400">Session has ended</p>}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Capacity indicator */}
                <div className="text-right">
                  {isClosed ? (
                    <span className="text-xs font-semibold text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">Closed</span>
                  ) : isFull ? (
                    <span className="text-xs font-semibold text-red-500 bg-red-100 px-2 py-0.5 rounded-full">Full</span>
                  ) : block.availabilityStatus === 'LIMITED' ? (
                    <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                      {block.remainingSlots} left
                    </span>
                  ) : (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'text-green-600 bg-green-100'}`}>
                      {block.remainingSlots} slots
                    </span>
                  )}
                </div>
                {isSelected && (
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                    <CheckCircleIcon className="w-5 h-5 text-blue-600" />
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-blue-300 inline-block" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-amber-300 bg-amber-50 inline-block" /> Limited</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-600 inline-block" /> Selected</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-50 border border-red-200 inline-block" /> Full</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" /> Closed</span>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const AppointmentBooking = () => {
  const { user }      = useAuth();
  const navigate      = useNavigate();
  const location      = useLocation();
  const submittingRef = useRef(false);

  // ── State ──────────────────────────────────────────────────────────────────
  const [step, setStep]                             = useState(1);
  const [loading, setLoading]                       = useState(false);
  const [selectedDate, setSelectedDate]             = useState('');
  const [appointmentType, setAppointmentType]       = useState('consultation');
  const [chiefComplaint, setChiefComplaint]         = useState('');
  const [rescheduleFromId, setRescheduleFromId]     = useState(null);
  const [bookingResult, setBookingResult]           = useState(null);

  const [departments, setDepartments]               = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [timeBlocks, setTimeBlocks]                 = useState([]);
  const [selectedBlock, setSelectedBlock]           = useState(null);
  const [loadingBlocks, setLoadingBlocks]           = useState(false);
  const [blockError, setBlockError]                 = useState(null);
  const [bookedDatesForDept, setBookedDatesForDept] = useState([]);
  const [dateAlreadyBooked, setDateAlreadyBooked]   = useState(false);

  const handleSelectBlock = useCallback((block) => {
    if (block.patientConflict) {
      toast.error(block.conflictMessage || 'You already have another appointment during this time. Please choose a non-conflicting time slot.');
      setSelectedBlock(null);
      return;
    }

    setSelectedBlock(block);
  }, []);

  // ── Date bounds ────────────────────────────────────────────────────────────
  const minDate = new Date().toISOString().split('T')[0];
  const maxDate = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().split('T')[0];
  })();

  // ── URL params (reschedule pre-fill) ───────────────────────────────────────
  useEffect(() => {
    const params    = new URLSearchParams(location.search);
    const fromId    = params.get('rescheduleFrom');
    const complaint = params.get('chiefComplaint');
    const type      = params.get('appointmentType');
    if (fromId)    setRescheduleFromId(fromId);
    if (complaint) setChiefComplaint(decodeURIComponent(complaint));
    if (type)      setAppointmentType(type);
  }, [location.search]);

  // ── Load active departments ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await departmentAPI.getDepartments({ status: 'active' });
        if (res.data.success) setDepartments(res.data.data);
      } catch { toast.error('Failed to load departments'); }
    })();
  }, []);

  // ── Fetch dates already booked for selected department ─────────────────────
  useEffect(() => {
    if (!selectedDepartment) {
      setBookedDatesForDept([]);
      setDateAlreadyBooked(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await appointmentAPI.getBookedDates(selectedDepartment._id);
        if (!cancelled && res.data.success) setBookedDatesForDept(res.data.data.dates || []);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [selectedDepartment]);

  // ── Load time blocks for selected date ────────────────────────────────────
  const fetchBlocks = useCallback(async () => {
    if (!selectedDepartment || !selectedDate) return;
    if (dateAlreadyBooked) {
      setTimeBlocks([]);
      setSelectedBlock(null);
      return;
    }
    setLoadingBlocks(true);
    setBlockError(null);
    setTimeBlocks([]);
    setSelectedBlock(null);
    try {
      const res = await appointmentAPI.getBlockAvailability(selectedDepartment._id, selectedDate, user?._id || null);
      if (res.data.success) {
        setTimeBlocks(res.data.data || []);
        if ((res.data.data || []).length === 0) setBlockError('No sessions available for this date.');
      }
    } catch (err) {
      setBlockError(err.response?.data?.message || 'Unable to load sessions.');
    } finally {
      setLoadingBlocks(false);
    }
  }, [selectedDepartment, selectedDate, dateAlreadyBooked, user?._id]);

  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const isComplaintValid    = chiefComplaint.trim().length >= 5 && chiefComplaint.trim().length <= 500;
  const canProceedToConfirm = selectedDate && !dateAlreadyBooked && selectedBlock && appointmentType && isComplaintValid;

  // ── Book appointment ───────────────────────────────────────────────────────
  const handleBook = async () => {
    if (submittingRef.current) return;
    if (!isComplaintValid) { toast.error('Reason for visit must be 5–500 characters.'); return; }

    submittingRef.current = true;
    setLoading(true);
    try {
      const payload = {
        bookingType:     'general_opd',
        departmentId:    selectedDepartment._id,
        timeBlockId:     selectedBlock._id,
        appointmentDate: selectedDate,
        appointmentType,
        chiefComplaint:  chiefComplaint.trim(),
        ...(rescheduleFromId && { rescheduledFromAppointmentId: rescheduleFromId }),
      };

      const res = await appointmentAPI.createAppointment(payload);
      if (res.data.success) {
        setBookingResult(res.data.data);
        setStep(4);
        toast.success(rescheduleFromId ? 'Appointment rescheduled!' : 'Appointment booked!');
      }
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.errors) toast.error(errData.errors.map(e => e.msg).join(' | '));
      else toast.error(errData?.message || 'Failed to book appointment');
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const appointmentTypes = [
    { value: 'consultation', label: 'Consultation' },
    { value: 'follow-up',    label: 'Follow-up'    },
    { value: 'check-up',     label: 'Check-up'     },
    { value: 'emergency',    label: 'Emergency'     },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 sm:p-8 text-white shadow-xl">
            <h1 className="text-2xl sm:text-3xl font-bold mb-1">Book Appointment</h1>
            <p className="text-sm sm:text-base text-blue-100">Schedule your hospital visit</p>
          </div>
        </div>

        {/* Progress steps */}
        {step < 4 && (
          <div className="mb-8 flex items-center justify-center gap-3 flex-wrap">
            {STEPS.map((title, idx) => {
              const Icon      = STEP_ICONS[idx];
              const stepNum   = idx + 1;
              const isDone    = step > stepNum;
              const isCurrent = step === stepNum;
              return (
                <React.Fragment key={stepNum}>
                  <div className="flex items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                      isDone    ? 'bg-green-500 border-green-500 text-white' :
                      isCurrent ? 'bg-blue-600 border-blue-600 text-white' :
                                  'bg-white border-gray-300 text-gray-400'
                    }`}>
                      {isDone ? <CheckCircleIcon className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`text-sm font-medium hidden sm:inline ${
                      isCurrent ? 'text-blue-600' : isDone ? 'text-green-600' : 'text-gray-400'
                    }`}>
                      {title}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && <ArrowRightIcon className="w-4 h-4 text-gray-300" />}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* ── STEP 1: Choose Department ─────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Choose Department</h2>

            {departments.length === 0 ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
                <p className="text-gray-500 mt-3">Loading departments...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {departments.map((dept) => (
                  <button
                    key={dept._id}
                    onClick={() => { setSelectedDepartment(dept); setStep(2); }}
                    className="p-5 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 text-left transition-all group"
                  >
                    <div className="w-10 h-10 bg-blue-100 group-hover:bg-blue-200 rounded-lg flex items-center justify-center mb-3 transition-colors">
                      <BuildingOffice2Icon className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="font-bold text-gray-900">{dept.name}</p>
                    {dept.description && (
                      <p className="text-sm text-gray-500 mt-1">{dept.description}</p>
                    )}
                    {dept.averageConsultationMinutes && (
                      <p className="text-xs text-blue-500 mt-2">~{dept.averageConsultationMinutes} min/consultation</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Date & Session ────────────────────────────────────────── */}
        {step === 2 && selectedDepartment && (
          <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Select Date &amp; Session</h2>
              <button
                onClick={() => { setStep(1); setSelectedDate(''); setSelectedBlock(null); }}
                className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm"
              >
                <ArrowLeftIcon className="w-4 h-4" /> Change Dept
              </button>
            </div>

            {/* Department banner */}
            <div className="bg-blue-50 rounded-xl p-4 mb-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-200 rounded-lg flex items-center justify-center">
                <BuildingOffice2Icon className="w-5 h-5 text-blue-700" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedDepartment.name}</p>
                {selectedDepartment.description && (
                  <p className="text-sm text-blue-600">{selectedDepartment.description}</p>
                )}
              </div>
            </div>

            {rescheduleFromId && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
                <p className="font-semibold text-amber-800">Rescheduling appointment</p>
                <p className="text-amber-700 mt-0.5">Select a new date and session below.</p>
              </div>
            )}

            {/* Date picker */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CalendarIcon className="w-4 h-4 inline mr-1 text-gray-400" />
                Select Date
              </label>
              <input
                type="date"
                value={selectedDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => {
                  const d = e.target.value;
                  setSelectedDate(d);
                  setDateAlreadyBooked(bookedDatesForDept.some(b => b.date === d));
                  setSelectedBlock(null);
                }}
                className="w-full sm:w-64 px-4 py-2.5 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Already-booked warning */}
            {selectedDate && dateAlreadyBooked && (
              <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
                <div className="flex gap-3">
                  <div className="shrink-0 w-10 h-10 bg-amber-200 rounded-full flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-amber-900">You already have a booking on this date</p>
                    <p className="text-sm text-amber-700 mt-1">
                      You have an active {selectedDepartment?.name} appointment on{' '}
                      <strong>{new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong>.
                      {bookedDatesForDept.find(b => b.date === selectedDate)?.token && (
                        <> Your token is <strong>{bookedDatesForDept.find(b => b.date === selectedDate).token}</strong>.</>
                      )}
                    </p>
                    <p className="text-sm text-amber-600 mt-2">Please select a different date.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Time block grid */}
            {selectedDate && !dateAlreadyBooked && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  <ClockIcon className="w-4 h-4 inline mr-1 text-gray-400" />
                  Available Sessions
                </h3>
                <TimeBlockGrid
                  blocks={timeBlocks}
                  selectedBlock={selectedBlock}
                  onSelect={handleSelectBlock}
                  loading={loadingBlocks}
                  error={blockError}
                />
              </div>
            )}

            {/* Appointment type */}
            {selectedBlock && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Appointment Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {appointmentTypes.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setAppointmentType(value)}
                      className={`py-2.5 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        appointmentType === value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-200 hover:border-blue-300 text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chief complaint */}
            {selectedBlock && (
              <ComplaintField value={chiefComplaint} onChange={setChiefComplaint} />
            )}

            <button
              onClick={() => setStep(3)}
              disabled={!canProceedToConfirm}
              className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold disabled:opacity-40 disabled:cursor-not-allowed mt-2"
            >
              Continue to Confirm
            </button>
          </div>
        )}

        {/* ── STEP 3: Confirm ──────────────────────────────────────────────── */}
        {step === 3 && selectedDepartment && selectedBlock && (
          <div className="bg-white rounded-2xl shadow-xl p-5 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Confirm Appointment</h2>
              <button
                onClick={() => setStep(2)}
                className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm"
              >
                <ArrowLeftIcon className="w-4 h-4" /> Edit
              </button>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-gray-50 rounded-xl p-6 mb-6 space-y-4">
              <h3 className="font-semibold text-gray-900">Appointment Summary</h3>

              <Row icon={<BuildingOffice2Icon className="w-5 h-5 text-blue-500" />}
                label="Department" value={selectedDepartment.name} />

              <Row icon={<CalendarIcon className="w-5 h-5 text-blue-500" />}
                label="Date" value={fmtDate(selectedDate)} />

              <Row icon={<ClockIcon className="w-5 h-5 text-blue-500" />}
                label="Consultation Time"
                value={`${fmt12(selectedBlock.startTime)} – ${fmt12(selectedBlock.endTime)}`}
                sub={selectedBlock.reportingTime ? `Arrive by ${fmt12(selectedBlock.reportingTime)}` : null}
              />

              <Row icon={<ClockIcon className="w-5 h-5 text-blue-500" />}
                label="Type"
                value={appointmentType.charAt(0).toUpperCase() + appointmentType.slice(1)} />

              <Row icon={<InformationCircleIcon className="w-5 h-5 text-blue-500" />}
                label="Reason for Visit"
                value={chiefComplaint} />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-6 text-sm text-blue-700 flex gap-2">
              <InformationCircleIcon className="w-5 h-5 shrink-0 mt-0.5 text-blue-500" />
              <p>An appointment token will be issued immediately after booking. A doctor will be assigned when you check in at reception.</p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold"
              >
                Back
              </button>
              <button
                onClick={handleBook}
                disabled={loading}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading
                  ? <><Spinner /><span>Booking...</span></>
                  : <><CheckCircleIcon className="w-5 h-5" /><span>Confirm &amp; Book</span></>}
              </button>
            </div>
          </div>
        )}

        {/* ── SUCCESS SCREEN ────────────────────────────────────────────────── */}
        {step === 4 && bookingResult && (
          <TokenCard
            result={bookingResult}
            onDone={() => navigate('/dashboard?tab=overview', { replace: true })}
          />
        )}

      </div>
    </div>
  );
};

// ── Shared sub-components ─────────────────────────────────────────────────────

const Row = ({ icon, label, value, sub }) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5">{icon}</span>
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-blue-600 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const Spinner = () => (
  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current inline-block" />
);

const ComplaintField = ({ value, onChange }) => {
  const len      = value.trim().length;
  const tooShort = len > 0 && len < 5;
  const valid    = len >= 5;
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Reason for Visit <span className="text-red-500">*</span>
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Describe your symptoms or reason for the visit (minimum 5 characters)..."
        rows={4}
        maxLength={500}
        className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none transition-colors ${
          tooShort ? 'border-red-400 bg-red-50' : valid ? 'border-green-400 bg-green-50/30' : 'border-gray-300'
        }`}
      />
      <div className="mt-1.5 flex justify-between text-xs">
        <span className={tooShort ? 'text-red-500' : valid ? 'text-green-600' : 'text-gray-400'}>
          {tooShort ? `Need ${5 - len} more characters` : valid ? '✓ Valid' : 'Min 5 characters required'}
        </span>
        <span className={len > 450 ? 'text-amber-500' : 'text-gray-400'}>{len}/500</span>
      </div>
    </div>
  );
};

export default AppointmentBooking;
