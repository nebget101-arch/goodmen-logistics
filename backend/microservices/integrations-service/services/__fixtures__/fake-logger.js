'use strict';

// Silent logger used by unit tests to avoid console output while still
// honoring the `.info/.warn/.error` surface consumed by the code under test.
module.exports = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};
