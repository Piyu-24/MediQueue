// Base class with shared database access methods

const Logger = require('../utils/Logger');

class BaseRepository {
  constructor(model, logger = null) {
    if (this.constructor === BaseRepository) {
      throw new Error('BaseRepository is abstract and cannot be instantiated directly');
    }
    
    this.model = model;
    this.modelName = model?.modelName || 'Unknown';
    this.logger = logger || Logger.getLogger(this.constructor.name);
  }

  // Create a new document
  async create(data, options = {}) {
    try {
      this.logger.debug('Creating document', { modelName: this.modelName });
      const document = new this.model(data);
      return await document.save(options);
    } catch (error) {
      this.logger.error('Error creating document:', error);
      throw error;
    }
  }

  // Find a document by id
  async findById(id, options = {}) {
    try {
      this.logger.debug('Finding document by ID', { id, modelName: this.modelName });
      
      let query = this.model.findById(id);
      
      if (options.populate) {
        query = query.populate(options.populate);
      }
      
      if (options.select) {
        query = query.select(options.select);
      }
      
      return await query.exec();
    } catch (error) {
      this.logger.error('Error finding document by ID:', error);
      throw error;
    }
  }

  // Find one document matching the query
  async findOne(query = {}, options = {}) {
    try {
      this.logger.debug('Finding one document', { query, modelName: this.modelName });
      
      let mongoQuery = this.model.findOne(query);
      
      if (options.populate) {
        mongoQuery = mongoQuery.populate(options.populate);
      }
      
      if (options.select) {
        mongoQuery = mongoQuery.select(options.select);
      }
      
      if (options.sort) {
        mongoQuery = mongoQuery.sort(options.sort);
      }
      
      return await mongoQuery.exec();
    } catch (error) {
      this.logger.error('Error finding one document:', error);
      throw error;
    }
  }

  // Find many documents with pagination
  async findMany(query = {}, options = {}) {
    try {
      this.logger.debug('Finding multiple documents', { query, options, modelName: this.modelName });
      
      const {
        page = 1,
        limit = 10,
        sort = { createdAt: -1 },
        populate = null,
        select = null
      } = options;
      
      const skip = (page - 1) * limit;

      let mongoQuery = this.model.find(query);
      
      if (populate) {
        mongoQuery = mongoQuery.populate(populate);
      }
      
      if (select) {
        mongoQuery = mongoQuery.select(select);
      }
      
      if (sort) {
        mongoQuery = mongoQuery.sort(sort);
      }
      
      // Get the page of results and the total count together
      const [data, total] = await Promise.all([
        mongoQuery.skip(skip).limit(limit).exec(),
        this.model.countDocuments(query)
      ]);
      
      const totalPages = Math.ceil(total / limit);
      
      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };
    } catch (error) {
      this.logger.error('Error finding multiple documents:', error);
      throw error;
    }
  }

  // Update a document by id
  async updateById(id, updateData, options = {}) {
    try {
      this.logger.debug('Updating document by ID', { id, modelName: this.modelName });
      
      const defaultOptions = { new: true, runValidators: true };
      const mergedOptions = { ...defaultOptions, ...options };
      
      let query = this.model.findByIdAndUpdate(id, updateData, mergedOptions);
      
      if (options.populate) {
        query = query.populate(options.populate);
      }
      
      return await query.exec();
    } catch (error) {
      this.logger.error('Error updating document by ID:', error);
      throw error;
    }
  }

  // Update many documents
  async updateMany(query, updateData, options = {}) {
    try {
      this.logger.debug('Updating multiple documents', { query, modelName: this.modelName });
      return await this.model.updateMany(query, updateData, options);
    } catch (error) {
      this.logger.error('Error updating multiple documents:', error);
      throw error;
    }
  }

  // Delete a document by id
  async deleteById(id, options = {}) {
    try {
      this.logger.debug('Deleting document by ID', { id, modelName: this.modelName });
      return await this.model.findByIdAndDelete(id, options);
    } catch (error) {
      this.logger.error('Error deleting document by ID:', error);
      throw error;
    }
  }

  // Delete many documents
  async deleteMany(query, options = {}) {
    try {
      this.logger.debug('Deleting multiple documents', { query, modelName: this.modelName });
      return await this.model.deleteMany(query, options);
    } catch (error) {
      this.logger.error('Error deleting multiple documents:', error);
      throw error;
    }
  }

  // Count documents matching the query
  async count(query = {}) {
    try {
      this.logger.debug('Counting documents', { query, modelName: this.modelName });
      return await this.model.countDocuments(query);
    } catch (error) {
      this.logger.error('Error counting documents:', error);
      throw error;
    }
  }

  // Run an aggregation pipeline
  async aggregate(pipeline, options = {}) {
    try {
      this.logger.debug('Performing aggregation', { pipeline, modelName: this.modelName });
      return await this.model.aggregate(pipeline, options);
    } catch (error) {
      this.logger.error('Error performing aggregation:', error);
      throw error;
    }
  }

  // True if at least one document matches
  async exists(query) {
    try {
      const count = await this.count(query);
      return count > 0;
    } catch (error) {
      this.logger.error('Error checking document existence:', error);
      throw error;
    }
  }
}

module.exports = BaseRepository;
