const requireFromRoot = require('../internal/require-from-root');
const knex = requireFromRoot('knex');
const knexfile = require('../../goodmen-database/knexfile');

const rawEnvironment = (process.env.NODE_ENV || 'development').toString().trim().toLowerCase();
const normalizedEnvironment = rawEnvironment === 'dev' ? 'development' : rawEnvironment;
const environment = knexfile[normalizedEnvironment] ? normalizedEnvironment : 'development';
const config = knexfile[environment];

module.exports = knex(config);
