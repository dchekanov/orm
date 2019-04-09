const {Pool} = require('pg');
const pool = new Pool();

pool.logger = console;
pool.on('error', err => pool.logger.error(err));

module.exports = pool;

