const requireFromRoot = require('../internal/require-from-root');
const knex = requireFromRoot('knex');
const knexfile = require('../../goodmen-database/knexfile');

const environment = process.env.NODE_ENV || 'development';
const config = knexfile[environment];

module.exports = knex(config);
