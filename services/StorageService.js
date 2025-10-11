/**
 * LocalStorage service for persisting application data
 */

class StorageService {
  constructor() {
    this.STORAGE_KEY = 'jobs.v1';
    this.COLUMN_VISIBILITY_KEY = 'columnVisibility';
    this.THEME_KEY = 'theme';
  }

  /**
   * Save jobs and related data to localStorage
   * @param {Object} data - Data object containing jobs, factories, workers, etc.
   */
  saveData(data) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Error saving to localStorage:', error);
      return false;
    }
  }

  /**
   * Load jobs and related data from localStorage
   * @returns {Object|null} Loaded data or null if not found
   */
  loadData() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      return null;
    }
  }

  /**
   * Save column visibility settings
   * @param {Object} columnVisibility - Column visibility object
   */
  saveColumnVisibility(columnVisibility) {
    try {
      localStorage.setItem(this.COLUMN_VISIBILITY_KEY, JSON.stringify(columnVisibility));
      return true;
    } catch (error) {
      console.error('Error saving column visibility:', error);
      return false;
    }
  }

  /**
   * Load column visibility settings
   * @returns {Object|null} Column visibility object or null
   */
  loadColumnVisibility() {
    try {
      const saved = localStorage.getItem(this.COLUMN_VISIBILITY_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('Error loading column visibility:', error);
      return null;
    }
  }

  /**
   * Save theme preference
   * @param {string} theme - Theme name ('dark' or 'light')
   */
  saveTheme(theme) {
    try {
      localStorage.setItem(this.THEME_KEY, theme);
      return true;
    } catch (error) {
      console.error('Error saving theme:', error);
      return false;
    }
  }

  /**
   * Load theme preference
   * @returns {string} Theme name or default 'dark'
   */
  loadTheme() {
    try {
      return localStorage.getItem(this.THEME_KEY) || 'dark';
    } catch (error) {
      console.error('Error loading theme:', error);
      return 'dark';
    }
  }

  /**
   * Clear all stored data
   */
  clearAll() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Error clearing localStorage:', error);
      return false;
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageService;
}

