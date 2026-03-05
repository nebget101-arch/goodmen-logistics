const path = require('path');

function requireFromRoot(moduleName) {
  try {
    const resolvedPath = require.resolve(moduleName, { paths: [process.cwd()] });
    return require(resolvedPath);
  } catch (err) {
    return require(moduleName);
  }
}

module.exports = requireFromRoot;

