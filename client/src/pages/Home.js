import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  CalendarIcon,
  ShieldCheckIcon,
  PhoneIcon,
  ClockIcon,
  MapPinIcon,
  ChevronRightIcon,
  HeartIcon,
  CheckCircleIcon,
  QrCodeIcon,
  QueueListIcon
} from '@heroicons/react/24/outline';

const Home = () => {
  const { user } = useAuth();

  // Quick actions aligned with MediQueue SRS
  const quickActions = [
    {
      title: 'Book Appointment',
      description: 'Schedule your OPD visit in advance',
      icon: CalendarIcon,
      link: user ? '/dashboard?tab=book-appointment' : '/register',
      color: 'bg-blue-600'
    },
    {
      title: 'View Queue Status',
      description: 'Check live queue and estimated wait times',
      icon: QueueListIcon,
      link: user ? '/dashboard' : '/login',
      color: 'bg-teal-600'
    },
    {
      title: 'QR Health Card',
      description: 'Access your digital patient identity',
      icon: QrCodeIcon,
      link: user ? '/dashboard?tab=health-card' : '/login',
      color: 'bg-green-700'
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-b from-blue-50 to-white pt-20 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="mb-6">
              <img src="/logo.jpg" alt="MediQueue Logo" className="h-28 mx-auto object-contain" />
            </div>

            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
              Smarter Queues,
              <br />
              <span className="text-blue-600">Better Healthcare</span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 mb-10 max-w-4xl mx-auto leading-relaxed">
              MediQueue streamlines OPD workflows with QR-based patient identification,
              real-time queue management, and digital appointment scheduling,
              reducing wait times and improving care for every patient.
            </p>

            {/* Quick Actions */}
            <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12">
              {quickActions.map((action, index) => (
                <Link
                  key={index}
                  to={action.link}
                  className="group bg-white rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-100"
                >
                  {/* Render icon if available */}
                  {action.icon && (
                    <div
                      className={`inline-flex p-3 rounded-lg ${action.color} text-white mb-4 group-hover:scale-110 transition-transform duration-200`}
                    >
                      <action.icon className="h-6 w-6" />
                    </div>
                  )}

                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{action.title}</h3>
                  <p className="text-gray-600 text-sm mb-3">{action.description}</p>
                  <div className="flex items-center text-blue-600 text-sm font-medium">
                    Get Started <ChevronRightIcon className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform duration-200" />
                  </div>
                </Link>
              ))}
            </div>

            {/* Primary CTA */}
            {!user && (
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  to="/register"
                  className="btn-primary btn-lg"
                >
                  Register Now
                </Link>
                <Link
                  to="/login"
                  className="btn-outline btn-lg"
                >
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="py-12 bg-gray-50 border-y border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-center items-center gap-8 text-gray-500">
            <div className="flex items-center space-x-2">
              <ShieldCheckIcon className="h-5 w-5" />
              <span className="text-sm font-medium">Secure & Auditable</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircleIcon className="h-5 w-5" />
              <span className="text-sm font-medium">QR-Based Identity</span>
            </div>
            <div className="flex items-center space-x-2">
              <ClockIcon className="h-5 w-5" />
              <span className="text-sm font-medium">Real-Time Queue Updates</span>
            </div>
            <div className="flex items-center space-x-2">
              <HeartIcon className="h-5 w-5" />
              <span className="text-sm font-medium">Patient-Centered Care</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-block px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-full mb-4">
              Key Features
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              End-to-End OPD Management
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              From patient registration to consultation completion, MediQueue covers
              every step of the outpatient journey
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                title: 'QR Health Card',
                description: 'Unique scannable patient identity with digital health card for fast check-in at any counter',
                image: '/feature-qr.jpg',
              },
              {
                title: 'Queue Management',
                description: 'Real-time FIFO queue with triage overrides, ETA computation, and live status broadcasts',
                image: '/feature-queue.jpg',
              },
              {
                title: 'Appointment Booking',
                description: 'Schedule OPD appointments online with preferred doctor and time slot selection',
                image: '/feature-booking.jpg',
              },
              {
                title: 'Staff Consoles',
                description: 'Role-based dashboards for receptionists, doctors, and administrators with audit trails',
                image: '/feature-staff.jpg',
              }
            ].map((service, index) => (
              <div key={index} className="group relative bg-gray-50 rounded-2xl p-8 hover:bg-white hover:shadow-xl transition-all duration-300 border border-transparent hover:border-gray-200">
                <div className="text-center">
                  <div className="w-full h-44 rounded-2xl overflow-hidden mx-auto mb-6">
                    <img src={service.image} alt={service.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors duration-300">
                    {service.title}
                  </h3>
                  <p className="text-gray-600 leading-relaxed mb-6">{service.description}</p>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 rounded-b-2xl"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 bg-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Built for Public Healthcare</h2>
            <p className="text-xl text-blue-100">Designed to serve OPD environments across Sri Lanka</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold mb-2">≤ 1s</div>
              <div className="text-blue-100">Queue Update Latency</div>
            </div>
            <div>
              <div className="text-4xl font-bold mb-2">≤ 5s</div>
              <div className="text-blue-100">QR Check-in Time</div>
            </div>
            <div>
              <div className="text-4xl font-bold mb-2">300+</div>
              <div className="text-blue-100">Concurrent Users</div>
            </div>
            <div>
              <div className="text-4xl font-bold mb-2">24/7</div>
              <div className="text-blue-100">System Availability</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-block px-4 py-2 bg-green-50 text-green-700 text-sm font-medium rounded-full mb-4">
              How It Works
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">Your OPD Visit, Simplified</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              Whether you book online or walk in, MediQueue ensures a smooth and transparent
              experience from registration to consultation.
            </p>
          </div>

          <div className="relative">
            {/* Connection Lines */}
            <div className="hidden md:block absolute top-24 left-1/2 transform -translate-x-1/2 w-full max-w-4xl">
              <div className="flex justify-between items-center px-16">
                <div className="w-1/3 h-0.5 bg-gradient-to-r from-blue-200 to-teal-300"></div>
                <div className="w-1/3 h-0.5 bg-gradient-to-r from-teal-300 to-green-200"></div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-12 relative z-10">
              {[
                {
                  step: '1',
                  title: 'Register & Get QR Card',
                  description: 'Register online or at the reception desk. Receive your unique QR Health Card for identification across all visits.',
                  image: '/step-register.jpg'
                },
                {
                  step: '2',
                  title: 'Book or Walk In',
                  description: 'Schedule your appointment in advance or walk in to the OPD. Check in using your QR code at the counter.',
                  image: '/step-book.jpg'
                },
                {
                  step: '3',
                  title: 'Queue & Consult',
                  description: 'Track your queue position in real-time. Get notified when it\'s your turn and proceed to the assigned room.',
                  image: '/step-consult.jpg'
                }
              ].map((item, index) => (
                <div key={index} className="group text-center">
                  {/* Image */}
                  <div className="w-full h-48 rounded-2xl overflow-hidden shadow-md mb-6">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>

                  {/* Step Number */}
                  <div className="w-14 h-14 mx-auto mb-4 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold shadow-md">
                    {item.step}
                  </div>

                  {/* Text */}
                  <h3 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>

                  <p className="text-gray-600 leading-relaxed px-6">
                    {item.description}
                  </p>
                </div>

              ))}
            </div>
          </div>

          <div className="text-center mt-16">
            <div className="bg-blue-50 rounded-2xl p-8 max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to get started?</h3>
              <p className="text-gray-600 mb-4">Register today and experience a hassle-free OPD visit</p>
              <Link
                to="/register"
                className="btn-primary btn-lg inline-flex items-center"
              >
                Create Your Account
                <ChevronRightIcon className="h-5 w-5 ml-2" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-24 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <div className="inline-block px-4 py-2 bg-teal-50 text-teal-700 text-sm font-medium rounded-full mb-4">
              Need Assistance?
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">Get in Touch</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              Our support team is here to assist patients, staff, and administrators
              with any queries about MediQueue.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {[
              {
                icon: PhoneIcon,
                title: 'Hospital Helpline',
                description: 'Speak to our OPD support desk for immediate assistance',
                contact: '+94 11 234 5678',
                action: 'Call Now',
                badge: 'OPD Hours'
              },
              {
                icon: ClockIcon,
                title: 'OPD Hours',
                description: 'Visit during regular OPD hours for walk-in consultations',
                contact: 'Mon–Sat: 7:00 AM – 4:00 PM\nSun:  7:00 AM – 12:00 PM',
                action: 'View Schedule',
                badge: 'Regular Hours'
              },
              {
                icon: MapPinIcon,
                title: 'Hospital Location',
                description: 'Visit the outpatient department at our main facility',
                contact: 'Colombo, Sri Lanka',
                action: 'Get Directions',
                badge: 'Main OPD'
              }
            ].map((item, index) => (
              <div key={index} className="group relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 border border-gray-100">
                <div className="text-center">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                      <item.icon className="h-8 w-8 text-blue-600" />
                    </div>
                    <span className="absolute -top-2 -right-2 px-2 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                      {item.badge}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors duration-300">
                    {item.title}
                  </h3>
                  <p className="text-gray-600 leading-relaxed mb-4">{item.description}</p>
                  <div className="text-blue-600 font-semibold mb-6 whitespace-pre-line">
                    {item.contact}
                  </div>
                  <button className="btn-primary w-full flex items-center justify-center">
                    {item.action}
                    <ChevronRightIcon className="h-4 w-4 ml-2" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-16 bg-blue-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold mb-4">
            Ready for a Smoother OPD Experience?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join MediQueue and say goodbye to long waiting times and manual token systems
          </p>

          {!user ? (
            <Link
              to="/register"
              className="inline-block px-8 py-3 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors duration-200"
            >
              Get Started Today
            </Link>
          ) : (
            <Link
              to="/dashboard"
              className="inline-block px-8 py-3 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors duration-200"
            >
              Go to Dashboard
            </Link>
          )}
        </div>
      </section>
    </div>
  );
};

export default Home;