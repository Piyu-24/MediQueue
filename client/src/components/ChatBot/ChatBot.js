import React, { useState, useEffect, useRef } from 'react';
import {
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  UserIcon,
  ComputerDesktopIcon,
  HeartIcon,
  CalendarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../../hooks/useAuth';
// eslint-disable-next-line no-unused-vars
import { chatbotAPI } from '../../services/api';
import toast from 'react-hot-toast';

const ChatBot = () => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Initialize chatbot with welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        type: 'bot',
        message: `Hello ${user?.firstName || 'there'}!  I'm MediQueue Assistant, your healthcare companion. How can I help you today?`,
        timestamp: new Date(),
        suggestions: [
          'Book an appointment',
          'Check symptoms',
          'View my records',
          'Emergency assistance'
        ]
      };
      setMessages([welcomeMessage]);
    }
  }, [isOpen, user?.firstName, messages.length]);

  // Auto scroll to bottom
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Healthcare-specific conditional logic
  const processMessage = async (message) => {
    const lowerMessage = message.toLowerCase();
    
    // Emergency keywords
    const emergencyKeywords = ['emergency', 'urgent', 'chest pain', 'heart attack', 'stroke', 'bleeding', 'unconscious', 'accident', 'severe pain'];
    const isEmergency = emergencyKeywords.some(keyword => lowerMessage.includes(keyword));

    if (isEmergency) {
      return {
        type: 'emergency',
        message: ' **EMERGENCY DETECTED** \n\nIf this is a medical emergency, please:\n• Call 911 immediately\n• Go to the nearest emergency room\n• Contact emergency services\n\nFor non-emergency urgent care, I can help you find the nearest urgent care facility or schedule an urgent appointment.',
        suggestions: ['Find emergency room', 'Call ambulance', 'Urgent appointment', 'Contact doctor'],
        priority: 'high'
      };
    }

    // Appointment-related queries
    const appointmentKeywords = ['appointment', 'book', 'schedule', 'doctor', 'visit', 'consultation'];
    if (appointmentKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        type: 'appointment',
        message: ' I can help you with appointments!\n\nWhat would you like to do?\n• Book a new appointment\n• View upcoming appointments\n• Cancel/reschedule existing appointment\n• Find available doctors',
        suggestions: ['Book appointment', 'View appointments', 'Find doctors', 'Reschedule'],
        actions: [
          { label: 'Book Now', action: 'navigate', path: '/appointments/book' },
          { label: 'View Schedule', action: 'navigate', path: '/dashboard' }
        ]
      };
    }

    // Symptom checking
    const symptomKeywords = ['symptom', 'pain', 'fever', 'headache', 'cough', 'sick', 'feel', 'hurt', 'ache'];
    if (symptomKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        type: 'symptom',
        message: ' I understand you\'re experiencing symptoms.\n\n**Important:** I can provide general information, but cannot diagnose medical conditions.\n\nFor proper medical advice, please:\n• Consult with a healthcare professional\n• Book an appointment with a doctor\n• Visit urgent care if symptoms are severe',
        suggestions: ['Book doctor appointment', 'Find urgent care', 'Symptom tracker', 'Health tips'],
        disclaimer: 'This is not medical advice. Please consult a healthcare professional.'
      };
    }

    // Medical records
    const recordsKeywords = ['record', 'history', 'report', 'document', 'test result', 'lab'];
    if (recordsKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        type: 'records',
        message: ' I can help you access your medical information!\n\n• View medical records\n• Download reports\n• Upload documents\n• Share with doctors\n• Health card information',
        suggestions: ['View records', 'Download reports', 'Upload documents', 'Health card'],
        actions: [
          { label: 'Medical Records', action: 'navigate', path: '/records' },
          { label: 'Documents', action: 'tab', tab: 'documents' }
        ]
      };
    }

    // Health card queries
    const healthCardKeywords = ['health card', 'qr code', 'digital card', 'id card', 'identification'];
    if (healthCardKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        type: 'healthcard',
        message: ' Your Digital Health Card contains:\n\n• QR code for quick identification\n• Medical information\n• Emergency contacts\n• Insurance details\n• Access history',
        suggestions: ['View health card', 'Update info', 'QR code help', 'Emergency contacts'],
        actions: [
          { label: 'View Health Card', action: 'tab', tab: 'health-card' }
        ]
      };
    }

    // General health tips
    const healthTipsKeywords = ['health', 'wellness', 'tips', 'advice', 'healthy', 'fitness'];
    if (healthTipsKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        type: 'health_tips',
        message: ' Here are some general health tips:\n\n• Stay hydrated (8 glasses of water daily)\n• Get 7-9 hours of sleep\n• Exercise regularly (30 min/day)\n• Eat balanced meals\n• Regular health checkups\n• Manage stress levels',
        suggestions: ['Nutrition tips', 'Exercise guide', 'Sleep hygiene', 'Stress management']
      };
    }

    // Default response with AI-like processing
    return {
      type: 'general',
      message: `I understand you're asking about "${message}". Let me help you with that!\n\nI can assist you with:\n• Booking appointments\n• Medical records and documents\n• Health card information\n• General health guidance\n\nWhat specific area would you like help with?`,
      suggestions: ['Book appointment', 'View records', 'Health card', 'Contact support']
    };
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      message: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsTyping(true);
    setIsLoading(true);

    try {
      // Simulate AI processing delay
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      const response = await processMessage(inputMessage);
      
      const botMessage = {
        id: Date.now() + 1,
        type: 'bot',
        ...response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Chatbot error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        message: 'I apologize, but I\'m having trouble processing your request right now. Please try again or contact our support team for assistance.',
        timestamp: new Date(),
        suggestions: ['Try again', 'Contact support', 'Call hospital']
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setInputMessage(suggestion);
    handleSendMessage();
  };

  const handleActionClick = (action) => {
    if (action.action === 'navigate') {
      window.location.href = action.path;
    } else if (action.action === 'tab') {
      // Trigger tab change in parent component
      const event = new CustomEvent('chatbotTabChange', { detail: action.tab });
      window.dispatchEvent(event);
      toast.success(`Switched to ${action.tab} tab`);
    }
  };

  const getMessageIcon = (type) => {
    switch (type) {
      case 'emergency': return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      case 'appointment': return <CalendarIcon className="w-5 h-5 text-blue-500" />;
      case 'symptom': return <HeartIcon className="w-5 h-5 text-teal-500" />;
      case 'records': return <DocumentTextIcon className="w-5 h-5 text-blue-500" />;
      case 'healthcard': return <UserIcon className="w-5 h-5 text-orange-500" />;
      case 'health_tips': return <CheckCircleIcon className="w-5 h-5 text-teal-500" />;
      default: return <ComputerDesktopIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  const formatMessage = (message) => {
    // Convert markdown-like formatting to JSX
    return message.split('\n').map((line, index) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return <div key={index} className="font-bold text-gray-900 mb-1">{line.slice(2, -2)}</div>;
      }
      if (line.startsWith('• ')) {
        return <div key={index} className="ml-4 text-gray-700">• {line.slice(2)}</div>;
      }
      return <div key={index} className="text-gray-700">{line}</div>;
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 z-50"
      >
        <ChatBubbleLeftRightIcon className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 rounded-t-2xl flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <HeartIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold">MediQueue Assistant</h3>
            <p className="text-xs text-blue-100">Healthcare Support</p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-white/80 hover:text-white transition-colors"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${
              msg.type === 'user' 
                ? 'bg-blue-600 text-white rounded-l-2xl rounded-tr-2xl' 
                : 'bg-gray-100 text-gray-800 rounded-r-2xl rounded-tl-2xl'
            } p-3 shadow-sm`}>
              {msg.type === 'bot' && (
                <div className="flex items-center space-x-2 mb-2">
                  {getMessageIcon(msg.type)}
                  <span className="text-xs font-medium text-gray-600">
                    {msg.type === 'emergency' ? 'EMERGENCY' : 'MediQueue Assistant'}
                  </span>
                </div>
              )}
              
              <div className="text-sm">
                {typeof msg.message === 'string' ? formatMessage(msg.message) : msg.message}
              </div>

              {msg.disclaimer && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                   {msg.disclaimer}
                </div>
              )}

              {msg.suggestions && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {msg.suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full hover:bg-blue-100 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {msg.actions && (
                <div className="mt-3 space-y-1">
                  {msg.actions.map((action, index) => (
                    <button
                      key={index}
                      onClick={() => handleActionClick(action)}
                      className="block w-full text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="text-xs text-gray-400 mt-2">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-r-2xl rounded-tl-2xl p-3 shadow-sm">
              <div className="flex items-center space-x-2">
                <ComputerDesktopIcon className="w-4 h-4 text-gray-500" />
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask me anything about your healthcare..."
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white p-2 rounded-full transition-colors"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2 text-center">
          Powered by MediQueue AI • Healthcare Assistant
        </div>
      </div>
    </div>
  );
};

export default ChatBot;
