/**
 * Validation functions for job data
 */

/**
 * Validate that end time is after start time
 * @param {string} start - Start date/time
 * @param {string} end - End date/time
 * @returns {{ok: boolean, msg: string}} Validation result
 */
function validateRange(start, end) {
  if (!start || !end) {
    return { ok: false, msg: 'התחלה וסיום הם שדות חובה' };
  }
  if (dayjs(end).isSameOrBefore(dayjs(start))) {
    return { ok: false, msg: 'הסיום חייב להיות אחרי ההתחלה' };
  }
  return { ok: true, msg: '' };
}

/**
 * Validate job object
 * @param {Object} job - Job object to validate
 * @returns {{valid: boolean, errors: string[], warnings: string[]}} Validation result
 */
function validateJob(job) {
  const errors = [];
  const warnings = [];
  
  // Check required fields
  if (!job.title || !job.title.trim()) {
    errors.push('כותרת המשימה חובה');
  }
  
  // Check date range
  if (job.start && job.end) {
    const rangeResult = validateRange(job.start, job.end);
    if (!rangeResult.ok) {
      errors.push(rangeResult.msg);
    }
    
    // Check duration
    const duration = dayjs(job.end).diff(dayjs(job.start), 'minute');
    if (duration < 15) {
      warnings.push('משימה קצרה מדי (פחות מ-15 דקות)');
    }
    if (duration > 480) {
      warnings.push('משימה ארוכה (יותר מ-8 שעות)');
    }
    
    // Check work hours
    const startHour = dayjs(job.start).hour();
    const endHour = dayjs(job.end).hour();
    if (startHour < 6) {
      warnings.push('התחלה לפני שעות העבודה (6:00)');
    }
    if (endHour > 22 || (endHour === 22 && dayjs(job.end).minute() > 0)) {
      warnings.push('סיום אחרי שעות העבודה (22:00)');
    }
  }
  
  // Check workers
  if (!job.workers || job.workers.length === 0) {
    warnings.push('לא נבחרו עובדים מבצעים');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get unique values from array
 * @param {Array} list - Array to filter
 * @returns {Array} Sorted array of unique values
 */
function unique(list) {
  return Array.from(new Set(list.filter(Boolean))).sort();
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateRange,
    validateJob,
    unique
  };
}

