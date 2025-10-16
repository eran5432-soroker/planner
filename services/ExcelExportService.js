// Excel Export Service
// Handles export of tasks to Excel with multiple sheets: Tasks, Timeline, and Gantt

const ExcelExportService = {
  /**
   * Main export function that creates an Excel file with 3 tabs
   * @param {Array} jobs - Array of all jobs to export
   * @param {Function} formatDate - Date formatting function
   * @param {Function} formatDuration - Duration formatting function
   */
  exportToExcel(jobs, formatDate, formatDuration) {
    if (typeof XLSX === 'undefined') {
      alert('ספריית ייצוא Excel לא נטענה. אנא רענן את הדף ונסה שוב.');
      return;
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Add the three sheets
    const tasksSheet = this.generateTasksSheet(jobs, formatDate, formatDuration);
    XLSX.utils.book_append_sheet(wb, tasksSheet, 'משימות');

    const timelineSheet = this.generateTimelineSheet(jobs);
    XLSX.utils.book_append_sheet(wb, timelineSheet, 'ציר זמן');

    const ganttSheet = this.generateGanttSheet(jobs);
    XLSX.utils.book_append_sheet(wb, ganttSheet, 'גאנט');

    // Write file
    XLSX.writeFile(wb, 'factory-jobs.xlsx');
  },

  /**
   * Generate Tasks sheet (traditional list format)
   */
  generateTasksSheet(jobs, formatDate, formatDuration) {
    const rows = jobs.map(j => {
      const depInfo = j.dependsOn ? jobs.find(dj => dj.id === j.dependsOn) : null;
      const workers = Array.isArray(j.workers) ? j.workers : (j.worker ? [j.worker] : []);
      const workersStr = workers.join(', ');
      
      return {
        'משימה': j.title,
        'מפעל': j.factory,
        'עובד מבצע': workersStr,
        'מפקח עבודה': j.factoryManager,
        'מנהל עבודה': j.maintenanceManager,
        'עדיפות': j.priority,
        'מספר ציוד': j.equipmentNumber,
        'קריאת שירות': j.serviceCall,
        'מחלקה מבצעת': j.department,
        'התחלה': formatDate(j.start),
        'סיום': formatDate(j.end),
        'משך': formatDuration(j.start, j.end),
        'תלוי ב': depInfo ? depInfo.title : '',
        'הערות': j.notes
      };
    });

    return XLSX.utils.json_to_sheet(rows);
  },

  /**
   * Generate Timeline sheet (hourly time-grid)
   */
  generateTimelineSheet(jobs) {
    // Get jobs with valid dates
    const validJobs = this.getTasksWithDates(jobs);
    
    if (validJobs.length === 0) {
      // Return empty sheet with message
      return XLSX.utils.aoa_to_sheet([['אין משימות עם תאריכים']]);
    }

    // Get all unique hours where tasks exist
    const hours = this.getUniqueHours(validJobs);
    
    if (hours.length === 0) {
      return XLSX.utils.aoa_to_sheet([['אין שעות לתצוגה']]);
    }

    // Group hours by date
    const hoursByDate = this.groupHoursByDate(hours);

    // Build date header row (row 1)
    const dateHeaderRow = ['משימה', 'מפעל', 'עובדים'];
    hoursByDate.forEach(dateGroup => {
      dateHeaderRow.push(dateGroup.date);
      // Add empty cells for remaining hours of this date
      for (let i = 1; i < dateGroup.hours.length; i++) {
        dateHeaderRow.push('');
      }
    });

    // Build hour header row (row 2)
    const hourHeaderRow = ['', '', ''];
    hoursByDate.forEach(dateGroup => {
      dateGroup.hours.forEach(hour => {
        hourHeaderRow.push(hour.format('HH:mm'));
      });
    });

    // Build data rows
    const dataRows = [dateHeaderRow, hourHeaderRow];
    const jobMerges = []; // Track merge ranges for jobs
    
    validJobs.forEach((job, jobIndex) => {
      const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
      const workersStr = workers.join(', ');
      
      const row = [
        job.title || '',
        job.factory || '',
        workersStr
      ];
      
      // Track active cell ranges for merging
      let mergeStart = -1;
      
      hours.forEach((hour, hourIndex) => {
        const isActive = this.isTaskActiveInHour(job, hour);
        
        if (isActive) {
          if (mergeStart === -1) {
            // Start of a new active range
            mergeStart = hourIndex;
          }
          row.push('✓');
        } else {
          if (mergeStart !== -1) {
            // End of active range, record merge
            jobMerges.push({
              row: jobIndex + 2, // +2 for header rows
              startCol: mergeStart + 3, // +3 for first 3 columns
              endCol: hourIndex + 3 - 1,
              jobTitle: job.title || ''
            });
            mergeStart = -1;
          }
          row.push('');
        }
      });
      
      // Handle case where job is active until the end
      if (mergeStart !== -1) {
        jobMerges.push({
          row: jobIndex + 2,
          startCol: mergeStart + 3,
          endCol: hours.length + 3 - 1,
          jobTitle: job.title || ''
        });
      }
      
      dataRows.push(row);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(dataRows);

    // Apply styling and merging
    this.styleTimelineSheet(ws, hoursByDate, validJobs.length + 2, jobMerges);

    return ws;
  },

  /**
   * Generate Gantt sheet (daily time-grid)
   */
  generateGanttSheet(jobs) {
    // Get jobs with valid dates
    const validJobs = this.getTasksWithDates(jobs);
    
    if (validJobs.length === 0) {
      // Return empty sheet with message
      return XLSX.utils.aoa_to_sheet([['אין משימות עם תאריכים']]);
    }

    // Get all unique days where tasks exist
    const days = this.getUniqueDays(validJobs);
    
    if (days.length === 0) {
      return XLSX.utils.aoa_to_sheet([['אין ימים לתצוגה']]);
    }

    // Build date header row (row 1) - group by date with hours
    const dateHeaderRow = ['משימה', 'מפעל', 'עובדים'];
    days.forEach(day => {
      // Add 24 hour slots for each day
      dateHeaderRow.push(this.formatDate(day));
      for (let i = 1; i < 24; i++) {
        dateHeaderRow.push(''); // Empty cells that will be merged
      }
    });

    // Build hour header row (row 2)
    const hourHeaderRow = ['', '', ''];
    days.forEach(day => {
      // Add hours 0-23 for each day
      for (let h = 0; h < 24; h++) {
        hourHeaderRow.push(h.toString().padStart(2, '0') + ':00');
      }
    });

    // Build data rows
    const dataRows = [dateHeaderRow, hourHeaderRow];
    const jobMerges = []; // Track merge ranges for jobs
    
    validJobs.forEach((job, jobIndex) => {
      const workers = Array.isArray(job.workers) ? job.workers : (job.worker ? [job.worker] : []);
      const workersStr = workers.join(', ');
      
      const row = [
        job.title || '',
        job.factory || '',
        workersStr
      ];
      
      // Track active cell ranges for merging (now hourly across all days)
      let mergeStart = -1;
      let hourIndex = 0;
      
      days.forEach((day) => {
        // Check each hour of this day
        for (let h = 0; h < 24; h++) {
          const hourTime = day.clone().hour(h);
          const isActive = this.isTaskActiveInHour(job, hourTime);
          
          if (isActive) {
            if (mergeStart === -1) {
              // Start of a new active range
              mergeStart = hourIndex;
            }
            row.push('✓');
          } else {
            if (mergeStart !== -1) {
              // End of active range, record merge
              jobMerges.push({
                row: jobIndex + 2, // +2 for header rows
                startCol: mergeStart + 3, // +3 for first 3 columns
                endCol: hourIndex + 3 - 1,
                jobTitle: job.title || ''
              });
              mergeStart = -1;
            }
            row.push('');
          }
          hourIndex++;
        }
      });
      
      // Handle case where job is active until the end
      if (mergeStart !== -1) {
        jobMerges.push({
          row: jobIndex + 2, // +2 for header rows
          startCol: mergeStart + 3,
          endCol: hourIndex + 3 - 1,
          jobTitle: job.title || ''
        });
      }
      
      dataRows.push(row);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(dataRows);

    // Apply styling
    this.styleGanttSheet(ws, days.length, validJobs.length + 2, jobMerges);

    return ws;
  },

  /**
   * Get all jobs that have valid start and end dates
   */
  getTasksWithDates(jobs) {
    return jobs
      .filter(job => {
        if (!job.start || !job.end) return false;
        const start = dayjs(job.start);
        const end = dayjs(job.end);
        return start.isValid() && end.isValid();
      })
      .sort((a, b) => {
        return dayjs(a.start).valueOf() - dayjs(b.start).valueOf();
      });
  },

  /**
   * Get sorted array of all unique hours where tasks exist
   */
  getUniqueHours(jobs) {
    const hoursSet = new Set();
    
    jobs.forEach(job => {
      const start = dayjs(job.start);
      const end = dayjs(job.end);
      
      // Add all hours between start and end
      let current = start.clone().startOf('hour');
      const endHour = end.clone().startOf('hour');
      
      while (current.isSameOrBefore(endHour)) {
        hoursSet.add(current.valueOf());
        current = current.add(1, 'hour');
      }
    });
    
    // Convert to sorted array of dayjs objects
    return Array.from(hoursSet)
      .map(timestamp => dayjs(timestamp))
      .sort((a, b) => a.valueOf() - b.valueOf());
  },

  /**
   * Get sorted array of all unique days where tasks exist
   */
  getUniqueDays(jobs) {
    const daysSet = new Set();
    
    jobs.forEach(job => {
      const start = dayjs(job.start);
      const end = dayjs(job.end);
      
      // Add all days between start and end
      let current = start.clone().startOf('day');
      const endDay = end.clone().startOf('day');
      
      while (current.isSameOrBefore(endDay)) {
        daysSet.add(current.format('YYYY-MM-DD'));
        current = current.add(1, 'day');
      }
    });
    
    // Convert to sorted array of dayjs objects
    return Array.from(daysSet)
      .map(dateStr => dayjs(dateStr))
      .sort((a, b) => a.valueOf() - b.valueOf());
  },

  /**
   * Check if a task is active during a specific hour
   */
  isTaskActiveInHour(job, hourDate) {
    const start = dayjs(job.start);
    const end = dayjs(job.end);
    const hourStart = hourDate.clone().startOf('hour');
    const hourEnd = hourDate.clone().endOf('hour');
    
    // Task is active if it overlaps with this hour
    return start.isBefore(hourEnd) && end.isAfter(hourStart);
  },

  /**
   * Check if a task is active during a specific day
   */
  isTaskActiveInDay(job, dayDate) {
    const start = dayjs(job.start);
    const end = dayjs(job.end);
    const dayStart = dayDate.clone().startOf('day');
    const dayEnd = dayDate.clone().endOf('day');
    
    // Task is active if it overlaps with this day
    return start.isBefore(dayEnd) && end.isAfter(dayStart);
  },

  /**
   * Format date-time for hourly columns (YYYY-MM-DD HH:mm)
   */
  formatDateTime(date) {
    return date.format('YYYY-MM-DD HH:mm');
  },

  /**
   * Format date for daily columns (YYYY-MM-DD)
   */
  formatDate(date) {
    return date.format('YYYY-MM-DD');
  },

  /**
   * Group hours by date for 2-row header
   */
  groupHoursByDate(hours) {
    const grouped = [];
    let currentDate = null;
    let currentGroup = null;

    hours.forEach(hour => {
      const dateStr = hour.format('YYYY-MM-DD');
      
      if (dateStr !== currentDate) {
        if (currentGroup) {
          grouped.push(currentGroup);
        }
        currentDate = dateStr;
        currentGroup = {
          date: dateStr,
          hours: [hour]
        };
      } else {
        currentGroup.hours.push(hour);
      }
    });

    if (currentGroup) {
      grouped.push(currentGroup);
    }

    return grouped;
  },

  /**
   * Apply styling to Timeline sheet (2-row header with merges and colors)
   */
  styleTimelineSheet(ws, hoursByDate, totalRows, jobMerges) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    
    // Initialize merge array if not exists
    if (!ws['!merges']) ws['!merges'] = [];

    // Merge cells in date header row
    let colIndex = 3; // Start after first 3 columns (משימה, מפעל, עובדים)
    hoursByDate.forEach(dateGroup => {
      if (dateGroup.hours.length > 1) {
        // Merge cells for this date
        ws['!merges'].push({
          s: { r: 0, c: colIndex },
          e: { r: 0, c: colIndex + dateGroup.hours.length - 1 }
        });
      }
      colIndex += dateGroup.hours.length;
    });

    // Apply header styling
    const headerFill = { patternType: 'solid', fgColor: { rgb: '4472C4' } };
    const headerFont = { bold: true, color: { rgb: 'FFFFFF' } };
    const headerAlignment = { horizontal: 'center', vertical: 'center' };

    // Style first 3 columns header (merge rows 0 and 1)
    for (let c = 0; c < 3; c++) {
      ws['!merges'].push({
        s: { r: 0, c: c },
        e: { r: 1, c: c }
      });
      
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: headerFill,
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Style date headers (row 0, columns 3+)
    for (let c = 3; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: headerFill,
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Style hour headers (row 1, columns 3+)
    for (let c = 3; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 1, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: { patternType: 'solid', fgColor: { rgb: '8EA9DB' } },
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Style data cells (apply colors for active cells)
    const activeFill = { patternType: 'solid', fgColor: { rgb: '70AD47' } }; // Green
    const inactiveFill = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }; // White
    const activeFont = { bold: true, color: { rgb: 'FFFFFF' } }; // White bold text for job names
    
    // First pass: Initialize and style ALL cells first
    for (let r = 2; r < totalRows; r++) {
      for (let c = 0; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
        
        // Ensure cell exists
        if (!ws[cellRef]) {
          ws[cellRef] = { v: '', t: 's' };
        }
        
        // Apply default white background with borders to all cells
        ws[cellRef].s = {
          fill: inactiveFill,
          font: {},
          alignment: { horizontal: 'center', vertical: 'center' },
          border: this.getBorder()
        };
        
        // Clear any existing value
        if (ws[cellRef].v === '✓') {
          ws[cellRef].v = '';
        }
      }
    }
    
    // Second pass: Color cells that are part of jobs (from jobMerges)
    // MUST ensure all cells in merge range exist and are styled
    jobMerges.forEach(merge => {
      for (let c = merge.startCol; c <= merge.endCol; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: merge.row, c: c });
        
        // Force create cell if it doesn't exist
        if (!ws[cellRef]) {
          ws[cellRef] = { v: '', t: 's' };
        }
        
        // Apply full green styling with borders
        ws[cellRef].s = {
          fill: activeFill,
          font: {},
          alignment: { horizontal: 'center', vertical: 'center' },
          border: this.getBorder()
        };
      }
    });

    // Third pass: Add job titles and merge cells (after styling is applied)
    jobMerges.forEach(merge => {
      // Set job title in the first cell (always, even for single cells)
      const cellRef = XLSX.utils.encode_cell({ r: merge.row, c: merge.startCol });
      ws[cellRef].v = merge.jobTitle;
      
      // Apply full styling to job title cell (recreate style to avoid reference issues)
      ws[cellRef].s = {
        fill: activeFill,
        font: activeFont,
        alignment: { horizontal: 'center', vertical: 'center' },
        border: this.getBorder()
      };
      
      if (merge.startCol < merge.endCol) {
        // Only merge if there's more than one cell
        ws['!merges'].push({
          s: { r: merge.row, c: merge.startCol },
          e: { r: merge.row, c: merge.endCol }
        });
      }
    });

    // Set column widths
    ws['!cols'] = [];
    ws['!cols'][0] = { wch: 30 }; // משימה
    ws['!cols'][1] = { wch: 20 }; // מפעל
    ws['!cols'][2] = { wch: 20 }; // עובדים
    for (let c = 3; c <= range.e.c; c++) {
      ws['!cols'][c] = { wch: 6 }; // Hours
    }

    // Set row heights
    ws['!rows'] = [];
    ws['!rows'][0] = { hpx: 25 }; // Date header
    ws['!rows'][1] = { hpx: 25 }; // Hour header
  },

  /**
   * Apply styling to Gantt sheet (with colors and 2-row header)
   */
  styleGanttSheet(ws, daysCount, totalRows, jobMerges) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    
    // Initialize merge array if not exists
    if (!ws['!merges']) ws['!merges'] = [];

    // Apply header styling
    const headerFill = { patternType: 'solid', fgColor: { rgb: '4472C4' } };
    const headerFont = { bold: true, color: { rgb: 'FFFFFF' } };
    const headerAlignment = { horizontal: 'center', vertical: 'center' };

    // Style first 3 columns header (merge rows 0 and 1)
    for (let c = 0; c < 3; c++) {
      ws['!merges'].push({
        s: { r: 0, c: c },
        e: { r: 1, c: c }
      });
      
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: headerFill,
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Merge date headers (one date spans 24 hour columns)
    let colIndex = 3;
    while (colIndex <= range.e.c) {
      // Each date header should span 24 columns (24 hours)
      if (colIndex + 23 <= range.e.c) {
        ws['!merges'].push({
          s: { r: 0, c: colIndex },
          e: { r: 0, c: colIndex + 23 }
        });
      }
      colIndex += 24;
    }

    // Style date headers (row 0, columns 3+)
    for (let c = 3; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: headerFill,
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Style hour headers (row 1, columns 3+)
    for (let c = 3; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 1, c: c });
      if (!ws[cellRef]) {
        ws[cellRef] = { v: '', t: 's' };
      }
      ws[cellRef].s = {
        fill: { patternType: 'solid', fgColor: { rgb: '8EA9DB' } },
        font: headerFont,
        alignment: headerAlignment,
        border: this.getBorder()
      };
    }

    // Style data cells (apply colors for active cells)
    const activeFill = { patternType: 'solid', fgColor: { rgb: '70AD47' } }; // Green
    const inactiveFill = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }; // White
    const activeFont = { bold: true, color: { rgb: 'FFFFFF' } }; // White bold text for job names
    
    // First pass: Initialize and style ALL cells first
    for (let r = 2; r < totalRows; r++) {
      for (let c = 0; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
        
        // Ensure cell exists
        if (!ws[cellRef]) {
          ws[cellRef] = { v: '', t: 's' };
        }
        
        // Apply default white background with borders to all cells
        ws[cellRef].s = {
          fill: inactiveFill,
          font: {},
          alignment: { horizontal: 'center', vertical: 'center' },
          border: this.getBorder()
        };
        
        // Clear any existing value
        if (ws[cellRef].v === '✓') {
          ws[cellRef].v = '';
        }
      }
    }
    
    // Second pass: Color cells that are part of jobs (from jobMerges)
    // MUST ensure all cells in merge range exist and are styled
    jobMerges.forEach(merge => {
      for (let c = merge.startCol; c <= merge.endCol; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: merge.row, c: c });
        
        // Force create cell if it doesn't exist
        if (!ws[cellRef]) {
          ws[cellRef] = { v: '', t: 's' };
        }
        
        // Apply full green styling with borders
        ws[cellRef].s = {
          fill: activeFill,
          font: {},
          alignment: { horizontal: 'center', vertical: 'center' },
          border: this.getBorder()
        };
      }
    });

    // Third pass: Add job titles and merge cells (after styling is applied)
    jobMerges.forEach(merge => {
      // Set job title in the first cell (always, even for single cells)
      const cellRef = XLSX.utils.encode_cell({ r: merge.row, c: merge.startCol });
      ws[cellRef].v = merge.jobTitle;
      
      // Apply full styling to job title cell (recreate style to avoid reference issues)
      ws[cellRef].s = {
        fill: activeFill,
        font: activeFont,
        alignment: { horizontal: 'center', vertical: 'center' },
        border: this.getBorder()
      };
      
      if (merge.startCol < merge.endCol) {
        // Only merge if there's more than one cell
        ws['!merges'].push({
          s: { r: merge.row, c: merge.startCol },
          e: { r: merge.row, c: merge.endCol }
        });
      }
    });

    // Set column widths
    ws['!cols'] = [];
    ws['!cols'][0] = { wch: 30 }; // משימה
    ws['!cols'][1] = { wch: 20 }; // מפעל
    ws['!cols'][2] = { wch: 20 }; // עובדים
    for (let c = 3; c <= range.e.c; c++) {
      ws['!cols'][c] = { wch: 6 }; // Hours (same width as Timeline)
    }

    // Set row heights
    ws['!rows'] = [];
    ws['!rows'][0] = { hpx: 25 }; // Date header
    ws['!rows'][1] = { hpx: 25 }; // Hour header
  },

  /**
   * Get border style for cells
   */
  getBorder() {
    return {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } }
    };
  }
};

// Make available globally
window.ExcelExportService = ExcelExportService;

