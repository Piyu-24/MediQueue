import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  QrCodeIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  UserIcon,
  BeakerIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { dispensaryAPI } from '../../services/api';
import toast from 'react-hot-toast';

// ── Status badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    active:               'bg-blue-100 text-blue-800',
    awaiting_dispensing:  'bg-yellow-100 text-yellow-800',
    dispensed:            'bg-green-100 text-green-800',
    completed:            'bg-gray-100 text-gray-700',
    expired:              'bg-red-100 text-red-800',
    cancelled:            'bg-red-100 text-red-800',
  };
  const label = {
    active:              'Active',
    awaiting_dispensing: 'Awaiting Dispensing',
    dispensed:           'Dispensed',
    completed:           'Completed',
    expired:             'Expired',
    cancelled:           'Cancelled',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-700'}`}>
      {label[status] || status}
    </span>
  );
};

// ── Format date ───────────────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
const DispensaryDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('scan');

  // ── Scan tab ──────────────────────────────────────────────────────────────
  const [cardInput, setCardInput]       = useState('');
  const [scanLoading, setScanLoading]   = useState(false);
  const [isScanning, setIsScanning]     = useState(false);
  const [scanResult, setScanResult]     = useState(null); // { patient, healthCard, prescriptions }
  const [issuingId, setIssuingId]       = useState(null); // prescription id currently being marked issued
  const cardInputRef = useRef(null);
  const html5QrRef   = useRef(null);
  const qrReaderId   = 'dispensary-qr-reader';

  // ── Queue tab ─────────────────────────────────────────────────────────────
  const [queue, setQueue]           = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);

  // ── History tab ───────────────────────────────────────────────────────────
  const [history, setHistory]           = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const tabs = [
    { id: 'scan',    name: 'Scan & Dispense', icon: QrCodeIcon },
    { id: 'queue',   name: 'Pending Queue',   icon: ClockIcon },
    { id: 'history', name: 'Dispense History', icon: ClipboardDocumentListIcon },
  ];

  useEffect(() => {
    if (activeTab === 'scan') setTimeout(() => cardInputRef.current?.focus(), 100);
    if (activeTab === 'queue') fetchQueue();
    if (activeTab === 'history') fetchHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'scan') stopScanner();
    return () => stopScanner();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── QR camera scanner ─────────────────────────────────────────────────────
  const startScanner = async () => {
    if (isScanning) return;
    try {
      if (!html5QrRef.current) html5QrRef.current = new Html5Qrcode(qrReaderId);
      setIsScanning(true);
      await html5QrRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          let display = decoded;
          if (decoded.startsWith('{')) {
            try { const p = JSON.parse(decoded); if (p.cardNumber) display = p.cardNumber; } catch {}
          }
          setCardInput(display);
          handleScan(decoded);
          stopScanner();
        },
        () => {}
      );
    } catch {
      toast.error('Unable to start camera. Check permissions or use manual entry.');
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (!html5QrRef.current) return;
    try {
      if (html5QrRef.current.isScanning) await html5QrRef.current.stop();
      await html5QrRef.current.clear();
    } catch {}
    finally { setIsScanning(false); }
  };

  // ── Scan / lookup ─────────────────────────────────────────────────────────
  const handleScan = async (overrideValue) => {
    const raw = (overrideValue ?? cardInput).trim();
    if (!raw) { toast.error('Enter or scan a health card number'); return; }

    let payload = { cardNumber: raw.toUpperCase() };
    if (raw.startsWith('{')) {
      try { JSON.parse(raw); payload = { qrData: raw }; } catch {}
    }

    try {
      setScanLoading(true);
      setScanResult(null);
      const res = await dispensaryAPI.scan(payload);
      if (res.data.success) {
        setScanResult(res.data.data);
        if (res.data.data.prescriptions.length === 0) {
          toast('No active prescriptions found for this patient', { icon: '' });
        } else {
          toast.success(`Found ${res.data.data.prescriptions.length} prescription(s)`);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  };

  // ── One-click issue ───────────────────────────────────────────────────────
  // Marks the whole prescription as issued. The dispense record is auto-filled
  // from the prescription's own medications — no manual entry, no slip printing.
  const handleQuickIssue = async (rx) => {
    const items = (rx.medications || [])
      .filter(m => m.drugName)
      .map(m => ({
        drugName:    m.drugName,
        strength:    m.strength || '',
        dosageForm:  m.dosageForm || '',
        quantity:    m.quantity && m.quantity > 0 ? m.quantity : 1,
        batchNumber: '',
        notes:       m.instructions || ''
      }));
    if (items.length === 0) { toast.error('This prescription has no medicines to issue'); return; }

    try {
      setIssuingId(rx._id);
      const res = await dispensaryAPI.dispense(rx._id, { itemsDispensed: items, notes: '' });
      if (res.data.success) {
        toast.success('Medicines marked as issued');
        // Reflect "issued" in the scan list…
        setScanResult(prev => prev ? {
          ...prev,
          prescriptions: prev.prescriptions.map(p =>
            p._id === rx._id ? { ...p, status: 'dispensed' } : p
          )
        } : prev);
        // …and drop it from the pending queue if it came from there
        setQueue(prev => prev.filter(p => p._id !== rx._id));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to issue medicines');
    } finally {
      setIssuingId(null);
    }
  };

  // ── Queue ─────────────────────────────────────────────────────────────────
  const fetchQueue = async () => {
    try {
      setQueueLoading(true);
      const res = await dispensaryAPI.getQueue();
      if (res.data.success) setQueue(res.data.data.prescriptions);
    } catch { toast.error('Failed to load queue'); }
    finally { setQueueLoading(false); }
  };


  // ── History ───────────────────────────────────────────────────────────────
  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await dispensaryAPI.getHistory({ limit: 100 });
      if (res.data.success) setHistory(res.data.data.history);
    } catch { toast.error('Failed to load history'); }
    finally { setHistoryLoading(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50 to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl shadow-md">
              <BeakerIcon className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dispensary Console</h1>
              <p className="text-sm text-gray-500">
                Welcome, {user?.firstName}! · {new Date().toLocaleDateString('en-LK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-2">
            <nav className="flex -mb-px">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 px-6 py-4 border-b-2 font-semibold text-sm whitespace-nowrap transition-all ${
                      activeTab === tab.id
                        ? 'border-teal-600 text-teal-600 bg-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}>
                    <Icon className="w-4 h-4" />
                    <span>{tab.name}</span>
                    {tab.id === 'queue' && queue.length > 0 && (
                      <span className="bg-yellow-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {queue.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-6 md:p-8">

            {/* ══ TAB 1 — SCAN & DISPENSE ══ */}
            {activeTab === 'scan' && (
              <div className="space-y-6">

                {/* Scan input */}
                <div className="bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-teal-800 mb-3 flex items-center space-x-2">
                    <span className="w-6 h-6 bg-teal-600 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
                    <span>Scan Patient QR / Enter Health Card</span>
                  </h3>
                  <div className="flex flex-wrap gap-3 mb-4">
                    <button onClick={startScanner} disabled={isScanning}
                      className="px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 font-semibold text-sm">
                      {isScanning ? 'Scanning…' : 'Start Camera Scan'}
                    </button>
                    <button onClick={stopScanner} disabled={!isScanning}
                      className="px-4 py-2 bg-white border border-teal-200 text-teal-700 rounded-xl hover:bg-teal-50 disabled:opacity-50 font-semibold text-sm">
                      Stop Scan
                    </button>
                  </div>
                  <div id={qrReaderId} className="w-full max-w-sm bg-white border border-teal-200 rounded-xl p-3 min-h-[240px] flex items-center justify-center text-xs text-teal-700 mb-4">
                    {!isScanning && 'Camera preview appears here after starting scan.'}
                  </div>
                  <div className="flex space-x-3">
                    <div className="flex-1 relative">
                      <QrCodeIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        ref={cardInputRef}
                        type="text"
                        value={cardInput}
                        onChange={e => setCardInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleScan()}
                        placeholder="Scan QR or type Health Card ID (e.g. HC2600000X)"
                        className="w-full pl-12 pr-4 py-3.5 border-2 border-teal-200 rounded-xl focus:ring-2 focus:ring-teal-500 text-base font-mono"
                      />
                    </div>
                    <button onClick={() => handleScan()} disabled={scanLoading}
                      className="px-6 py-3.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 font-semibold flex items-center space-x-2 shadow-md">
                      {scanLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <MagnifyingGlassIcon className="w-5 h-5" />}
                      <span>{scanLoading ? 'Looking up…' : 'Look Up'}</span>
                    </button>
                  </div>
                </div>

                {/* Patient + prescriptions */}
                {scanResult && (
                  <div className="space-y-4">
                    {/* Patient card */}
                    <div className="bg-white border-2 border-teal-200 rounded-2xl p-5">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-teal-700" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">
                            {scanResult.patient.firstName} {scanResult.patient.lastName}
                          </h3>
                          <p className="text-sm text-gray-500">
                            Card: {scanResult.patient.digitalHealthCardId || scanResult.healthCard.cardNumber}
                            {scanResult.patient.phone && ` · ${scanResult.patient.phone}`}
                          </p>
                        </div>
                        <div className="ml-auto">
                          <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-3 py-1 rounded-full">
                            {scanResult.healthCard.bloodGroup || 'Blood group N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Prescriptions list */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center space-x-2">
                        <span className="w-6 h-6 bg-gray-600 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
                        <span>Select Prescription to Dispense</span>
                      </h3>
                      {scanResult.prescriptions.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
                          No active prescriptions found for this patient.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {scanResult.prescriptions.map(rx => (
                            <div key={rx._id}
                              className={`border-2 rounded-xl p-4 transition-all ${
                                rx.status === 'dispensed'
                                  ? 'border-green-200 bg-green-50 opacity-70'
                                  : 'border-gray-200 bg-white hover:border-teal-300'
                              }`}>
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="font-bold text-gray-900 text-sm font-mono">{rx.prescriptionNumber}</span>
                                    <StatusBadge status={rx.status} />
                                  </div>
                                  <p className="text-sm text-gray-600 mb-1">
                                    Dr. {rx.doctor?.firstName} {rx.doctor?.lastName}
                                    {rx.doctor?.specialization && ` · ${rx.doctor.specialization}`}
                                  </p>
                                  <p className="text-xs text-gray-500 mb-2">
                                    {rx.diagnosis} · Prescribed {fmtDate(rx.prescribedDate)} · Expires {fmtDate(rx.expiryDate)}
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {rx.medications.map((m, i) => (
                                      <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                                        {m.drugName} {m.strength} × {m.quantity}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  {rx.status === 'dispensed' ? (
                                    <span className="flex items-center gap-1 text-green-600 text-sm font-semibold">
                                      <CheckCircleIcon className="w-5 h-5" /> Issued
                                    </span>
                                  ) : (
                                    <button onClick={() => handleQuickIssue(rx)} disabled={issuingId === rx._id}
                                      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-60 text-sm font-semibold shadow-sm">
                                      {issuingId === rx._id
                                        ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                        : <CheckCircleIcon className="w-4 h-4" />}
                                      <span>{issuingId === rx._id ? 'Issuing…' : 'Mark Issued'}</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ══ TAB 2 — PENDING QUEUE ══ */}
            {activeTab === 'queue' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <ClockIcon className="w-6 h-6 text-yellow-600" />
                    <h2 className="text-xl font-bold text-gray-900">Awaiting Dispensing</h2>
                    <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2.5 py-1 rounded-full">
                      {queue.length} pending
                    </span>
                  </div>
                  <button onClick={fetchQueue} disabled={queueLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-semibold">
                    <ArrowPathIcon className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {queueLoading ? (
                  <div className="text-center py-12 text-gray-400">
                    <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                    Loading queue…
                  </div>
                ) : queue.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border border-gray-200">
                    <ClockIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-semibold">No prescriptions pending</p>
                    <p className="text-sm mt-1">Prescriptions sent to dispensary will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {queue.map((rx, idx) => (
                      <div key={rx._id} className="border-2 border-yellow-200 bg-yellow-50 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <span className="w-8 h-8 bg-yellow-500 text-white rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-bold text-gray-900">
                                  {rx.patient?.firstName} {rx.patient?.lastName}
                                </span>
                                <span className="text-xs text-gray-500 font-mono bg-white px-2 py-0.5 rounded border border-gray-200">
                                  {rx.patient?.digitalHealthCardId || '—'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mb-1">
                                Dr. {rx.doctor?.firstName} {rx.doctor?.lastName} · {rx.prescriptionNumber}
                              </p>
                              <p className="text-xs text-gray-500 mb-2">{rx.diagnosis}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {rx.medications.map((m, i) => (
                                  <span key={i} className="text-xs bg-white text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                                    {m.drugName} × {m.quantity}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => handleQuickIssue(rx)} disabled={issuingId === rx._id}
                            className="shrink-0 flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-60 text-sm font-semibold shadow-sm">
                            {issuingId === rx._id
                              ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
                              : <CheckCircleIcon className="w-4 h-4" />}
                            <span>{issuingId === rx._id ? 'Issuing…' : 'Mark Issued'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══ TAB 3 — HISTORY ══ */}
            {activeTab === 'history' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <ClipboardDocumentListIcon className="w-6 h-6 text-gray-500" />
                    <h2 className="text-xl font-bold text-gray-900">Dispense History</h2>
                  </div>
                  <button onClick={fetchHistory} disabled={historyLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-semibold">
                    <ArrowPathIcon className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {historyLoading ? (
                  <div className="text-center py-12 text-gray-400">
                    <ArrowPathIcon className="w-8 h-8 animate-spin mx-auto mb-2" />
                    Loading history…
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border border-gray-200">
                    <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-semibold">No dispense records yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map(record => (
                      <div key={record._id} className="border border-gray-200 rounded-xl p-4 bg-white hover:border-teal-200 transition-all">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-bold text-gray-900 text-sm">
                                {record.patient?.firstName} {record.patient?.lastName}
                              </span>
                              <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">
                                {record.patient?.digitalHealthCardId || '—'}
                              </span>
                              <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
                                Dispensed
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-1">
                              Rx: {record.prescription?.prescriptionNumber || '—'} ·
                              Dr. {record.prescription?.doctor?.firstName} {record.prescription?.doctor?.lastName}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mb-1">
                              {record.itemsDispensed.map((it, i) => (
                                <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                                  {it.drugName} × {it.quantity}
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-gray-400">
                              Issued by {record.dispensedBy?.firstName} {record.dispensedBy?.lastName} · {fmtDateTime(record.dispensedAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DispensaryDashboard;
