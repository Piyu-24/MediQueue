// Database access for users

const BaseRepository = require('../core/BaseRepository');
const User = require('../models/User');
const Logger = require('../utils/Logger');
const { ConflictError } = require('../utils/errors');

class UserRepository extends BaseRepository {
  constructor() {
    super(User, Logger.getLogger('UserRepository'));
  }

  // Find a user by email
  async findByEmail(email, options = {}) {
    try {
      this.logger.debug('Finding user by email', { email });
      
      return await this.findOne({ email: email.toLowerCase() }, options);
    } catch (error) {
      this.logger.error('Error finding user by email:', error);
      throw error;
    }
  }

  // Find users with a given role
  async findByRole(role, options = {}) {
    try {
      this.logger.debug('Finding users by role', { role });
      
      return await this.findMany({ role }, options);
    } catch (error) {
      this.logger.error('Error finding users by role:', error);
      throw error;
    }
  }

  // Find doctors with a given specialization
  async findDoctorsBySpecialization(specialization, options = {}) {
    try {
      this.logger.debug('Finding doctors by specialization', { specialization });
      
      const query = {
        role: 'doctor',
        specialization: specialization
      };
      
      return await this.findMany(query, options);
    } catch (error) {
      this.logger.error('Error finding doctors by specialization:', error);
      throw error;
    }
  }

  // Create a user, making sure the email isn't already taken
  async createUser(userData, options = {}) {
    try {
      this.logger.debug('Creating new user', { email: userData.email });

      const existingUser = await this.findByEmail(userData.email);
      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      // Lowercase the email
      const normalizedData = {
        ...userData,
        email: userData.email.toLowerCase()
      };
      
      return await this.create(normalizedData, options);
    } catch (error) {
      this.logger.error('Error creating user:', error);
      throw error;
    }
  }

  // Update a user's profile
  async updateProfile(userId, updateData, options = {}) {
    try {
      this.logger.debug('Updating user profile', { userId });

      // Don't let password or role be changed through here
      const { password, role, ...profileData } = updateData;

      // Lowercase the email if given
      if (profileData.email) {
        profileData.email = profileData.email.toLowerCase();

        // Make sure no one else has this email
        const existingUser = await this.findOne({
          email: profileData.email,
          _id: { $ne: userId }
        });
        
        if (existingUser) {
          throw new ConflictError('Email already in use by another user');
        }
      }
      
      return await this.updateById(userId, profileData, options);
    } catch (error) {
      this.logger.error('Error updating user profile:', error);
      throw error;
    }
  }

  // Update a user's password
  async updatePassword(userId, hashedPassword, options = {}) {
    try {
      this.logger.debug('Updating user password', { userId });
      
      return await this.updateById(userId, { password: hashedPassword }, options);
    } catch (error) {
      this.logger.error('Error updating user password:', error);
      throw error;
    }
  }

  // Activate or deactivate a user
  async setActiveStatus(userId, isActive, options = {}) {
    try {
      this.logger.debug('Setting user active status', { userId, isActive });
      
      return await this.updateById(userId, { isActive }, options);
    } catch (error) {
      this.logger.error('Error setting user active status:', error);
      throw error;
    }
  }

  // Search users by name/email/phone
  async searchUsers(searchTerm, filters = {}, options = {}) {
    try {
      this.logger.debug('Searching users', { searchTerm, filters });
      
      const query = { ...filters };
      
      if (searchTerm) {
        const searchRegex = new RegExp(searchTerm, 'i');
        query.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ];
      }
      
      return await this.findMany(query, options);
    } catch (error) {
      this.logger.error('Error searching users:', error);
      throw error;
    }
  }

  // Count users by role, with active/inactive breakdown
  async getUserStatistics() {
    try {
      this.logger.debug('Getting user statistics');
      
      const stats = await this.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 },
            active: {
              $sum: {
                $cond: [{ $eq: ['$isActive', true] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            role: '$_id',
            count: 1,
            active: 1,
            inactive: { $subtract: ['$count', '$active'] },
            _id: 0
          }
        }
      ]);
      
      return stats;
    } catch (error) {
      this.logger.error('Error getting user statistics:', error);
      throw error;
    }
  }

  // Get the most recently registered users
  async getRecentUsers(limit = 10, options = {}) {
    try {
      this.logger.debug('Getting recent users', { limit });
      
      const result = await this.findMany({}, {
        ...options,
        limit,
        sort: { createdAt: -1 },
        select: 'firstName lastName email role createdAt isActive'
      });
      
      return result.data;
    } catch (error) {
      this.logger.error('Error getting recent users:', error);
      throw error;
    }
  }

  // Find several users by their ids
  async findByIds(userIds, options = {}) {
    try {
      this.logger.debug('Finding users by IDs', { count: userIds.length });
      
      const result = await this.findMany(
        { _id: { $in: userIds } },
        options
      );
      
      return result.data;
    } catch (error) {
      this.logger.error('Error finding users by IDs:', error);
      throw error;
    }
  }

  // Count users, optionally filtered by role and active status
  async countByRoleAndStatus(role = null, isActive = null) {
    try {
      const query = {};
      if (role) query.role = role;
      if (isActive !== null) query.isActive = isActive;
      
      this.logger.debug('Counting users by role and status', query);
      
      return await this.count(query);
    } catch (error) {
      this.logger.error('Error counting users by role and status:', error);
      throw error;
    }
  }

  // Soft delete: mark the user inactive
  async softDelete(userId, options = {}) {
    try {
      this.logger.debug('Soft deleting user', { userId });
      
      return await this.updateById(userId, { 
        isActive: false,
        deletedAt: new Date()
      }, options);
    } catch (error) {
      this.logger.error('Error soft deleting user:', error);
      throw error;
    }
  }

  // Restore a soft-deleted user
  async restore(userId, options = {}) {
    try {
      this.logger.debug('Restoring user', { userId });
      
      return await this.updateById(userId, { 
        isActive: true,
        $unset: { deletedAt: 1 }
      }, options);
    } catch (error) {
      this.logger.error('Error restoring user:', error);
      throw error;
    }
  }
}

module.exports = UserRepository;
