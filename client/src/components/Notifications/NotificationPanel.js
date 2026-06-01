import React from 'react';
import { XMarkIcon, BellIcon } from '@heroicons/react/24/outline';

const NotificationPanel = ({
  isOpen,
  onClose,
  notifications = [],
  onMarkRead,
  onReschedule
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BellIcon className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            aria-label="Close notifications"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {notifications.length === 0 && (
            <div className="text-center text-gray-500 py-12">
              No notifications yet.
            </div>
          )}

          {notifications.map((notification) => (
            <div
              key={notification._id}
              className={`border rounded-lg p-4 ${notification.isRead ? 'border-gray-200' : 'border-amber-300 bg-amber-50'}`}
            >
              <div className="flex items-start justify-between">
                <div className="pr-2">
                  <p className="text-sm font-semibold text-gray-900">{notification.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                  {notification.metadata?.appointmentDate && (
                    <p className="text-xs text-gray-500 mt-2">
                      {notification.metadata.appointmentDate} at {notification.metadata.appointmentTime}
                    </p>
                  )}
                </div>
                {!notification.isRead && (
                  <button
                    onClick={() => onMarkRead(notification)}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Mark read
                  </button>
                )}
              </div>

              {notification.type === 'doctor-unavailable' && (
                <div className="mt-3">
                  <button
                    onClick={() => onReschedule(notification)}
                    className="text-sm text-amber-700 hover:text-amber-800 font-medium"
                  >
                    Reschedule now
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NotificationPanel;
