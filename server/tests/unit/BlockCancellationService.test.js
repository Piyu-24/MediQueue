const { cancelBlock } = require('../../services/BlockCancellationService');
const TimeBlock = require('../../models/TimeBlock');
const Appointment = require('../../models/Appointment');
const Notification = require('../../models/Notification');
const QueueEntry = require('../../models/QueueEntry');
const AuditLog = require('../../models/AuditLog');
const QueueEngine = require('../../services/QueueEngine');

jest.mock('../../models/TimeBlock');
jest.mock('../../models/Appointment');
jest.mock('../../models/Notification');
jest.mock('../../models/QueueEntry');
jest.mock('../../models/AuditLog');
jest.mock('../../services/QueueEngine');

describe('BlockCancellationService - Session Cancellation Restrictions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fails when trying to cancel a session from a past date', async () => {
    const mockBlock = {
      _id: 'block123',
      date: '2020-01-01',
      startTime: '09:00',
      endTime: '12:00',
      status: 'active'
    };

    TimeBlock.findById.mockResolvedValue(mockBlock);

    await expect(cancelBlock({ blockId: 'block123' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot cancel a session from a past date. The session has already ended.'
    });
  });

  test('fails when trying to cancel today session that has already started', async () => {
    // Construct today's date in YYYY-MM-DD
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const mockBlock = {
      _id: 'block124',
      date: todayStr,
      startTime: '00:00', // Start time 00:00 is guaranteed to be <= current time during test
      endTime: '23:59',
      status: 'active'
    };

    TimeBlock.findById.mockResolvedValue(mockBlock);

    await expect(cancelBlock({ blockId: 'block124' })).rejects.toMatchObject({
      statusCode: 400,
      message: "Cannot cancel a session that has already started or is currently underway. Only future sessions (before start time) can be cancelled."
    });
  });

  test('allows cancelling a future session', async () => {
    const mockBlock = {
      _id: 'block125',
      date: '2099-12-31',
      startTime: '10:00',
      endTime: '12:00',
      status: 'active',
      save: jest.fn().mockResolvedValue(true)
    };

    TimeBlock.findById.mockResolvedValue(mockBlock);
    Appointment.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([])
      })
    });
    TimeBlock.releaseAppointmentSlot.mockResolvedValue(true);

    const result = await cancelBlock({ blockId: 'block125', reason: 'Emergency maintenance' });

    expect(mockBlock.status).toBe('cancelled');
    expect(mockBlock.save).toHaveBeenCalled();
    expect(result.affectedCount).toBe(0);
  });
});
