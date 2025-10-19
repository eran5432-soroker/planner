// Common utilities shared between Timeline and Gantt views

/**
 * Get color for a task bar based on its status (conflicts, dependencies, finished, shabbat)
 * This ensures consistent coloring across Timeline and Gantt views
 */
function getTaskBarColor(job, conflicts, depIssues) {
  const isConflict = conflicts.has(job.id);
  const isDepIssue = depIssues.has(job.id);
  const isFinished = job.finished;
  const isShabbat = jobTouchesShabbat(job);
  
  // Priority order: Conflict > Dep Issue > Finished > Shabbat > Priority > Factory
  if (isConflict) {
    return '#dc3545'; // Red for conflicts
  }
  
  if (isDepIssue) {
    return '#ffc107'; // Orange for dependency issues
  }
  
  if (isFinished) {
    return '#28a745'; // Green for finished tasks
  }
  
  if (isShabbat) {
    return '#ffc107'; // Yellow for Shabbat tasks
  }
  
  // Default color based on priority
  const priorityColors = {
    'נמוכה': '#45b7d1',
    'בינונית': '#4ecdc4', 
    'גבוהה': '#ff6b6b',
    'דחופה': '#ff9f43'
  };
  
  if (job.priority && priorityColors[job.priority]) {
    return priorityColors[job.priority];
  }
  
  // Default color based on factory
  const factoryColors = [
    '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
    '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43'
  ];
  
  if (job.factory) {
    const hash = job.factory.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return factoryColors[Math.abs(hash) % factoryColors.length];
  }
  
  return '#95a5a6'; // Default gray
}

/**
 * Get CSS classes for a task bar based on its status
 */
function getTaskBarClasses(job, conflicts, depIssues) {
  const classes = [];
  
  if (job.finished) classes.push('finished');
  if (conflicts.has(job.id)) classes.push('conflict');
  if (depIssues.has(job.id)) classes.push('dep-issue');
  if (jobTouchesShabbat(job)) classes.push('shabbat');
  
  return classes.join(' ');
}

/**
 * Get an array of all days between start and end dates (inclusive)
 */
function getDaysBetween(startDate, endDate) {
  const days = [];
  let current = startDate.clone().startOf('day');
  const end = endDate.clone().startOf('day');
  
  while (current.isSameOrBefore(end, 'day')) {
    days.push(current.clone());
    current = current.add(1, 'day');
  }
  
  return days;
}

/**
 * Get only days that have jobs (for compressed view)
 */
function getDaysWithJobs(jobs, startDate, endDate, showEmptyDays = false) {
  // If showing empty days, return all days in range
  if (showEmptyDays) {
    return getDaysBetween(startDate, endDate);
  }
  
  // Otherwise, only return days with jobs
  const daysSet = new Set();
  
  jobs.forEach(job => {
    if (job.start && job.end) {
      const start = dayjs(job.start);
      const end = dayjs(job.end);
      
      if (start.isValid() && end.isValid()) {
        // Add all days between start and end
        let current = start.clone().startOf('day');
        const endDay = end.clone().startOf('day');
        
        while (current.isSameOrBefore(endDay, 'day')) {
          daysSet.add(current.format('YYYY-MM-DD'));
          current = current.add(1, 'day');
        }
      }
    }
  });
  
  // Convert to sorted array of dayjs objects
  return Array.from(daysSet)
    .map(dateStr => dayjs(dateStr))
    .sort((a, b) => a.valueOf() - b.valueOf());
}

/**
 * Calculate position of a task on a timeline given a start time
 * @param {dayjs} startTime - Task start time
 * @param {dayjs} timelineStart - Timeline start time
 * @param {number} hourWidth - Pixels per hour
 * @param {Array} daysWithJobs - Array of days to display (for compressed view)
 * @returns {number} Position in pixels
 */
function calculateTaskPosition(startTime, timelineStart, hourWidth, daysWithJobs = null) {
  // If we have a compressed view with specific days
  if (daysWithJobs && daysWithJobs.length > 0) {
    const taskDay = startTime.clone().startOf('day');
    
    // Find which displayed day this task starts on
    let cumulativeHours = 0;
    let found = false;
    
    for (let i = 0; i < daysWithJobs.length; i++) {
      const displayDay = daysWithJobs[i];
      
      if (taskDay.isSame(displayDay, 'day')) {
        // Task starts on this displayed day
        const hoursIntoDay = startTime.hour() + (startTime.minute() / 60);
        cumulativeHours += hoursIntoDay;
        found = true;
        break;
      } else if (displayDay.isBefore(taskDay, 'day')) {
        // This displayed day is before our task day, add full 24 hours
        cumulativeHours += 24;
      }
    }
    
    if (!found) {
      // If task day not found in displayed days, position at end
      cumulativeHours = daysWithJobs.length * 24;
    }
    
    return cumulativeHours * hourWidth;
  }
  
  // Standard linear timeline
  const hours = startTime.diff(timelineStart, 'hours', true);
  return hours * hourWidth;
}

/**
 * Calculate width of a task bar given start and end times
 * @param {dayjs} startTime - Task start time
 * @param {dayjs} endTime - Task end time
 * @param {number} hourWidth - Pixels per hour
 * @param {number} minWidth - Minimum width in pixels
 * @returns {number} Width in pixels
 */
function calculateTaskWidth(startTime, endTime, hourWidth, minWidth = 20) {
  const duration = endTime.diff(startTime, 'hours', true);
  return Math.max(minWidth, duration * hourWidth);
}

/**
 * Save date range to localStorage for a specific view
 */
function saveDateRange(viewName, startDate, endDate) {
  localStorage.setItem(`${viewName}StartDate`, startDate.format());
  localStorage.setItem(`${viewName}EndDate`, endDate.format());
}

/**
 * Load date range from localStorage for a specific view
 * Returns null if no saved dates or invalid dates
 */
function loadDateRange(viewName) {
  const savedStartDate = localStorage.getItem(`${viewName}StartDate`);
  const savedEndDate = localStorage.getItem(`${viewName}EndDate`);
  
  if (savedStartDate && savedEndDate) {
    const startDate = dayjs(savedStartDate);
    const endDate = dayjs(savedEndDate);
    
    if (startDate.isValid() && endDate.isValid()) {
      return { startDate, endDate };
    }
  }
  
  return null;
}

