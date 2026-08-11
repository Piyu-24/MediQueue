const { createBlock, generateBlocksForRange } = require('../../services/TimeBlockService');
const TimeBlock = require('../../models/TimeBlock');
const QueuePolicy = require('../../models/QueuePolicy');

jest.mock('../../models/TimeBlock');
jest.mock('../../models/QueuePolicy');

describe('TimeBlockService - Timing Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fails createBlock when endTime is before or equal to startTime', async () => {
    QueuePolicy.resolveFor.mockResolvedValue({
      appointmentCapacityPercentage: 65,
      walkInCapacityPercentage: 25,
      emergencyBufferPercentage: 5
    });

    await expect(
      createBlock({
        departmentId: '507f1f77bcf86cd799439011',
        date: '2026-09-01',
        startTime: '14:00',
        endTime: '12:00',
        totalCapacity: 20
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'End time (12:00) must be after start time (14:00)'
    });
  });

  test('fails generateBlocksForRange when a template has endTime <= startTime', async () => {
    await expect(
      generateBlocksForRange({
        departmentId: '507f1f77bcf86cd799439011',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        blockTemplates: [
          { startTime: '15:00', endTime: '15:00', totalCapacity: 20 }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('End time (15:00) must be after start time (15:00)')
    });
  });
});
