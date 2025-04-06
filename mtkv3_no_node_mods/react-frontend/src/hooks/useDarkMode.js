// src/hooks/useDarkMode.js
import { useState, useEffect, useCallback } from 'react';

/**
 * Manages dark mode state compatible with Tailwind's 'class' strategy.
 * Toggles the 'dark' class on the <html> element and persists the choice.
 * @returns {[boolean, Function]} A tuple: [isDarkModeEnabled, toggleDarkMode]
 */
export const useDarkMode = () => {
  const getInitialMode = () => {
    // Check localStorage first
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode) {
      return savedMode === 'enabled';
    }
    // Fallback to system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    // Default to light mode
    return false;
  };

  const [darkMode, setDarkMode] = useState(getInitialMode);

  useEffect(() => {
    const root = window.document.documentElement;
    // Add/remove 'dark' class based on state
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Save preference to localStorage
    localStorage.setItem('darkMode', darkMode ? 'enabled' : 'disabled');
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prevMode => !prevMode);
  }, []); // useCallback ensures the function identity is stable

  return [darkMode, toggleDarkMode];
};