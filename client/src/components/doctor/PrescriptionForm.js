import React, { useState, useRef } from 'react';
import { PlusIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const COMMON_DRUGS = [
  { name: 'Paracetamol', forms: ['Tablet 500mg', 'Tablet 1000mg', 'Syrup 120mg/5ml', 'Suppository 125mg'] },
  { name: 'Amoxicillin', forms: ['Capsule 250mg', 'Capsule 500mg', 'Syrup 125mg/5ml'] },
  { name: 'Metformin', forms: ['Tablet 500mg', 'Tablet 850mg', 'Tablet 1000mg'] },
  { name: 'Atorvastatin', forms: ['Tablet 10mg', 'Tablet 20mg', 'Tablet 40mg'] },
  { name: 'Amlodipine', forms: ['Tablet 5mg', 'Tablet 10mg'] },
  { name: 'Omeprazole', forms: ['Capsule 20mg', 'Capsule 40mg'] },
  { name: 'Losartan', forms: ['Tablet 25mg', 'Tablet 50mg', 'Tablet 100mg'] },
  { name: 'Salbutamol', forms: ['Inhaler 100mcg', 'Tablet 2mg', 'Tablet 4mg', 'Syrup 2mg/5ml'] },
  { name: 'Cetirizine', forms: ['Tablet 10mg', 'Syrup 5mg/5ml'] },
  { name: 'Metronidazole', forms: ['Tablet 200mg', 'Tablet 400mg'] },
  { name: 'Ibuprofen', forms: ['Tablet 200mg', 'Tablet 400mg', 'Tablet 600mg'] },
  { name: 'Aspirin', forms: ['Tablet 75mg', 'Tablet 300mg'] },
  { name: 'Clopidogrel', forms: ['Tablet 75mg'] },
  { name: 'Pantoprazole', forms: ['Tablet 40mg'] },
  { name: 'Ciprofloxacin', forms: ['Tablet 250mg', 'Tablet 500mg', 'Tablet 750mg'] },
  { name: 'Azithromycin', forms: ['Tablet 250mg', 'Tablet 500mg'] },
  { name: 'Doxycycline', forms: ['Capsule 100mg'] },
  { name: 'Prednisolone', forms: ['Tablet 5mg', 'Tablet 10mg', 'Tablet 25mg'] },
  { name: 'Furosemide', forms: ['Tablet 20mg', 'Tablet 40mg'] },
  { name: 'Spironolactone', forms: ['Tablet 25mg', 'Tablet 100mg'] },
  { name: 'Metoprolol', forms: ['Tablet 25mg', 'Tablet 50mg', 'Tablet 100mg'] },
  { name: 'Insulin (Regular)', forms: ['Injection 100 IU/ml'] },
  { name: 'Insulin Glargine', forms: ['Injection 100 IU/ml'] },
  { name: 'Levothyroxine', forms: ['Tablet 25mcg', 'Tablet 50mcg', 'Tablet 100mcg'] },
  { name: 'Diclofenac', forms: ['Tablet 25mg', 'Tablet 50mg', 'Gel 1%'] },
  { name: 'Hydroxychloroquine', forms: ['Tablet 200mg'] },
  { name: 'Sertraline', forms: ['Tablet 50mg', 'Tablet 100mg'] },
  { name: 'Alprazolam', forms: ['Tablet 0.25mg', 'Tablet 0.5mg'] },
  { name: 'Pantoprazole + Domperidone', forms: ['Capsule 40mg + 10mg'] },
  { name: 'ORS Sachets', forms: ['Sachet for 200ml', 'Sachet for 1L'] },
  { name: 'Vitamin D3', forms: ['Tablet 1000 IU', 'Tablet 5000 IU', 'Capsule 60000 IU'] },
  { name: 'Calcium + Vitamin D', forms: ['Tablet 500mg + 250 IU'] },
  { name: 'Folic Acid', forms: ['Tablet 5mg'] },
  { name: 'Iron (Ferrous Sulphate)', forms: ['Tablet 200mg'] },
  { name: 'Betahistine', forms: ['Tablet 8mg', 'Tablet 16mg'] },
];

const FREQUENCIES = [
  'Once daily (OD)',
  'Twice daily (BD)',
  'Three times daily (TDS)',
  'Four times daily (QID)',
  'Every 6 hours',
  'Every 8 hours',
  'Every 12 hours',
  'Once at night (ON)',
  'When required (PRN)',
  'Alternate days',
  'Once weekly',
  'Twice weekly',
];

const DURATIONS = [
  '1 day', '2 days', '3 days', '5 days', '7 days',
  '10 days', '14 days', '1 month', '3 months', '6 months',
  'Ongoing (chronic)', 'Until review',
];

const emptyDrug = () => ({
  id: Date.now() + Math.random(),
  name: '',
  form: '',
  frequency: '',
  duration: '',
  instructions: '',
  searchTerm: '',
  suggestions: [],
  showDropdown: false,
});

const PrescriptionForm = ({ prescriptions, onChange }) => {
  const searchTimers = useRef({});

  const addRow = () => onChange([...prescriptions, emptyDrug()]);

  const removeRow = (id) => onChange(prescriptions.filter((r) => r.id !== id));

  const updateRow = (id, field, value) => {
    onChange(
      prescriptions.map((r) =>
        r.id === id ? { ...r, [field]: value } : r
      )
    );
  };

  const handleDrugSearch = (id, term) => {
    updateRow(id, 'searchTerm', term);
    updateRow(id, 'name', term);

    clearTimeout(searchTimers.current[id]);
    searchTimers.current[id] = setTimeout(() => {
      if (!term.trim()) {
        onChange(
          prescriptions.map((r) =>
            r.id === id ? { ...r, suggestions: [], showDropdown: false } : r
          )
        );
        return;
      }
      const results = COMMON_DRUGS.filter((d) =>
        d.name.toLowerCase().includes(term.toLowerCase())
      ).slice(0, 8);
      onChange(
        prescriptions.map((r) =>
          r.id === id
            ? { ...r, suggestions: results, showDropdown: results.length > 0 }
            : r
        )
      );
    }, 200);
  };

  const selectDrug = (id, drug) => {
    onChange(
      prescriptions.map((r) =>
        r.id === id
          ? {
              ...r,
              name: drug.name,
              form: drug.forms[0] || '',
              searchTerm: drug.name,
              suggestions: drug.forms.map((f) => ({ name: drug.name, form: f })),
              showDropdown: false,
            }
          : r
      )
    );
  };

  return (
    <div className="space-y-4">
      {prescriptions.length === 0 && (
        <div className="text-center py-4 text-gray-400 text-sm">
          No medications added yet. Click "+ Add Medication" below.
        </div>
      )}

      {prescriptions.map((row, idx) => (
        <div
          key={row.id}
          className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
              Rx #{idx + 1}
            </span>
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Drug name search */}
            <div className="md:col-span-2 relative">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Drug Name *
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={row.searchTerm}
                  onChange={(e) => handleDrugSearch(row.id, e.target.value)}
                  onBlur={() =>
                    setTimeout(
                      () => updateRow(row.id, 'showDropdown', false),
                      200
                    )
                  }
                  placeholder="Search drug or type manually..."
                  className="w-full pl-9 pr-4 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
                {row.showDropdown && (
                  <div className="absolute z-30 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-52 overflow-y-auto">
                    {row.suggestions.map((drug, i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={() => selectDrug(row.id, drug)}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors text-sm font-medium"
                      >
                        {drug.name}
                        <span className="text-gray-400 text-xs ml-2">
                          {drug.forms[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Dosage form */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Form &amp; Strength
              </label>
              <input
                type="text"
                value={row.form}
                onChange={(e) => updateRow(row.id, 'form', e.target.value)}
                placeholder="e.g. Tablet 500mg"
                className="w-full px-3 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Frequency */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Frequency *
              </label>
              <select
                value={row.frequency}
                onChange={(e) => updateRow(row.id, 'frequency', e.target.value)}
                className="w-full px-3 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Select frequency</option>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Duration
              </label>
              <select
                value={row.duration}
                onChange={(e) => updateRow(row.id, 'duration', e.target.value)}
                className="w-full px-3 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Select duration</option>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Instructions */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Instructions
              </label>
              <input
                type="text"
                value={row.instructions}
                onChange={(e) =>
                  updateRow(row.id, 'instructions', e.target.value)
                }
                placeholder="e.g. After meals, with water"
                className="w-full px-3 py-2 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="w-full py-3 border-2 border-dashed border-blue-300 text-blue-600 rounded-xl hover:bg-blue-50 transition-colors font-semibold text-sm flex items-center justify-center space-x-2"
      >
        <PlusIcon className="w-4 h-4" />
        <span>Add Medication</span>
      </button>
    </div>
  );
};

export default PrescriptionForm;
