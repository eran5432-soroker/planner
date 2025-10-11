/**
 * Undo/Redo service for managing action history
 */

class UndoService {
  constructor(maxHistory = 20) {
    this.history = [];
    this.maxHistory = maxHistory;
  }

  /**
   * Save current state to history
   * @param {Object} state - State object to save
   * @param {string} action - Action name for reference
   */
  saveState(state, action = 'modify') {
    const snapshot = {
      action,
      timestamp: Date.now(),
      state: JSON.parse(JSON.stringify(state))
    };

    this.history.push(snapshot);

    // Keep only last maxHistory items
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Get the previous state
   * @returns {Object|null} Previous state or null if no history
   */
  undo() {
    if (this.history.length === 0) {
      return null;
    }
    return this.history.pop();
  }

  /**
   * Check if undo is available
   * @returns {boolean} True if there is history to undo
   */
  canUndo() {
    return this.history.length > 0;
  }

  /**
   * Get the number of states in history
   * @returns {number} History count
   */
  getHistoryCount() {
    return this.history.length;
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Get history summary (for debugging)
   * @returns {Array} Array of action summaries
   */
  getHistorySummary() {
    return this.history.map(item => ({
      action: item.action,
      timestamp: new Date(item.timestamp).toLocaleString('he-IL')
    }));
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UndoService;
}

