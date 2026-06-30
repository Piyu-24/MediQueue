import React, { useState, useEffect } from 'react';
import {
  DocumentTextIcon,
  EyeIcon,
  CalendarIcon,
  UserIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  HeartIcon,
  BeakerIcon,
  CameraIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClipboardDocumentListIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
import { medicalRecordsAPI, documentAPI } from '../../services/api';
import toast from 'react-hot-toast';

const MedicalRecords = () => {
  const { user } = useAuth();

  const SERVER_BASE = process.env.REACT_APP_API_URL
    ? process.env.REACT_APP_API_URL.replace('/api', '')
    : 'http://localhost:5000';

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAllDocumentsModal, setShowAllDocumentsModal] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    category: 'lab-report',
    file: null,
    previewUrl: null
  });

  useEffect(() => {
    fetchMedicalRecords();
    fetchUploadedDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    filterRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, selectedCategory, searchTerm]);

  const fetchMedicalRecords = async () => {
    try {
      setLoading(true);
      const response = await medicalRecordsAPI.getRecords();
      if (response.data.success) {
        const recordsList = response.data.data.records || [];
        setRecords(recordsList);
        setFilteredRecords(recordsList);
      }
    } catch (error) {
      console.error('Error fetching medical records:', error);
      toast.error('Failed to load medical records');
    } finally {
      setLoading(false);
    }
  };

  const fetchUploadedDocuments = async () => {
    if (!user?.id && !user?._id) return;
    try {
      setLoadingDocuments(true);
      const patientId = user.id || user._id;
      const response = await documentAPI.getPatientDocuments(patientId);
      if (response.data.success && response.data.data) {
        setUploadedDocuments(response.data.data.documents || []);
      } else {
        setUploadedDocuments([]);
      }
    } catch (error) {
      if (error.response) {
        toast.error('Failed to load uploaded documents');
      }
    } finally {
      setLoadingDocuments(false);
    }
  };

  const filterRecords = () => {
    let filtered = records;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(record => record.recordType === selectedCategory);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(record =>
        record.title?.toLowerCase().includes(term) ||
        record.diagnosis?.primary?.toLowerCase().includes(term) ||
        record.description?.toLowerCase().includes(term) ||
        record.recordType?.toLowerCase().includes(term) ||
        record.doctor?.firstName?.toLowerCase().includes(term) ||
        record.doctor?.lastName?.toLowerCase().includes(term)
      );
    }

    setFilteredRecords(filtered);
  };

  const handleViewRecord = (record) => {
    setSelectedRecord(record);
    setShowModal(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('all');
  };

  const handleUploadDocument = async () => {
    if (!uploadForm.title.trim()) {
      toast.error('Please enter a document title');
      return;
    }
    if (!uploadForm.file) {
      toast.error('Please select a file to upload');
      return;
    }
    try {
      setUploadingDocument(true);
      const formData = new FormData();
      formData.append('document', uploadForm.file);
      formData.append('title', uploadForm.title);
      formData.append('description', uploadForm.description);
      formData.append('documentType', uploadForm.category);

      const response = await documentAPI.uploadDocument(formData);
      if (response.data.success) {
        toast.success('Document uploaded successfully!');
        setShowUploadModal(false);
        if (uploadForm.previewUrl) {
          URL.revokeObjectURL(uploadForm.previewUrl);
        }
        setUploadForm({ title: '', description: '', category: 'lab-report', file: null, previewUrl: null });
        fetchUploadedDocuments();
      } else {
        throw new Error(response.data.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error(error.response?.data?.message || error.message || 'Failed to upload document');
    } finally {
      setUploadingDocument(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only PDF, JPEG, and PNG files are allowed');
      return;
    }
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setUploadForm({ ...uploadForm, file, previewUrl });
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const getCategoryIcon = (type) => {
    const icons = {
      diagnosis: ChartBarIcon,
      prescription: DocumentTextIcon,
      'lab-result': BeakerIcon,
      imaging: CameraIcon,
      surgery: HeartIcon,
      vaccination: HeartIcon,
      consultation: UserIcon,
      'treatment-plan': ClipboardDocumentListIcon,
      other: DocumentTextIcon
    };
    return icons[type] || DocumentTextIcon;
  };

  const getCategoryColor = (type) => {
    const colors = {
      diagnosis: 'bg-blue-100 text-blue-600',
      prescription: 'bg-green-100 text-green-600',
      'lab-result': 'bg-teal-100 text-teal-600',
      imaging: 'bg-yellow-100 text-yellow-600',
      surgery: 'bg-red-100 text-red-600',
      vaccination: 'bg-purple-100 text-purple-600',
      consultation: 'bg-pink-100 text-pink-600',
      'treatment-plan': 'bg-indigo-100 text-indigo-600',
      other: 'bg-gray-100 text-gray-600'
    };
    return colors[type] || 'bg-gray-100 text-gray-600';
  };

  const getPriorityBadge = (priority) => {
    const badges = {
      urgent: 'bg-red-100 text-red-700',
      high: 'bg-orange-100 text-orange-700',
      normal: 'bg-blue-100 text-blue-700',
      low: 'bg-gray-100 text-gray-700'
    };
    return badges[priority] || badges.normal;
  };

  // All recordType values supported by the backend schema
  const categories = [
    { value: 'all', label: 'All Records', icon: DocumentTextIcon },
    { value: 'consultation', label: 'Consultations', icon: UserIcon },
    { value: 'diagnosis', label: 'Diagnosis', icon: ChartBarIcon },
    { value: 'prescription', label: 'Prescriptions', icon: DocumentTextIcon },
    { value: 'treatment-plan', label: 'Treatment Plans', icon: ClipboardDocumentListIcon },
    { value: 'lab-result', label: 'Lab Results', icon: BeakerIcon },
    { value: 'imaging', label: 'Imaging', icon: CameraIcon },
    { value: 'surgery', label: 'Surgery', icon: HeartIcon },
    { value: 'vaccination', label: 'Vaccinations', icon: HeartIcon },
    { value: 'other', label: 'Other', icon: DocumentTextIcon }
  ];

  const consultationCount = records.filter(r => r.recordType === 'consultation').length;
  const withPrescriptionsCount = records.filter(r => r.prescriptions?.length > 0).length;
  const isFiltered = selectedCategory !== 'all' || searchTerm.trim() !== '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold mb-2">Medical Records</h1>
                <p className="text-blue-100 text-lg">View your health history from hospital visits</p>
              </div>
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center space-x-2 px-6 py-3 bg-white text-blue-600 rounded-xl hover:bg-blue-50 transition-all duration-200 transform hover:scale-105 shadow-lg font-semibold"
              >
                <CloudArrowUpIcon className="w-5 h-5" />
                <span>Upload Document</span>
              </button>
            </div>
          </div>
        </div>

        {/* Stats — counts derived from actual backend data */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{records.length}</p>
                <p className="text-sm text-gray-600">Total Records</p>
              </div>
              <DocumentTextIcon className="w-10 h-10 text-blue-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{consultationCount}</p>
                <p className="text-sm text-gray-600">Consultations</p>
              </div>
              <UserIcon className="w-10 h-10 text-pink-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{withPrescriptionsCount}</p>
                <p className="text-sm text-gray-600">With Prescriptions</p>
              </div>
              <BeakerIcon className="w-10 h-10 text-teal-500" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{uploadedDocuments.length}</p>
                <p className="text-sm text-gray-600">My Documents</p>
              </div>
              <CloudArrowUpIcon className="w-10 h-10 text-indigo-500" />
            </div>
          </div>
        </div>

        {/* Uploaded Documents Section */}
        <div className="bg-white rounded-2xl shadow-xl mb-8">
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <CloudArrowUpIcon className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">
                  My Uploaded Documents ({uploadedDocuments.length})
                </h2>
              </div>
              {uploadedDocuments.length > 2 && (
                <button
                  onClick={() => setShowAllDocumentsModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold shadow-md"
                >
                  <EyeIcon className="w-4 h-4" />
                  <span>View All ({uploadedDocuments.length})</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-6">
            {loadingDocuments ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-600 mt-4">Loading documents...</p>
              </div>
            ) : uploadedDocuments.length > 0 ? (
              <div className="space-y-4">
                {uploadedDocuments.slice(0, 2).map((doc) => (
                  <div key={doc._id} className="border-2 border-gray-200 rounded-xl p-6 hover:shadow-md transition-all duration-300">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <DocumentTextIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-1">{doc.title}</h3>
                          {doc.description && (
                            <p className="text-gray-600 text-sm mb-3">{doc.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                            <div className="flex items-center space-x-1">
                              <CalendarIcon className="w-4 h-4" />
                              <span>{formatDate(doc.uploadedAt || doc.createdAt)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <DocumentTextIcon className="w-4 h-4" />
                              <span>{doc.documentType?.replace(/-/g, ' ').toUpperCase() || 'N/A'}</span>
                            </div>
                            <span className="font-medium">{(doc.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                      </div>
                      {doc.fileUrl && (
                        <a
                          href={`${SERVER_BASE}${doc.fileUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Document"
                        >
                          <EyeIcon className="w-5 h-5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <CloudArrowUpIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Documents Uploaded Yet</h3>
                <p className="text-gray-600 mb-4">Upload your own medical documents to keep them alongside your records.</p>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                >
                  Upload Document
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Records List */}
        <div className="bg-white rounded-2xl shadow-xl">
          {/* Search and Filter — placed directly above the records list */}
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Your Medical Records
              {isFiltered
                ? ` — ${filteredRecords.length} of ${records.length} shown`
                : ` (${records.length})`}
            </h2>

            {/* Search */}
            <div className="relative mb-4">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by title, diagnosis, description, or doctor name..."
                className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap gap-2">
              {categories.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setSelectedCategory(value)}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg border-2 transition-all duration-200 text-sm ${
                    selectedCategory === value
                      ? 'border-blue-600 bg-blue-50 text-blue-600 font-semibold'
                      : 'border-gray-200 hover:border-blue-300 text-gray-600'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                  {value !== 'all' && (
                    <span className={`ml-1 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                      selectedCategory === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {records.filter(r => r.recordType === value).length}
                    </span>
                  )}
                </button>
              ))}
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg border-2 border-red-200 text-red-600 hover:bg-red-50 transition-all duration-200 text-sm"
                >
                  <XCircleIcon className="w-4 h-4" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-600 mt-4">Loading records...</p>
              </div>
            ) : filteredRecords.length > 0 ? (
              <div className="space-y-4">
                {filteredRecords.map((record) => {
                  const Icon = getCategoryIcon(record.recordType);
                  return (
                    <div
                      key={record._id}
                      className="border border-gray-200 rounded-xl p-6 hover:shadow-md transition-all duration-300"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start space-x-4 flex-1">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${getCategoryColor(record.recordType)}`}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-1">
                              <h3 className="text-lg font-semibold text-gray-900">{record.title}</h3>
                              {record.priority && record.priority !== 'normal' && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityBadge(record.priority)}`}>
                                  {record.priority}
                                </span>
                              )}
                            </div>
                            <p className="text-gray-600 text-sm mb-3">
                              {record.diagnosis?.primary || record.description || 'No description available'}
                            </p>
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                              <div className="flex items-center space-x-1">
                                <CalendarIcon className="w-4 h-4" />
                                <span>{formatDate(record.createdAt)}</span>
                              </div>
                              {record.doctor && (
                                <div className="flex items-center space-x-1">
                                  <UserIcon className="w-4 h-4" />
                                  <span>Dr. {record.doctor.firstName} {record.doctor.lastName}</span>
                                </div>
                              )}
                              <span className="capitalize px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                                {record.recordType?.replace(/-/g, ' ')}
                              </span>
                              {record.prescriptions?.length > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 text-xs font-medium">
                                  {record.prescriptions.length} prescription{record.prescriptions.length > 1 ? 's' : ''}
                                </span>
                              )}
                              {record.documents?.length > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                                  {record.documents.length} attachment{record.documents.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleViewRecord(record)}
                          className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 flex-shrink-0"
                        >
                          <EyeIcon className="w-4 h-4" />
                          <span>View</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                {isFiltered ? (
                  <>
                    <p className="text-gray-500 mb-3">No records match your search or filter.</p>
                    <button onClick={clearFilters} className="text-blue-600 hover:text-blue-700 font-medium">
                      Clear filters
                    </button>
                  </>
                ) : (
                  <p className="text-gray-500">No medical records found. Records created by your doctor during visits will appear here.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View Record Modal */}
      {showModal && selectedRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{selectedRecord.title}</h3>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(selectedRecord.recordType)}`}>
                  {selectedRecord.recordType?.replace(/-/g, ' ')}
                </span>
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircleIcon className="w-7 h-7" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Date</p>
                  <p className="font-semibold text-gray-900 mt-0.5">{formatDate(selectedRecord.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Doctor</p>
                  <p className="font-semibold text-gray-900 mt-0.5">
                    {selectedRecord.doctor
                      ? `Dr. ${selectedRecord.doctor.firstName} ${selectedRecord.doctor.lastName}`
                      : '—'}
                  </p>
                </div>
                {selectedRecord.priority && selectedRecord.priority !== 'normal' && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Priority</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityBadge(selectedRecord.priority)}`}>
                      {selectedRecord.priority}
                    </span>
                  </div>
                )}
                {selectedRecord.appointment && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Linked Appointment</p>
                    <p className="font-semibold text-gray-900 mt-0.5 text-sm">
                      {selectedRecord.appointment.appointmentDate
                        ? formatDate(selectedRecord.appointment.appointmentDate)
                        : selectedRecord.appointment._id || '—'}
                    </p>
                  </div>
                )}
              </div>

              {/* Description */}
              {selectedRecord.description && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Description</p>
                  <p className="text-gray-900">{selectedRecord.description}</p>
                </div>
              )}

              {/* Diagnosis */}
              {selectedRecord.diagnosis?.primary && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Primary Diagnosis</p>
                  <p className="text-gray-900 font-medium">{selectedRecord.diagnosis.primary}</p>
                  {selectedRecord.diagnosis.severity && (
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
                      selectedRecord.diagnosis.severity === 'critical' ? 'bg-red-100 text-red-700' :
                      selectedRecord.diagnosis.severity === 'severe' ? 'bg-orange-100 text-orange-700' :
                      selectedRecord.diagnosis.severity === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {selectedRecord.diagnosis.severity}
                    </span>
                  )}
                  {selectedRecord.diagnosis.secondary?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 mb-1">Secondary Diagnoses</p>
                      <ul className="list-disc list-inside text-gray-900 text-sm space-y-0.5">
                        {selectedRecord.diagnosis.secondary.map((sec, idx) => (
                          <li key={idx}>{sec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Treatment Plan */}
              {(selectedRecord.treatmentPlan || selectedRecord.recordType === 'treatment-plan') && (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <ClipboardDocumentListIcon className="w-5 h-5 text-blue-700" />
                    <p className="text-sm font-bold text-blue-900">Treatment Plan</p>
                  </div>
                  <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap bg-white rounded-lg p-3 border border-blue-200">
                    {selectedRecord.treatmentPlan || selectedRecord.description}
                  </div>
                </div>
              )}

              {/* Lab Tests Ordered */}
              {selectedRecord.labTests?.length > 0 && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-orange-900 mb-2">
                    Lab Tests Ordered ({selectedRecord.labTests.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedRecord.labTests.map((test, i) => (
                      <span key={i} className="px-3 py-1.5 bg-white border border-orange-300 text-orange-800 rounded-lg text-sm font-medium">
                        {test.testName || test}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Prescriptions */}
              {selectedRecord.prescriptions?.length > 0 && (
                <div className="bg-teal-50 border-2 border-teal-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-teal-900 mb-3">
                    Prescriptions ({selectedRecord.prescriptions.length})
                  </p>
                  <div className="space-y-2">
                    {selectedRecord.prescriptions.map((rx, index) => (
                      <div key={index} className="bg-white border border-teal-200 rounded-lg p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900 mb-1">{rx.medication}</p>
                            <div className="text-sm text-gray-700 space-y-0.5">
                              {rx.dosage && <p><span className="font-medium">Dosage:</span> {rx.dosage}</p>}
                              {rx.frequency && <p><span className="font-medium">Frequency:</span> {rx.frequency}</p>}
                              {rx.duration && <p><span className="font-medium">Duration:</span> {rx.duration}</p>}
                              {rx.instructions && <p><span className="font-medium">Instructions:</span> {rx.instructions}</p>}
                            </div>
                          </div>
                          {rx.refills !== undefined && rx.refills !== null && (
                            <span className="ml-2 px-2 py-1 bg-teal-100 text-teal-700 text-xs rounded-full font-semibold flex-shrink-0">
                              {rx.refills} refill{rx.refills !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedRecord.notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-900">{selectedRecord.notes}</p>
                </div>
              )}

              {/* Observations */}
              {selectedRecord.observations && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">Observations</p>
                  <p className="text-gray-900">{selectedRecord.observations}</p>
                </div>
              )}

              {/* Follow-up */}
              {selectedRecord.followUp?.required && selectedRecord.followUp?.date && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-blue-900 mb-1">Follow-up Required</p>
                  <p className="text-sm text-blue-700">Date: {formatDate(selectedRecord.followUp.date)}</p>
                  {selectedRecord.followUp.instructions && (
                    <p className="text-sm text-blue-700 mt-1">{selectedRecord.followUp.instructions}</p>
                  )}
                </div>
              )}

              {/* Attached Documents (uploaded by staff) */}
              {selectedRecord.documents?.length > 0 && (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-green-900 mb-1">
                    Attached Documents ({selectedRecord.documents.length})
                  </p>
                  <p className="text-xs text-green-700 mb-3">
                    Uploaded by hospital staff to this record
                  </p>
                  <div className="space-y-2">
                    {selectedRecord.documents.map((doc, index) => (
                      <a
                        key={index}
                        href={`${SERVER_BASE}${doc.fileUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white border border-green-200 rounded-lg hover:bg-green-50 hover:shadow-md transition-all group"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <DocumentTextIcon className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{doc.fileName}</p>
                            <div className="flex items-center space-x-3 text-xs text-gray-500 mt-0.5">
                              {doc.fileSize && <span>{(doc.fileSize / 1024).toFixed(2)} KB</span>}
                              {doc.uploadedAt && <><span>•</span><span>{new Date(doc.uploadedAt).toLocaleDateString()}</span></>}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-green-600 font-medium group-hover:underline flex-shrink-0">
                          View / Download
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-6 flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between rounded-t-2xl">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">Upload Medical Document</h3>
                <p className="text-sm text-gray-600 mt-1">Documents are saved directly to your records</p>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="text-gray-400 hover:text-gray-600">
                <XCircleIcon className="w-7 h-7" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                <div className="flex items-start space-x-3">
                  <CheckCircleIcon className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-blue-900 mb-1">Upload Information</h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Documents appear immediately in your uploaded documents list</li>
                      <li>• Supported formats: PDF, JPEG, PNG (Max 10MB)</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Document Title *</label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  placeholder="e.g., Blood Test Results - December 2024"
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Document Category *</label>
                <select
                  value={uploadForm.category}
                  onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="lab-report">Lab Report</option>
                  <option value="blood-test">Blood Test</option>
                  <option value="x-ray">X-Ray</option>
                  <option value="mri-scan">MRI Scan</option>
                  <option value="ct-scan">CT Scan</option>
                  <option value="ultrasound">Ultrasound</option>
                  <option value="ecg">ECG</option>
                  <option value="prescription">Prescription</option>
                  <option value="vaccination-record">Vaccination Record</option>
                  <option value="discharge-summary">Discharge Summary</option>
                  <option value="medical-certificate">Medical Certificate</option>
                  <option value="insurance-card">Insurance Card</option>
                  <option value="id-proof">ID Proof</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Description (Optional)</label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  rows={3}
                  placeholder="Add any additional details about this document..."
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Upload File *</label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-500 transition-colors">
                  <input
                    type="file"
                    onChange={handleFileSelect}
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    {uploadForm.file ? (
                      <div className="space-y-4">
                        {uploadForm.previewUrl ? (
                          <div className="mx-auto w-48 h-48 border-2 border-gray-200 rounded-lg overflow-hidden">
                            <img src={uploadForm.previewUrl} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="mx-auto w-48 h-32 border-2 border-gray-200 rounded-lg flex items-center justify-center bg-gray-50">
                            <div className="text-center">
                              <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                              <p className="text-xs text-gray-500">PDF Document</p>
                            </div>
                          </div>
                        )}
                        <div className="text-center">
                          <p className="text-sm font-semibold text-green-600 mb-1">{uploadForm.file.name}</p>
                          <p className="text-xs text-gray-500 mb-2">
                            {(uploadForm.file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (uploadForm.previewUrl) URL.revokeObjectURL(uploadForm.previewUrl);
                              setUploadForm({ ...uploadForm, file: null, previewUrl: null });
                            }}
                            className="px-3 py-1 text-sm text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Remove file
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <CloudArrowUpIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                        <p className="text-sm text-gray-600 mb-1">
                          <span className="text-blue-600 font-semibold">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-gray-500">PDF, JPEG, PNG up to 10MB</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-6 flex justify-end space-x-3 rounded-b-2xl">
              <button
                onClick={() => setShowUploadModal(false)}
                disabled={uploadingDocument}
                className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-100 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadDocument}
                disabled={uploadingDocument || !uploadForm.title.trim() || !uploadForm.file}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex items-center space-x-2 font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {uploadingDocument ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <CloudArrowUpIcon className="w-5 h-5" />
                    <span>Upload Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View All Documents Modal */}
      {showAllDocumentsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-gray-50 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CloudArrowUpIcon className="w-6 h-6 text-blue-600" />
                  <h2 className="text-2xl font-bold text-gray-900">
                    All Uploaded Documents ({uploadedDocuments.length})
                  </h2>
                </div>
                <button onClick={() => setShowAllDocumentsModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <XCircleIcon className="w-8 h-8" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {uploadedDocuments.map((doc) => (
                  <div key={doc._id} className="border-2 border-gray-200 rounded-xl p-6 hover:shadow-md transition-all duration-300">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <DocumentTextIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-1">{doc.title}</h3>
                          {doc.description && (
                            <p className="text-gray-600 text-sm mb-3">{doc.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                            <div className="flex items-center space-x-1">
                              <CalendarIcon className="w-4 h-4" />
                              <span>{formatDate(doc.uploadedAt || doc.createdAt)}</span>
                            </div>
                            <span>{doc.documentType?.replace(/-/g, ' ').toUpperCase() || 'N/A'}</span>
                            <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                      </div>
                      {doc.fileUrl && (
                        <a
                          href={`${SERVER_BASE}${doc.fileUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Document"
                        >
                          <EyeIcon className="w-5 h-5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex justify-end">
              <button
                onClick={() => setShowAllDocumentsModal(false)}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MedicalRecords;
