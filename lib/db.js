const builder = require('mongo-sql');
const convertKeys = require('./convert-keys');

module.exports = {
  logger: console,
  /**
   * Build a query.
   * @param {object} [querySpec={}]
   * @returns {{query: string, toString, original: Object, toQuery, values: Array}|result}
   */
  buildQuery: function(querySpec = {}) {
    if (querySpec.type === 'select' && !querySpec.columns) querySpec.columns = ['*'];

    ['values', 'where', 'order'].forEach(k => querySpec[k] = convertKeys.toRow(querySpec[k]));

    if (querySpec.with) {
      Object.keys(querySpec.with).forEach(k => {
        ['values', 'where', 'order'].forEach(kk => querySpec.with[k][kk] = convertKeys.toRow(querySpec.with[k][kk]));
      });
    }

    return builder.sql(querySpec);
  },
  /**
   * Execute a query.
   * @example
   * query('SELECT * FROM users');
   * query('SELECT * FROM users WHERE id = $1', [id], {log: false});
   * query(buildQuery({type: 'select', table: 'users', where: {id: 'id'}}))
   * @returns {Promise}
   */
  query: function() {
    let query, values, execOpts;

    if (typeof arguments[0] === 'string') {
      // clean up query string from new lines and extra spaces for easier debugging
      query = arguments[0].trim().replace(/\n/g, '').replace(/\s{2,}/g, ' ');

      if (Array.isArray(arguments[1]) || arguments.length === 3) {
        values = arguments[1];
        execOpts = arguments[2];
      } else {
        execOpts = arguments[1];
      }
    } else {
      query = arguments[0].toString();
      values = arguments[0].values;
      execOpts = arguments[1];
    }

    if (!execOpts) execOpts = {};

    const gotClient = execOpts.client ?
      Promise.resolve(execOpts.client) :
      execOpts.pool ?
        execOpts.pool.connect() :
        this.defaultPool.connect();

    return gotClient.then(client => {
      const shouldLogQuery = this.logger.queryStart && this.logger.queryEnd && execOpts.log !== false;
      const startLogged = Promise.resolve(shouldLogQuery ? this.logger.queryStart(query, values, execOpts) : undefined);

      return client.query(query, values)
        .then(r => {
          const now = new Date();

          if (shouldLogQuery) startLogged.then(queryLogId => this.logger.queryEnd(queryLogId, now, execOpts));
          if (!execOpts.client) client.release();

          return r;
        })
        .catch(err => {
          if (!execOpts.client) client.release();

          return Promise.reject(err);
        });
    });
  },
  /**
   * Execute a function with multiple queries under a single transaction.
   * @param {Function} f
   * @param {Object} [execOpts={}]
   * @throws TypeError A function to execute must be passed.
   * @returns {Promise}
   */
  transact: function(f, execOpts = {}) {
    if (typeof f !== 'function') throw new TypeError('f argument is not a function');
    // just execute the function when already within a transaction
    if (execOpts.client) return f(execOpts);

    const pool = execOpts.pool || this.defaultPool;

    return pool.connect().then(client => {
      const op = execOpts.op;

      execOpts.client = client;

      return this.query('BEGIN', execOpts)
        .then(() => f(execOpts))
        .then(result => {
          // restore op in case the executed function changed it
          execOpts.op = op;

          return this.query('COMMIT', execOpts).then(() => {
            client.release();
            // just in case if the same execOpts would be used for another query
            delete execOpts.client;

            return result;
          });
        })
        .catch(err => {
          function releaseAndThrow(err) {
            client.release();
            delete execOpts.client;
            throw err;
          }

          return this.query('ROLLBACK', execOpts).catch(releaseAndThrow).then(() => releaseAndThrow(err));
        });
    });
  }
};
