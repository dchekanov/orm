const {Pool} = require('pg');

/**
 * Replace the old default pool with a new one.
 */
function reset() {
  const pool = new Pool();
  const {current} = module.exports;

  if (current) {
    if (!(current.ended || current.ending)) current.end().catch(err => current.logger.error(err));
    pool.logger = current.logger;
  } else {
    pool.logger = console;
  }

  pool.on('error', err => pool.logger.error(err));
  module.exports.current = pool;
}

reset();

module.exports.reset = reset;
