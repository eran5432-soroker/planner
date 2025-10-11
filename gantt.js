// Gantt Chart Implementation
// Separate JS file for Gantt chart functionality

// Gantt chart state
let ganttState = {
  startDate: null,
  endDate: null,
  showEmptyDays: false, // New: show/hide empty days
  scrollPosition: 0,
  // Cache for performance
  daysWithJobsCache: null,
  conflictsCache: null,
  depIssuesCache: null
};

// Gantt configuration
const GANTT_CONFIG = {
  hourWidth: 40, // pixels per hour - increased for better visibility
  dayHeight: 30, // height of day header
  taskHeight: 50, // height of each task row
  taskBarHeight: 40, // height of the task bar itself
  headerHeight: 60, // height of time header
  leftPanelWidth: 300 // width of task names panel
};

// Load saved Gantt dates from localStorage
function loadGanttDates() {
  const savedStartDate = localStorage.getItem('ganttStartDate');
  const savedEndDate = localStorage.getItem('ganttEndDate');
  
  let loaded = false;
  
  if (savedStartDate && savedEndDate) {
    const startDate = dayjs(savedStartDate);
    const endDate = dayjs(savedEndDate);
    
    if (startDate.isValid() && endDate.isValid()) {
      ganttState.startDate = startDate;
      ganttState.endDate = endDate;
      
      // Update input fields
      const startDateInput = document.getElementById('gantt-start-date');
      const endDateInput = document.getElementById('gantt-end-date');
      
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

// Initialize Gantt chart
function initGantt() {
  setupGanttEventListeners();
  
  // Try to load saved dates, otherwise use defaults
  if (!loadGanttDates()) {
    updateGanttDateRange();
  } else {
    renderGantt();
  }
}

// Setup Gantt event listeners
function setupGanttEventListeners() {
  // Date range controls
  document.getElementById('gantt-apply-dates')?.addEventListener('click', updateGanttDateRange);
  
  // Show empty days toggle
  document.getElementById('gantt-show-empty-days')?.addEventListener('change', (e) => {
    ganttState.showEmptyDays = e.target.checked;
    renderGantt();
  });
}

// Setup scroll synchronization between header and grid
function setupScrollSync() {
  const headerPanel = document.querySelector('.gantt-right-panel');
  const gridContainer = document.querySelector('.gantt-grid-container');
  
  if (headerPanel && gridContainer) {
    let isScrolling = false;
    
    // Remove existing listeners to prevent duplicates
    headerPanel.removeEventListener('scroll', syncHeaderToGrid);
    gridContainer.removeEventListener('scroll', syncGridToHeader);
    
    // Sync header scroll with grid scroll
    function syncGridToHeader(e) {
      if (!isScrolling) {
        isScrolling = true;
        headerPanel.scrollLeft = e.target.scrollLeft;
        setTimeout(() => { isScrolling = false; }, 10);
      }
    }
    
    // Sync grid scroll with header scroll
    function syncHeaderToGrid(e) {
      if (!isScrolling) {
        isScrolling = true;
        gridContainer.scrollLeft = e.target.scrollLeft;
        setTimeout(() => { isScrolling = false; }, 10);
      }
    }
    
    gridContainer.addEventListener('scroll', syncGridToHeader);
    headerPanel.addEventListener('scroll', syncHeaderToGrid);
  }
}

// Update Gantt date range
function updateGanttDateRange() {
  const startDateInput = document.getElementById('gantt-start-date');
  const endDateInput = document.getElementById('gantt-end-date');
  
  if (startDateInput?.value) {
    ganttState.startDate = dayjs(startDateInput.value).startOf('day');
  } else {
    ganttState.startDate = dayjs().startOf('day');
  }
  
  if (endDateInput?.value) {
    ganttState.endDate = dayjs(endDateInput.value).endOf('day');
  } else {
    ganttState.endDate = ganttState.startDate.clone().add(7, 'days').endOf('day');
  }
  
  // Set default values if not set
  if (!startDateInput?.value) {
    startDateInput.value = ganttState.startDate.format('YYYY-MM-DD');
  }
  if (!endDateInput?.value) {
    endDateInput.value = ganttState.endDate.format('YYYY-MM-DD');
  }
  
  // Save to localStorage
  localStorage.setItem('ganttStartDate', ganttState.startDate.format());
  localStorage.setItem('ganttEndDate', ganttState.endDate.format());
  
  renderGantt();
}


// Render Gantt chart
function renderGantt() {
  if (!ganttState.startDate || !ganttState.endDate) {
    updateGanttDateRange();
  }
  
  // Clear caches before render
  ganttState.daysWithJobsCache = null;
  ganttState.conflictsCache = null;
  ganttState.depIssuesCache = null;
  
  renderGanttHeader();
  renderGanttTasks();
  
  // Setup scroll synchronization after rendering
  setTimeout(() => {
    setupScrollSync();
  }, 100);
}

// Get unique days that have jobs (with caching for performance)
function getDaysWithJobs() {
  // Return cached value if available
  if (ganttState.daysWithJobsCache) {
    return ganttState.daysWithJobsCache;
  }
  
  // If showing empty days, return all days in range
  if (ganttState.showEmptyDays && ganttState.startDate && ganttState.endDate) {
    const days = [];
    let current = ganttState.startDate.clone().startOf('day');
    const end = ganttState.endDate.clone().startOf('day');
    
    while (current.isSameOrBefore(end, 'day')) {
      days.push(current.clone());
      current = current.add(1, 'day');
    }
    
    ganttState.daysWithJobsCache = days;
    return days;
  }
  
  // Otherwise, only return days with jobs
  const allJobs = getGanttJobs();
  const daysSet = new Set();
  
  allJobs.forEach(job => {
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
  const result = Array.from(daysSet)
    .map(dateStr => dayjs(dateStr))
    .sort((a, b) => a.valueOf() - b.valueOf());
  
  ganttState.daysWithJobsCache = result;
  return result;
}

// Render Gantt header with time scale
function renderGanttHeader() {
  const header = document.getElementById('gantt-time-header');
  if (!header) return;
  
  const timeScale = ganttState.timeScale;
  
  // Get only days that have jobs
  const daysWithJobs = getDaysWithJobs();
  
  if (daysWithJobs.length === 0) {
    header.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--pico-muted-color);">אין משימות לתצוגה</div>';
    return;
  }
  
  let headerHTML = '';
  
  // Two-line header: days on top, hours below
  const days = [];
  let cumulativePosition = 0;
  
  daysWithJobs.forEach((dayDate, index) => {
    const dayName = dayDate.format('ddd DD/MM');
    const dayWidth = 24 * GANTT_CONFIG.hourWidth;
    
    // Add day header
    days.push(`<div class="gantt-day-header" style="width: ${dayWidth}px; left: ${cumulativePosition}px; position: absolute;">${dayName}</div>`);
    
    // Add hours for this day
    const dayHours = [];
    for (let h = 0; h < 24; h++) {
      const hourWidth = GANTT_CONFIG.hourWidth;
      const hourPosition = cumulativePosition + (h * GANTT_CONFIG.hourWidth);
      dayHours.push(`<div class="gantt-hour-header" style="width: ${hourWidth}px; left: ${hourPosition}px; position: absolute; z-index: 10;">${h}</div>`);
    }
    headerHTML += dayHours.join('');
    
    cumulativePosition += dayWidth;
  });
  
  headerHTML = `
    <div class="gantt-days-row" style="position: relative;">${days.join('')}</div>
    <div class="gantt-hours-row" style="position: relative; height: 30px;">${headerHTML}</div>
  `;
  
  header.innerHTML = headerHTML;
  
  // Set header width to match grid width
  const totalWidth = getGanttWidth();
  header.style.width = totalWidth + 'px';
}

// Render Gantt tasks
function renderGanttTasks() {
  const taskNames = document.getElementById('gantt-task-names');
  const grid = document.getElementById('gantt-grid');
  
  if (!taskNames || !grid) return;
  
  // Get filtered and sorted jobs
  const jobs = getGanttJobs();
  
  let taskNamesHTML = '';
  let gridHTML = '';
  
  jobs.forEach((job, index) => {
    const taskName = job.title || 'ללא כותרת';
    const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
    const workersDisplay = workers.length > 0 ? workers.join(', ') : '';
    const factory = job.factory || '';
    
    // Task name panel
    taskNamesHTML += `
      <div class="gantt-task-row" style="height: ${GANTT_CONFIG.taskHeight}px;">
        <div class="gantt-task-name">${escapeHtml(taskName)}</div>
        <div class="gantt-task-details" style="font-size: 0.8em; opacity: 0.7;">${escapeHtml(workersDisplay)}</div>
      </div>
    `;
    
    // Task bar
    const taskBar = createGanttTaskBar(job, index);
    gridHTML += taskBar;
  });
  
  taskNames.innerHTML = taskNamesHTML;
  grid.innerHTML = gridHTML;
  
  // Set grid width based on time range
  const totalWidth = getGanttWidth();
  grid.style.width = totalWidth + 'px';
  
  // Add vertical grid lines for hours
  addVerticalGridLines(grid);
  
  // Add resize and drag handlers to task bars
  grid.querySelectorAll('.gantt-task-bar').forEach(bar => {
    bar.draggable = true;
    
    // Click handler for opening modal
    bar.addEventListener('click', (e) => {
      // Don't open modal if clicking on resize handles
      if (e.target.classList.contains('gantt-resize-handle')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const jobId = bar.dataset.jobId;
      const job = JOBS.find(j => j.id === jobId);
      if (job && typeof openJobModal === 'function') {
        openJobModal(job);
      }
    });
    
    // Drag start
    bar.addEventListener('dragstart', (e) => {
      // Prevent drag if clicking on resize handles
      if (e.target.classList.contains('gantt-resize-handle')) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', bar.dataset.jobId);
      bar.classList.add('dragging');
      // Store initial mouse position relative to the bar
      const rect = bar.getBoundingClientRect();
      e.dataTransfer.setData('text/offset', e.clientX - rect.left);
    });
    
    // Drag end
    bar.addEventListener('dragend', (e) => {
      bar.classList.remove('dragging');
    });
    
    // Add resize handlers
    const leftHandle = bar.querySelector('.gantt-resize-left');
    const rightHandle = bar.querySelector('.gantt-resize-right');
    
    if (leftHandle) {
      leftHandle.addEventListener('mousedown', (e) => startResize(e, bar, 'start'));
    }
    
    if (rightHandle) {
      rightHandle.addEventListener('mousedown', (e) => startResize(e, bar, 'end'));
    }
  });
  
  // Add drop zone handlers to grid (with throttling for performance)
  let dragoverThrottle = null;
  let gridRect = null;
  
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    
    // Throttle expensive operations to every 50ms
    if (dragoverThrottle) return;
    
    dragoverThrottle = setTimeout(() => {
      dragoverThrottle = null;
    }, 50);
    
    // Cache grid rect to avoid repeated getBoundingClientRect calls
    if (!gridRect) {
      gridRect = grid.getBoundingClientRect();
    }
    
    const offset = parseInt(e.dataTransfer.getData('text/offset')) || 0;
    const dropPosition = e.clientX - gridRect.left - offset;
    
    // Show drop position indicator
    let indicator = document.getElementById('gantt-drop-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'gantt-drop-indicator';
      indicator.style.cssText = `
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--pico-primary);
        pointer-events: none;
        z-index: 1000;
      `;
      grid.appendChild(indicator);
    }
    indicator.style.left = dropPosition + 'px';
  });
  
  // Handle drop
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    gridRect = null; // Reset cached rect
    
    const jobId = e.dataTransfer.getData('text/plain');
    const offset = parseInt(e.dataTransfer.getData('text/offset')) || 0;
    const dropPosition = e.clientX - grid.getBoundingClientRect().left - offset;
    const hourWidth = GANTT_CONFIG.hourWidth;
    const hours = Math.round(dropPosition / hourWidth);
    
    // Calculate new time based on compressed days
    const daysWithJobs = getDaysWithJobs();
    const cumulativeHours = hours;
    let newStartTime = null;
    let remainingHours = cumulativeHours;
    
    for (let i = 0; i < daysWithJobs.length; i++) {
      if (remainingHours < 24) {
        newStartTime = daysWithJobs[i].clone().add(remainingHours, 'hours');
        break;
      }
      remainingHours -= 24;
    }
    
    if (!newStartTime && daysWithJobs.length > 0) {
      newStartTime = daysWithJobs[daysWithJobs.length - 1].clone().add(remainingHours, 'hours');
    }
    
    // Update job time
    if (newStartTime) {
      const job = JOBS.find(j => j.id === jobId);
      if (job) {
        saveToUndoHistory('drag-gantt');
        const duration = dayjs(job.end).diff(dayjs(job.start), 'hours');
        job.start = newStartTime.format();
        job.end = newStartTime.add(duration, 'hours').format();
        
        // Only refresh Gantt, not entire app (performance)
        renderGantt();
        saveToLocalStorage();
      }
    }
    
    // Remove drop indicator
    const indicator = document.getElementById('gantt-drop-indicator');
    if (indicator) {
      indicator.remove();
    }
  });
  
  // Remove drop indicator when dragging leaves the grid
  grid.addEventListener('dragleave', (e) => {
    gridRect = null; // Reset cached rect
    const indicator = document.getElementById('gantt-drop-indicator');
    if (indicator) {
      indicator.remove();
    }
  });
  
  // Reset grid rect when drag ends
  grid.addEventListener('dragend', () => {
    gridRect = null;
  });
  
  // Auto-scroll to first task with delay to ensure rendering is complete
  setTimeout(() => {
    autoScrollToFirstTask();
  }, 500);
  
  // Show/hide empty state
  const emptyGantt = document.getElementById('emptyGantt');
  if (emptyGantt) {
    emptyGantt.style.display = jobs.length === 0 ? 'block' : 'none';
  }
}

// Get jobs for Gantt (filtered and sorted)
function getGanttJobs() {
  // Apply the same filters as the main view
  let jobs = JOBS.filter(passFilters);
  
  // Sort by start date
  jobs.sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return dayjs(a.start).valueOf() - dayjs(b.start).valueOf();
  });
  
  return jobs;
}

// Create task bar for Gantt
function createGanttTaskBar(job, index) {
  if (!job.start || !job.end) {
    return `<div class="gantt-task-row" style="height: ${GANTT_CONFIG.taskHeight}px;"></div>`;
  }
  
  const startTime = dayjs(job.start);
  const endTime = dayjs(job.end);
  
  if (!startTime.isValid() || !endTime.isValid()) {
    return `<div class="gantt-task-row" style="height: ${GANTT_CONFIG.taskHeight}px;"></div>`;
  }
  
  // Calculate position and width
  const position = calculateGanttTaskPosition(startTime);
  const width = calculateGanttTaskWidth(startTime, endTime);
  
  // Get conflicts and dependency issues from cache (performance optimization)
  if (!ganttState.conflictsCache) {
    ganttState.conflictsCache = recomputeConflicts();
  }
  if (!ganttState.depIssuesCache) {
    ganttState.depIssuesCache = recomputeDependencyIssues();
  }
  
  const conflicts = ganttState.conflictsCache;
  const depIssues = ganttState.depIssuesCache;
  const isConflict = conflicts.has(job.id);
  const isDepIssue = depIssues.has(job.id);
  const isFinished = job.finished;
  const isShabbat = jobTouchesShabbat(job);
  
  // Determine CSS classes
  let cssClasses = 'gantt-task-bar';
  if (isFinished) cssClasses += ' finished';
  if (isConflict) cssClasses += ' conflict';
  if (isDepIssue) cssClasses += ' dep-issue';
  if (isShabbat) cssClasses += ' shabbat';
  
  // Get color based on job properties
  const color = getGanttTaskColor(job);
  
  const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
  const workersDisplay = workers.length > 0 ? workers.join(', ') : '';
  
  return `
    <div class="gantt-task-row" style="height: ${GANTT_CONFIG.taskHeight}px;">
      <div 
        class="${cssClasses}" 
        style="
          left: ${position}px; 
          width: ${width}px; 
          background-color: ${color};
          border-color: ${color};
          top: 5px;
        "
        title="${escapeHtml(job.title || '')} - ${escapeHtml(workersDisplay)} (${fmt(job.start)} - ${fmt(job.end)})"
        data-job-id="${job.id}"
        data-workers="${escapeHtml(workersDisplay)}"
      >
        <div class="gantt-resize-handle gantt-resize-left" data-edge="start"></div>
        <span class="gantt-task-label">${escapeHtml(job.title || '')}</span>
        <div class="gantt-resize-handle gantt-resize-right" data-edge="end"></div>
      </div>
    </div>
  `;
}

// Calculate task position on Gantt (compressed to only show days with jobs)
function calculateGanttTaskPosition(startTime) {
  const daysWithJobs = getDaysWithJobs();
  if (daysWithJobs.length === 0) return 0;
  
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
  
  return cumulativeHours * GANTT_CONFIG.hourWidth;
}

// Calculate task width on Gantt
function calculateGanttTaskWidth(startTime, endTime) {
  const duration = endTime.diff(startTime, 'hours', true);
  return Math.max(20, duration * GANTT_CONFIG.hourWidth);
}

// Get task color based on job properties
function getGanttTaskColor(job) {
  // Get conflicts and dependency issues (same logic as other views)
  const conflicts = recomputeConflicts();
  const depIssues = recomputeDependencyIssues();
  const isConflict = conflicts.has(job.id);
  const isDepIssue = depIssues.has(job.id);
  const isFinished = job.finished;
  const isShabbat = jobTouchesShabbat(job);
  
  // Priority colors (same as table view)
  if (isConflict) {
    return '#dc3545'; // Red for conflicts
  }
  
  if (isDepIssue) {
    return '#ffc107'; // Yellow for dependency issues
  }
  
  if (isFinished) {
    return '#28a745'; // Green for finished tasks
  }
  
  if (isShabbat) {
    return '#ffc107'; // Yellow for Shabbat tasks
  }
  
  // Default color based on priority (keep existing logic)
  const priorityColors = {
    'נמוכה': '#45b7d1',
    'בינונית': '#4ecdc4', 
    'גבוהה': '#ff6b6b',
    'דחופה': '#ff9f43'
  };
  
  if (job.priority && priorityColors[job.priority]) {
    return priorityColors[job.priority];
  }
  
  // Default color based on factory (keep existing logic)
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

// Get Gantt width
function getGanttWidth() {
  const daysWithJobs = getDaysWithJobs();
  if (daysWithJobs.length === 0) return 0;
  
  // Width is number of displayed days * 24 hours * hour width
  return daysWithJobs.length * 24 * GANTT_CONFIG.hourWidth;
}

// Add vertical grid lines for hours (optimized for compressed days)
function addVerticalGridLines(grid) {
  // Remove existing grid lines
  grid.querySelectorAll('.gantt-vertical-line').forEach(line => line.remove());
  
  const daysWithJobs = getDaysWithJobs();
  if (daysWithJobs.length === 0) return;
  
  // Add a line for each hour in the displayed days
  let cumulativeHours = 0;
  
  daysWithJobs.forEach(dayDate => {
    for (let h = 0; h < 24; h++) {
      const position = (cumulativeHours + h) * GANTT_CONFIG.hourWidth;
      
      const line = document.createElement('div');
      line.className = 'gantt-vertical-line';
      line.style.cssText = `
        position: absolute;
        left: ${position}px;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--pico-muted-border-color);
        opacity: 0.3;
        pointer-events: none;
      `;
      grid.appendChild(line);
    }
    cumulativeHours += 24;
  });
}

// Auto-scroll to first task
let hasAutoScrolled = false;

function autoScrollToFirstTask() {
  if (hasAutoScrolled) {
    return;
  }
  
  const jobs = getGanttJobs();
  
  if (jobs.length === 0) {
    return;
  }
  
  // Find the earliest task
  const earliestTask = jobs
    .filter(job => job.start && job.end)
    .sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf())[0];
  
  if (earliestTask) {
    const startTime = dayjs(earliestTask.start);
    const position = calculateGanttTaskPosition(startTime);
    
    // Scroll both header and grid to the first task
    const headerPanel = document.querySelector('.gantt-right-panel');
    const gridContainer = document.querySelector('.gantt-grid-container');
    
    if (headerPanel && gridContainer) {
      // If task is at the very beginning, scroll to start
      let scrollPosition = 0;
      if (position > 0) {
        scrollPosition = Math.max(0, position - 100);
      }
      
      headerPanel.scrollLeft = scrollPosition;
      gridContainer.scrollLeft = scrollPosition;
      hasAutoScrolled = true;
    }
  }
}

// Update Gantt when data changes
function updateGantt() {
  if (document.getElementById('view-gantt')?.style.display !== 'none') {
    renderGantt();
  }
}

// Resize functionality
let resizeState = {
  isResizing: false,
  jobId: null,
  edge: null, // 'start' or 'end'
  startX: 0,
  originalStart: null,
  originalEnd: null
};

function startResize(e, bar, edge) {
  e.preventDefault();
  e.stopPropagation();
  
  const jobId = bar.dataset.jobId;
  const job = JOBS.find(j => j.id === jobId);
  
  if (!job) return;
  
  resizeState = {
    isResizing: true,
    jobId: jobId,
    edge: edge,
    startX: e.clientX,
    originalStart: dayjs(job.start),
    originalEnd: dayjs(job.end)
  };
  
  bar.classList.add('resizing');
  document.body.style.cursor = 'ew-resize';
  
  // Add global mouse move and mouse up listeners
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
}

function handleResize(e) {
  if (!resizeState.isResizing) return;
  
  const job = JOBS.find(j => j.id === resizeState.jobId);
  if (!job) return;
  
  // Calculate pixel difference
  const dx = e.clientX - resizeState.startX;
  const hourWidth = GANTT_CONFIG.hourWidth;
  const hoursDiff = Math.round(dx / hourWidth);
  
  if (resizeState.edge === 'start') {
    // Resize from the left (change start time)
    const newStart = resizeState.originalStart.clone().add(hoursDiff, 'hours');
    // Ensure start doesn't go past end (minimum 1 hour duration)
    if (newStart.isBefore(resizeState.originalEnd.clone().subtract(1, 'hour'))) {
      job.start = newStart.format();
      // Update the visual position without full re-render
      updateTaskBarPosition(job);
    }
  } else if (resizeState.edge === 'end') {
    // Resize from the right (change end time)
    const newEnd = resizeState.originalEnd.clone().add(hoursDiff, 'hours');
    // Ensure end doesn't go before start (minimum 1 hour duration)
    if (newEnd.isAfter(resizeState.originalStart.clone().add(1, 'hour'))) {
      job.end = newEnd.format();
      // Update the visual position without full re-render
      updateTaskBarPosition(job);
    }
  }
}

// Update task bar position without full re-render
function updateTaskBarPosition(job) {
  const bar = document.querySelector(`.gantt-task-bar[data-job-id="${job.id}"]`);
  if (!bar) return;
  
  const startTime = dayjs(job.start);
  const endTime = dayjs(job.end);
  
  if (!startTime.isValid() || !endTime.isValid()) return;
  
  const position = calculateGanttTaskPosition(startTime);
  const width = calculateGanttTaskWidth(startTime, endTime);
  
  bar.style.left = position + 'px';
  bar.style.width = width + 'px';
}

function stopResize(e) {
  if (!resizeState.isResizing) return;
  
  const bar = document.querySelector(`.gantt-task-bar[data-job-id="${resizeState.jobId}"]`);
  if (bar) {
    bar.classList.remove('resizing');
  }
  
  document.body.style.cursor = '';
  
  // Remove global listeners
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  
  // Save changes and refresh all views
  if (resizeState.isResizing) {
    refreshAll();
  }
  
  resizeState = {
    isResizing: false,
    jobId: null,
    edge: null,
    startX: 0,
    originalStart: null,
    originalEnd: null
  };
}

// Initialize Gantt when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Gantt will be initialized when the tab is clicked
});
