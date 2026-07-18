// Builds the standard API response shapes so every response looks the same
class ResponseFormatter {
  // Success response
  success(data = null, message = 'Success', meta = {}) {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      ...meta
    };
  }

  // Error response
  error(message = 'An error occurred', errors = null, meta = {}) {
    const response = {
      success: false,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    };

    if (errors) {
      response.errors = errors;
    }

    return response;
  }

  // Paginated list response
  paginated(data, pagination, message = 'Success') {
    return {
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page || 1,
        limit: pagination.limit || 10,
        total: pagination.total || 0,
        totalPages: pagination.totalPages || 0,
        hasNextPage: pagination.hasNextPage || false,
        hasPrevPage: pagination.hasPrevPage || false
      },
      timestamp: new Date().toISOString()
    };
  }

  // Validation error response
  validationError(validationErrors, message = 'Validation failed') {
    return this.error(message, validationErrors, { type: 'validation' });
  }

  // 401 response
  authenticationError(message = 'Authentication required') {
    return this.error(message, null, { type: 'authentication' });
  }

  // 403 response
  authorizationError(message = 'Access denied') {
    return this.error(message, null, { type: 'authorization' });
  }

  // 404 response
  notFound(resource = 'Resource', message = null) {
    const errorMessage = message || `${resource} not found`;
    return this.error(errorMessage, null, { type: 'not_found' });
  }

  // 409 response
  conflict(message = 'Resource conflict', conflictDetails = null) {
    return this.error(message, conflictDetails, { type: 'conflict' });
  }

  // 429 response
  rateLimitError(message = 'Rate limit exceeded', retryAfter = 60) {
    return this.error(message, null, { 
      type: 'rate_limit',
      retryAfter 
    });
  }

  // 500 response
  serverError(message = 'Internal server error', errorId = null) {
    const response = this.error(message, null, { type: 'server_error' });
    
    if (errorId) {
      response.errorId = errorId;
    }

    return response;
  }

  // 201 created response
  created(data, message = 'Resource created successfully', location = null) {
    const response = this.success(data, message, { type: 'created' });
    
    if (location) {
      response.location = location;
    }

    return response;
  }

  // Updated response
  updated(data, message = 'Resource updated successfully') {
    return this.success(data, message, { type: 'updated' });
  }

  // Deleted response
  deleted(message = 'Resource deleted successfully', deletedData = null) {
    return this.success(deletedData, message, { type: 'deleted' });
  }

  // 204 no-content response
  noContent(message = 'No content') {
    return this.success(null, message, { type: 'no_content' });
  }

  // Partial content response
  partialContent(data, message = 'Partial content', partialInfo = {}) {
    return this.success(data, message, { 
      type: 'partial_content',
      partial: partialInfo 
    });
  }

  // Health check response
  healthCheck(healthData, status = 'healthy') {
    return {
      status,
      timestamp: new Date().toISOString(),
      checks: healthData
    };
  }

  // API documentation response
  apiDocumentation(apiInfo, endpoints) {
    return this.success({
      api: apiInfo,
      endpoints,
      documentation: {
        version: apiInfo.version,
        baseUrl: apiInfo.baseUrl,
        authentication: apiInfo.authentication
      }
    }, 'API Documentation');
  }

  // File upload response
  fileUploaded(fileInfo, message = 'File uploaded successfully') {
    return this.success({
      file: {
        filename: fileInfo.filename,
        originalName: fileInfo.originalname,
        size: fileInfo.size,
        mimetype: fileInfo.mimetype,
        path: fileInfo.path,
        url: fileInfo.url
      }
    }, message, { type: 'file_upload' });
  }

  // Batch operation response
  batchOperation(batchResult, message = 'Batch operation completed') {
    return this.success({
      total: batchResult.total,
      successful: batchResult.successful,
      failed: batchResult.failed,
      results: batchResult.results,
      errors: batchResult.errors
    }, message, { type: 'batch_operation' });
  }
}

module.exports = ResponseFormatter;
