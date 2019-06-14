const builder = require('mongo-sql');
const convertKeys = require('./convert-keys');
const defaultPool = require('./default-pool');

module.exports = {
  logger: console.error,
  /**
   * Build a query.
   * @param {object} [query={}]
   * @returns {{query: string, toString, original: Object, toQuery, values: Array}|result}
   */
  buildQuery: function(query = {}) {
    if (query.type === 'select' && !query.columns) query.columns = ['*'];

    ['values', 'where', 'order'].forEach(k => query[k] = convertKeys.toRow(query[k]));

    if (query.with) {
      Object.keys(query.with).forEach(k => {
        ['values', 'where', 'order'].forEach(kk => query.with[k][kk] = convertKeys.toRow(query.with[k][kk]));
      });
    }

    return builder.sql(query);
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
    let query, values, options;

    if (typeof arguments[0] === 'string') {
      // clean up query string from new lines and extra spaces for easier debugging
      query = arguments[0].trim().replace(/\n/g, '').replace(/\s{2,}/g, ' ');

      if (Array.isArray(arguments[1]) || arguments.length === 3) {
        values = arguments[1];
        options = arguments[2];
      } else {
        options = arguments[1];
      }
    } else {
      query = arguments[0].toString();
      values = arguments[0].values;
      options = arguments[1];
    }

    if (!options) options = {};


    const gotClient = options.client ?
      Promise.resolve(options.client) :
      options.pool ?
        options.pool.connect() :
        defaultPool.connect();

    return gotClient.then(client => {
      const logQuery = this.logger.queryStart && this.logger.queryEnd && options.log !== false;
      const startLogged = Promise.resolve(logQuery ? this.logger.queryStart(query, values, options) : undefined);

      return client.query(query, values)
        .then(r => {
          const now = new Date();

          if (logQuery) startLogged.then(logQueryId => this.logger.queryEnd(logQueryId, now, options));
          if (!options.client) client.release();

          return r;
        })
        .catch(err => {
          if (!options.client) client.release();

          return Promise.reject(err);
        });
    });
  },
  /**
   * Execute a function with multiple queries under a single transaction.
   * @returns {Promise}
   */
  transact: function(f, options = {}) {
    if (typeof f !== 'function') return Promise.reject(new Error('FUNCTION_NOT_PROVIDED'));
    // just execute the function when already within a transaction
    if (options.client) return f(options);

    const pool = options.pool || defaultPool;

    return pool.connect().then(client => {
      const op = options.op;

      options.client = client;

      return this.query('BEGIN', options)
        .then(() => f(options))
        .then(result => {
          options.op = op;

          return this.query('COMMIT', options).then(() => {
            client.release();
            delete options.client;

            return result;
          });
        })
        .catch(err => {
          function releaseAndThrow(err) {
            client.release();
            delete options.client;
            throw err;
          }

          return this.query('ROLLBACK', options).catch(releaseAndThrow).then(() => releaseAndThrow(err));
        });
    });
  }
};
