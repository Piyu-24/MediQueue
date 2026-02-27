import React from 'react';
import { 
  HeartIcon, 
  UserGroupIcon, 
  ShieldCheckIcon,
  ClockIcon 
} from '@heroicons/react/24/outline';

const About = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            About MediQueue
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            A hybrid healthcare queue and appointment management system designed to reduce 
            patient waiting times and improve OPD workflows in Sri Lankan public hospitals.
          </p>
        </div>

        {/* Mission & Vision */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mb-6">
              <HeartIcon className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
            <p className="text-gray-600 leading-relaxed">
              To reduce patient waiting times, improve transparency in outpatient department 
              workflows, and integrate both digital and manual processes within Sri Lankan 
              public hospitals through a hybrid QR-based queue and appointment management system.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mb-6">
              <ShieldCheckIcon className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Vision</h2>
            <p className="text-gray-600 leading-relaxed">
              To become the standard for outpatient flow management in public healthcare, 
              ensuring inclusive and transparent systems that serve both smartphone and 
              non-smartphone users equally across all Sri Lankan government hospitals.
            </p>
          </div>
        </div>

        {/* Core Values */}
        <div className="bg-white rounded-2xl shadow-xl p-12 mb-16">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            Our Core Values
          </h2>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <UserGroupIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Patient-Centered</h3>
              <p className="text-gray-600 text-sm">
                Every decision we make prioritizes patient wellbeing and satisfaction.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <ShieldCheckIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Trust & Security</h3>
              <p className="text-gray-600 text-sm">
                Your health data is protected with industry-leading security measures.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <ClockIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Efficiency</h3>
              <p className="text-gray-600 text-sm">
                Streamlined OPD workflows save time for patients and staff alike.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center mx-auto mb-4">
                <HeartIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Inclusivity</h3>
              <p className="text-gray-600 text-sm">
                Serving both smartphone and non-smartphone users in public healthcare settings.
              </p>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl p-12 text-white">
          <h2 className="text-3xl font-bold text-center mb-12">
            MediQueue at a Glance
          </h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-5xl font-bold mb-2">≤ 1s</div>
              <div className="text-blue-100">Queue Update Speed</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">≤ 5s</div>
              <div className="text-blue-100">QR Check-in Time</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">300+</div>
              <div className="text-blue-100">Concurrent Users</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;
