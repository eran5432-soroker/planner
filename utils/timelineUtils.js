// Shared utilities for Timeline and Gantt views
// Handles compressed multi-day views showing only days with jobs

// Shared state for compressed timeline/gantt views
function createCompressedTimelineState() {
  return {
    startDate: null,
    endDate: null,
    showEmptyDays: false,
    daysWithJobsCache: null
  };
}

// Get unique days that have jobs (with caching for performance)
function getCompressedDaysWithJobs(state, allJobs) {
  // Return cached value if available
  if (state.daysWithJobsCache) {
    return state.daysWithJobsCache;
  }
  
  // If showing empty days, return all days in range
  if (state.showEmptyDays && state.startDate && state.endDate) {
    const days = [];
    let current = state.startDate.clone().startOf('day');
    const end = state.endDate.clone().startOf('day');
    
    while (current.isSameOrBefore(end, 'day')) {
      days.push(current.clone());
      current = current.add(1, 'day');
    }
    
    state.daysWithJobsCache = days;
    return days;
  }
  
  // Otherwise, only return days with jobs
  // Note: allJobs should already be filtered before passing to this function
  const jobs = allJobs;
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
          // Only add if within timeline range
          if (state.startDate && state.endDate) {
            const currentStart = current.startOf('day');
            const rangeStart = state.startDate.startOf('day');
            const rangeEnd = state.endDate.startOf('day');
            if (!currentStart.isBefore(rangeStart, 'day') && 
                currentStart.isSameOrBefore(rangeEnd, 'day')) {
              daysSet.add(current.format('YYYY-MM-DD'));
            }
          } else {
            daysSet.add(current.format('YYYY-MM-DD'));
          }
          current = current.add(1, 'day');
        }
      }
    }
  });
  
  // Convert to sorted array of dayjs objects
  const result = Array.from(daysSet)
    .map(dateStr => dayjs(dateStr))
    .sort((a, b) => a.valueOf() - b.valueOf());
  
  state.daysWithJobsCache = result;
  return result;
}

// Calculate position for a time across compressed days
function calculateCompressedPosition(time, daysWithJobs, pixelsPerHour) {
  const jobTime = dayjs(time);
  const jobDay = jobTime.clone().startOf('day');
  
  // Find which displayed day this job is on
  let cumulativeHours = 0;
  let found = false;
  
  for (let i = 0; i < daysWithJobs.length; i++) {
    const displayDay = daysWithJobs[i];
    
    if (jobDay.isSame(displayDay, 'day')) {
      // Job is on this displayed day
      const hoursIntoDay = jobTime.hour() + (jobTime.minute() / 60);
      cumulativeHours += hoursIntoDay;
      found = true;
      break;
    } else if (displayDay.isBefore(jobDay, 'day')) {
      // This displayed day is before our job day, add full 24 hours
      cumulativeHours += 24;
    }
  }
  
  if (!found) {
    // If job day not found in displayed days, position at end
    cumulativeHours = daysWithJobs.length * 24;
  }
  
  return cumulativeHours * pixelsPerHour;
}

// Convert pixel position to time across compressed days
function compressedPositionToTime(pixelPosition, daysWithJobs, pixelsPerHour) {
  const hours = pixelPosition / pixelsPerHour;
  let remainingHours = hours;
  
  for (let i = 0; i < daysWithJobs.length; i++) {
    if (remainingHours < 24) {
      return daysWithJobs[i].clone().add(remainingHours, 'hours');
    }
    remainingHours -= 24;
  }
  
  // If beyond all days, return last day + remaining hours
  if (daysWithJobs.length > 0) {
    return daysWithJobs[daysWithJobs.length - 1].clone().add(remainingHours, 'hours');
  }
  
  return dayjs();
}

// Load saved dates from localStorage
function loadSavedDateRange(storageKeyPrefix, state, startInputId, endInputId) {
  const savedStartDate = localStorage.getItem(storageKeyPrefix + 'StartDate');
  const savedEndDate = localStorage.getItem(storageKeyPrefix + 'EndDate');
  
  let loaded = false;
  
  if (savedStartDate && savedEndDate) {
    const startDate = dayjs(savedStartDate);
    const endDate = dayjs(savedEndDate);
    
    if (startDate.isValid() && endDate.isValid()) {
      state.startDate = startDate;
      state.endDate = endDate;
      
      // Update input fields
      const startDateInput = document.getElementById(startInputId);
      const endDateInput = document.getElementById(endInputId);
      
      if (startDateInput) {
        startDateInput.value = startDate.format('YYYY-MM-DD');
      }
      if (endDateInput) {
        endDateInput.value = endDate.format('YYYY-MM-DD');
      }
      
      loaded = true;
    }
  }
  
  return loaded;
}

// Update date range from inputs
function updateDateRangeFromInputs(storageKeyPrefix, state, startInputId, endInputId, onUpdate) {
  const startDateInput = document.getElementById(startInputId);
  const endDateInput = document.getElementById(endInputId);
  
  if (startDateInput?.value) {
    state.startDate = dayjs(startDateInput.value).startOf('day');
  } else {
    state.startDate = dayjs().startOf('day');
  }
  
  if (endDateInput?.value) {
    state.endDate = dayjs(endDateInput.value).endOf('day');
  } else {
    state.endDate = state.startDate.clone().add(7, 'days').endOf('day');
  }
  
  // Set default values if not set
  if (!startDateInput?.value) {
    startDateInput.value = state.startDate.format('YYYY-MM-DD');
  }
  if (!endDateInput?.value) {
    endDateInput.value = state.endDate.format('YYYY-MM-DD');
  }
  
  // Save to localStorage
  localStorage.setItem(storageKeyPrefix + 'StartDate', state.startDate.format());
  localStorage.setItem(storageKeyPrefix + 'EndDate', state.endDate.format());
  
  // Clear cache
  state.daysWithJobsCache = null;
  
  // Trigger update callback
  if (onUpdate) {
    onUpdate();
  }
}

// Create day headers HTML for compressed view
function createDayHeadersHTML(daysWithJobs, pixelsPerHour, headerClass = 'day-header', includeHourLabels = true) {
  let html = '';
  let cumulativeHours = 0;
  
  daysWithJobs.forEach((dayDate, dayIndex) => {
    const dayWidth = 24 * pixelsPerHour;
    const dayPosition = cumulativeHours * pixelsPerHour;
    
    // Add day header
    html += `<div class="${headerClass}" style="width: ${dayWidth}px; left: ${dayPosition}px;">${dayDate.format('ddd DD/MM')}</div>`;
    
    // Add hour labels if requested
    if (includeHourLabels) {
      for(let h = 0; h < 24; h++) {
        const hourPosition = (cumulativeHours + h) * pixelsPerHour;
        html += `<div class="hour-label" style="left: ${hourPosition}px;">${h}:00</div>`;
      }
    }
    
    cumulativeHours += 24;
  });
  
  return html;
}

// Calculate total width for compressed timeline
function calculateCompressedWidth(daysWithJobs, pixelsPerHour) {
  return daysWithJobs.length * 24 * pixelsPerHour;
}

