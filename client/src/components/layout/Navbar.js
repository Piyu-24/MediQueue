import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { 
  Bars3Icon, 
  XMarkIcon,
  HeartIcon,
  UserCircleIcon,
  BellIcon
} from '@heroicons/react/24/outline';
import { notificationAPI } from '../../services/api';
import NotificationPanel from '../Notifications/NotificationPanel';
import socketService from '../../services/socket';
import toast from 'react-hot-toast';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const getDashboardRoute = (role) => {
    const routes = {
      patient: '/dashboard',
      doctor: '/doctor/dashboard',
      staff: '/staff/dashboard',
      manager: '/manager/dashboard',
      receptionist: '/receptionist/dashboard',
      admin: '/admin/dashboard'
    };
    return routes[role] || '/dashboard';
  };

  const publicLinks = [
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ];

  const patientLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Contact', href: '/contact' },
  ];

  const doctorLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/doctor/dashboard' },
    { name: 'Appointments', href: '/doctor/appointments' },
    { name: 'Patient Records', href: '/doctor/patient-records' },
  ];

  const staffLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/staff/dashboard' },
    { name: 'Patient Check-in', href: '/staff/patient-verification' },
  ];

  const managerLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/manager/dashboard' },
    { name: 'Reports', href: '/manager/reports' },
  ];

  const receptionistLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/receptionist/dashboard' },
  ];

  const adminLinks = [
    { name: 'Home', href: '/' },
    { name: 'Dashboard', href: '/admin/dashboard' },
  ];

  const getNavigationLinks = () => {
    if (!user) return publicLinks;
    
    switch (user.role) {
      case 'patient': return patientLinks;
      case 'doctor': return doctorLinks;
      case 'staff': return staffLinks;
      case 'manager': return managerLinks;
      case 'receptionist': return receptionistLinks;
      case 'admin': return adminLinks;
      default: return publicLinks;
    }
  };

  const navigationLinks = getNavigationLinks();

  useEffect(() => {
    if (!user) return;
    const loadUnread = async () => {
      try {
        const res = await notificationAPI.getUnreadCount();
        if (res.data.success) setUnreadCount(res.data.data.count || 0);
      } catch {
        // Ignore badge load errors
      }
    };

    loadUnread();
    // Join personal room and subscribe to notification events
    try {
      socketService.joinRoom(user._id);
    } catch (e) {
      // ignore socket join errors
    }

    const handleAppointmentUnavailable = (payload) => {
      // Show a small toast and increment badge
      toast.error('Your appointment was affected by doctor unavailability');
      setUnreadCount((prev) => prev + 1);
      // If panel is open, refresh notifications
      if (notificationsOpen) {
        (async () => {
          try {
            const res = await notificationAPI.getNotifications();
            if (res.data.success) setNotifications(res.data.data.notifications || []);
          } catch (err) {
            // ignore
          }
        })();
      }
    };

    socketService.on('appointment:doctor-unavailable', handleAppointmentUnavailable);

    return () => {
      socketService.off('appointment:doctor-unavailable', handleAppointmentUnavailable);
    };
  }, [user, notificationsOpen]);

  const openNotifications = async () => {
    if (!user) return;
    setNotificationsOpen(true);
    try {
      const res = await notificationAPI.getNotifications();
      if (res.data.success) setNotifications(res.data.data.notifications || []);
    } catch {
      // Ignore panel load errors
    }
  };

  const markNotificationRead = async (notification) => {
    try {
      await notificationAPI.markAsRead(notification._id);
      setNotifications((prev) => prev.map((item) => (
        item._id === notification._id ? { ...item, isRead: true } : item
      )));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore read errors
    }
  };

  const handleReschedule = (notification) => {
    const doctorId = notification.metadata?.doctorId;
    const appointmentId = notification.appointment?._id || notification.appointment;
    setNotificationsOpen(false);
    if (doctorId) {
      navigate(`/dashboard?tab=book-appointment&doctorId=${doctorId}${appointmentId ? `&appointmentId=${appointmentId}` : ''}`);
    } else {
      navigate('/dashboard?tab=book-appointment');
    }
  };

  return (
    <nav className="bg-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <HeartIcon className="h-8 w-8 text-blue-600" />
            <span className="text-xl font-bold text-gray-900">MediQueue</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            {navigationLinks.map((link) => {
              const isActive = location.pathname === link.href || 
                              (link.href === '/dashboard' && location.pathname.startsWith('/dashboard'));
              return (
                <Link
                  key={link.name}
                  to={link.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'text-blue-600 bg-blue-50 font-semibold'
                      : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                  }`}
                >
                  {link.name}
                </Link>
              );
            })}
          </div>

          {/* User Menu / Auth Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            {user ? (
              <>
                {/* Notifications */}
                <button
                  className="p-2 text-gray-600 hover:text-blue-600 relative"
                  onClick={openNotifications}
                  aria-label="Open notifications"
                >
                  <BellIcon className="h-6 w-6" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* User Menu */}
                <div className="relative group">
                  <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.fullName}
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <UserCircleIcon className="h-8 w-8" />
                    )}
                    <span className="text-sm font-medium">{user.firstName}</span>
                  </button>

                  {/* Dropdown Menu */}
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200">
                    <Link
                      to={getDashboardRoute(user.role)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Dashboard
                    </Link>
                    <Link
                      to="/profile"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Profile
                    </Link>
                    <div className="border-t border-gray-100"></div>
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-4">
                <Link
                  to="/login"
                  className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="btn-primary"
                >
                  Get Started
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-blue-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              {isMenuOpen ? (
                <XMarkIcon className="h-6 w-6" />
              ) : (
                <Bars3Icon className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 border-t border-gray-200">
              {navigationLinks.map((link) => {
                const isActive = location.pathname === link.href || 
                                (link.href === '/dashboard' && location.pathname.startsWith('/dashboard'));
                return (
                  <Link
                    key={link.name}
                    to={link.href}
                    className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                      isActive
                        ? 'text-blue-600 bg-blue-50 font-semibold'
                        : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50'
                    }`}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                );
              })}
              
              {user ? (
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center px-3 pb-3">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.fullName}
                        className="h-10 w-10 rounded-full"
                      />
                    ) : (
                      <UserCircleIcon className="h-10 w-10 text-gray-600" />
                    )}
                    <div className="ml-3">
                      <div className="text-base font-medium text-gray-800">
                        {user.fullName}
                      </div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </div>
                  <Link
                    to="/profile"
                    className="block px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="border-t border-gray-200 pt-4 space-y-1">
                  <Link
                    to="/login"
                    className="block px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/register"
                    className="block px-3 py-2 text-base font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-md mx-3"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Get Started
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <NotificationPanel
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
        onMarkRead={markNotificationRead}
        onReschedule={handleReschedule}
      />
    </nav>
  );
};

export default Navbar;