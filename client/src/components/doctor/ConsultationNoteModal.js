import React, { useState, useRef, useCallback } from 'react';
import {
  XMarkIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PrinterIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { medicalRecordsAPI, prescriptionAPI } from '../../services/api';
import PrescriptionForm from './PrescriptionForm';
import icd10Codes from '../../data/icd10_codes.json';
import toast from 'react-hot-toast';

// ─── Print helper ────────────────────────────────────────────────────────────
const printPrescription = ({ patient, doctor, formData, prescriptions, date }) => {
  const drugsHTML = prescriptions
    .filter((r) => r.name)
    .map(
      (r, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>${r.name}</strong>${r.form ? ` – ${r.form}` : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${r.frequency || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${r.duration || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${r.instructions || '—'}</td>
      </tr>`
    )
    .join('');

  const html = `
<html>
<head>
  <title>Prescription — ${patient?.firstName} ${patient?.lastName}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; padding: 24px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px; }
    .hospital-name { font-size: 22px; font-weight: bold; color: #2563eb; }
    .rx-symbol { font-size: 48px; font-weight: bold; color: #2563eb; line-height: 1; }
    .section { margin: 12px 0; }
    .label { color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 14px; color: #111; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #eff6ff; padding: 8px; text-align: left; font-size: 12px; color: #1d4ed8; border-bottom: 2px solid #bfdbfe; }
    td { font-size: 13px; }
    .footer { margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px; display: flex; justify-content: space-between; }
    .sig-line { border-bottom: 1px solid #374151; width: 200px; margin-top: 48px; }
  </style>
</head>
<body onload="window.print();window.close()">
  <div class="header">
    <div>
      <div class="hospital-name">MediQueue Hospital</div>
      <div style="font-size:13px;color:#6b7280;">OPD Prescription</div>
    </div>
    <div class="rx-symbol">℞</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
    <div class="section">
      <div class="label">Patient</div>
      <div class="value" style="font-size:16px;font-weight:bold;">${patient?.firstName} ${patient?.lastName}</div>
      <div class="value" style="color:#6b7280;">${patient?.dateOfBirth ? 'DOB: ' + new Date(patient.dateOfBirth).toLocaleDateString() : ''}</div>
    </div>
    <div class="section">
      <div class="label">Date</div>
      <div class="value">${date}</div>
      <div class="label" style="margin-top:8px;">Queue No.</div>
      <div class="value">${formData.queueNumber || '—'}</div>
    </div>
  </div>

  ${formData.diagnosisDisplay ? `
  <div class="section">
    <div class="label">Diagnosis</div>
    <div class="value">${formData.diagnosisDisplay}</div>
  </div>` : ''}

  ${drugsHTML ? `
  <div class="section" style="margin-top:16px;">
    <div class="label">Medications</div>
    <table>
      <thead><tr>
        <th>#</th><th>Drug</th><th>Frequency</th><th>Duration</th><th>Instructions</th>
      </tr></thead>
      <tbody>${drugsHTML}</tbody>
    </table>
  </div>` : '<div class="section"><div class="label">No medications prescribed</div></div>'}

  ${formData.treatmentPlan ? `
  <div class="section" style="margin-top:12px;">
    <div class="label">Treatment Plan / Notes</div>
    <div class="value" style="white-space:pre-wrap;">${formData.treatmentPlan}</div>
  </div>` : ''}

  ${formData.followUpDate ? `
  <div class="section">
    <div class="label">Follow-up Date</div>
    <div class="value">${new Date(formData.followUpDate).toLocaleDateString()}</div>
  </div>` : ''}

  <div class="footer">
    <div>
      <div class="sig-line"></div>
      <div style="font-size:13px;margin-top:6px;"><strong>Dr. ${doctor?.firstName} ${doctor?.lastName}</strong></div>
      <div style="font-size:12px;color:#6b7280;">${doctor?.specialization || 'General Medicine'}</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#9ca3af;">
      Printed: ${new Date().toLocaleString()}<br/>
      MediQueue Digital Health System
    </div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=700');
  if (win) { win.document.write(html); win.document.close(); }
};

// ─── ICD-10 search ───────────────────────────────────────────────────────────
const useICD10Search = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const search = useCallback((term) => {
    setQuery(term);
    clearTimeout(timer.current);
    if (!term.trim()) { setResults([]); setShow(false); return; }
    timer.current = setTimeout(() => {
      const lower = term.toLowerCase();
      const found = icd10Codes.filter(
        (c) =>
          c.code.toLowerCase().includes(lower) ||
          c.description.toLowerCase().includes(lower)
      ).slice(0, 8);
      setResults(found);
      setShow(found.length > 0);
    }, 200);
  }, []);

  return { query, setQuery, results, show, setShow, search };
};

// ─── Main Modal ──────────────────────────────────────────────────────────────
const ConsultationNoteModal = ({ entry, doctor, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState([]);
  const [form, setForm] = useState({
    chiefComplaint: entry?.notes || '',
    treatmentPlan: '',
    followUpDate: '',
    referral: '',
  });

  const icd10 = useICD10Search();
  const patient = entry?.patient;
  const today = new Date().toLocaleDateString();

  const addDiagnosis = (code) => {
    if (!selectedDiagnoses.find((d) => d.code === code.code)) {
      setSelectedDiagnoses((prev) => [...prev, code]);
    }
    icd10.setShow(false);
    icd10.setQuery('');
  };

  const removeDiagnosis = (code) =>
    setSelectedDiagnoses((prev) => prev.filter((d) => d.code !== code));

  const handleSave = async (andPrint = false) => {
    try {
      setSaving(true);
      const diagnosisText = selectedDiagnoses
        .map((d) => `${d.code}: ${d.description}`)
        .join('; ');

      const diagnosisDisplay = diagnosisText || form.chiefComplaint || 'Consultation';
      const activeMeds = prescriptions.filter((r) => r.name);

      const payload = {
        patient: patient?._id,
        doctor: doctor._id,
        recordType: 'consultation',
        title: `Consultation: ${form.chiefComplaint || 'General Visit'}`.substring(0, 120),
        description: form.treatmentPlan || form.chiefComplaint || 'Consultation note',
        visitDate: new Date().toISOString(),
        chiefComplaint: form.chiefComplaint,
        diagnosis: diagnosisDisplay,
        treatment: form.treatmentPlan,
        followUpDate: form.followUpDate || undefined,
        referral: form.referral || undefined,
        notes: [
          entry?.queueNumber ? `Queue: ${entry.queueNumber}` : '',
          form.referral ? `Referral: ${form.referral}` : ''
        ].filter(Boolean).join(' | ') || undefined,
        // 'medications' is mapped → MedicalRecord.prescriptions[] by the server route
        medications: activeMeds.map((r) => ({
          name: `${r.name}${r.form ? ` (${r.form})` : ''}`,
          dosage: r.frequency,
          duration: r.duration,
          instructions: r.instructions,
        })),
      };

      await medicalRecordsAPI.createRecord(payload);

      // Persist medicines as a proper Prescription document so they appear in
      // Patient Record → Prescription History across all future visits/doctors.
      if (activeMeds.length > 0 && patient?._id) {
        try {
          await prescriptionAPI.createPrescription({
            patientId:     patient._id,
            diagnosis:     diagnosisDisplay,
            indication:    diagnosisDisplay,
            notes:         form.treatmentPlan || '',
            appointmentId: entry?.appointment || undefined,
            medications:   activeMeds.map((r) => ({
              name:         r.name,
              form:         r.form,
              frequency:    r.frequency,
              duration:     r.duration,
              instructions: r.instructions,
            })),
          });
        } catch (rxErr) {
          console.error('Failed to persist prescription record:', rxErr);
          toast.error('Consultation saved but prescription history could not be recorded');
        }
      }

      if (andPrint) {
        printPrescription({
          patient,
          doctor,
          formData: {
            diagnosisDisplay,
            treatmentPlan: form.treatmentPlan,
            followUpDate: form.followUpDate,
            queueNumber: entry?.queueNumber,
          },
          prescriptions,
          date: today,
        });
      }

      onSaved();
    } catch (err) {
      console.error('Error saving consultation note:', err);
      toast.error(err.response?.data?.message || 'Failed to save notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 backdrop-blur-sm">
      {/* Slide-over panel */}
      <div className="relative w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <DocumentTextIcon className="w-6 h-6 text-white" />
            <div>
              <h2 className="text-lg font-bold text-white">Consultation Notes</h2>
              <p className="text-indigo-200 text-xs">
                {patient?.firstName} {patient?.lastName} · Queue {entry?.queueNumber}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-indigo-200 hover:text-white hover:bg-indigo-500 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Chief complaint */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">
              Chief Complaint
            </label>
            <textarea
              rows={2}
              value={form.chiefComplaint}
              onChange={(e) => setForm((f) => ({ ...f, chiefComplaint: e.target.value }))}
              placeholder="Patient's presenting complaint..."
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-none"
            />
          </div>

          {/* Diagnosis — ICD-10 search */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">
              Diagnosis (ICD-10)
            </label>

            {/* Selected diagnoses */}
            {selectedDiagnoses.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedDiagnoses.map((d) => (
                  <span
                    key={d.code}
                    className="flex items-center space-x-1 bg-indigo-100 text-indigo-800 text-xs font-semibold px-3 py-1.5 rounded-full"
                  >
                    <span className="font-mono">{d.code}</span>
                    <span>·</span>
                    <span className="max-w-[180px] truncate">{d.description}</span>
                    <button
                      onClick={() => removeDiagnosis(d.code)}
                      className="ml-1 text-indigo-500 hover:text-indigo-700"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={icd10.query}
                onChange={(e) => icd10.search(e.target.value)}
                onBlur={() => setTimeout(() => icd10.setShow(false), 200)}
                placeholder="Search ICD-10 code or description..."
                className="w-full pl-9 pr-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              />
              {icd10.show && (
                <div className="absolute z-30 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                  {icd10.results.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onMouseDown={() => addDiagnosis(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors text-sm"
                    >
                      <span className="font-mono font-bold text-indigo-700 mr-2">{c.code}</span>
                      {c.description}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Prescription */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2 uppercase tracking-wide">
              Prescription
            </label>
            <PrescriptionForm
              prescriptions={prescriptions}
              onChange={setPrescriptions}
            />
          </div>

          {/* Treatment plan / notes */}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">
              Treatment Plan / Clinical Notes
            </label>
            <textarea
              rows={3}
              value={form.treatmentPlan}
              onChange={(e) => setForm((f) => ({ ...f, treatmentPlan: e.target.value }))}
              placeholder="Management plan, investigations ordered, advice given..."
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-none"
            />
          </div>

          {/* Follow-up and referral */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">
                Follow-up Date
              </label>
              <input
                type="date"
                value={form.followUpDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wide">
                Referral
              </label>
              <input
                type="text"
                value={form.referral}
                onChange={(e) => setForm((f) => ({ ...f, referral: e.target.value }))}
                placeholder="e.g. Cardiology OPD"
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center space-x-3 px-6 py-4 bg-gray-50 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors text-sm flex items-center justify-center space-x-2"
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : <CheckCircleIcon className="w-4 h-4" />}
            <span>{saving ? 'Saving...' : 'Save Notes'}</span>
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors text-sm flex items-center space-x-2"
          >
            <PrinterIcon className="w-4 h-4" />
            <span>Save &amp; Print Rx</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsultationNoteModal;
