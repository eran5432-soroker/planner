/**
 * Date utility functions for Hebrew Factory Planning App
 * All dates use Asia/Jerusalem timezone
 * Note: Requires TZ constant to be defined in main script
 */

/**
 * Convert date to local timezone
 * @param {string|Date} dt - Date to convert
 * @returns {dayjs.Dayjs} Date in local timezone
 */
function toLocal(dt) {
  return dayjs.tz(dt, TZ);
}

/**
 * Format date to display string (YYYY-MM-DD HH:mm)
 * @param {string|Date} dt - Date to format
 * @returns {string} Formatted date string
 */
function fmt(dt) {
  if (!dt) return '';
  const date = toLocal(dt);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '';
}

/**
 * Calculate duration between two dates
 * @param {string|Date} start - Start date
 * @param {string|Date} end - End date
 * @returns {string} Duration in "Xh Ym" format
 */
function durationStr(start, end) {
  if (!start || !end) return '';
  const startDate = dayjs(start);
  const endDate = dayjs(end);
  if (!startDate.isValid() || !endDate.isValid()) return '';
  const mins = endDate.diff(startDate, 'minute');
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Round time to nearest 15 minutes
 * @param {string} dateStr - Date string to round
 * @returns {string} Rounded date in YYYY-MM-DDTHH:mm format
 */
function roundTo15(dateStr) {
  if (!dateStr) return dateStr;
  const d = dayjs(dateStr);
  const m = d.minute();
  const rounded = Math.round(m / 15) * 15;
  return d.minute(rounded).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
}

/**
 * Check if a date is during Shabbat
 * @param {string|Date} dt - Date to check
 * @returns {boolean} True if date is during Shabbat
 */
function isShabbat(dt) {
  const d = dayjs(dt);
  const wd = d.day(); // 0=Sun ... 5=Fri 6=Sat
  if (wd === 6) return true; // Saturday
  if (wd === 5 && d.hour() >= 18) return true; // Friday 18:00+
  return false;
}

/**
 * Check if a job spans Shabbat
 * @param {Object} job - Job with start and end dates
 * @returns {boolean} True if job touches Shabbat
 */
function jobTouchesShabbat(job) {
  if (!job.start || !job.end) return false;
  const startDate = dayjs(job.start);
  const endDate = dayjs(job.end);
  if (!startDate.isValid() || !endDate.isValid()) return false;
  return isShabbat(job.start) || isShabbat(job.end) || 
         (startDate.day() === 5 && endDate.day() === 6);
}

/**
 * Check if two time ranges overlap
 * @param {string|Date} aStart - First range start
 * @param {string|Date} aEnd - First range end
 * @param {string|Date} bStart - Second range start
 * @param {string|Date} bEnd - Second range end
 * @returns {boolean} True if ranges overlap
 */
function isOverlap(aStart, aEnd, bStart, bEnd) {
  return dayjs(aStart).isBefore(dayjs(bEnd)) && dayjs(bStart).isBefore(dayjs(aEnd));
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toLocal,
    fmt,
    durationStr,
    roundTo15,
    isShabbat,
    jobTouchesShabbat,
    isOverlap
  };
}

