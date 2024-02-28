const EventEmitter = require('events');
const {Pool} = require('pg');
const specParser = require('mongo-sql');
const errCode = require('err-code');
const _ = require('lodash');
const convertKeys = require('./convert-keys');

class Db extends EventEmitter {
  /**
   * @param [pool] - Connection pool instance to use.
   * @param [poolOptions] - Connection pool configuration, see https://node-postgres.com/api/pool
   */
  constructor({pool, poolOptions} = {}) {
    super();

    this.pool = pool || new Pool(poolOptions);
  }

  /**
   * Prepare statement spec for execution.
   * @param {object} spec
   * @throws {Error} ARGUMENTS_INVALID - spec is not an object.
   * @return {{spec: Object, statement: string, values: Array}}
   */
  convertSpec(spec) {
    if (typeof spec !== 'object') {
      throw errCode(new Error('spec is not an object'), 'ARGUMENTS_INVALID');
    }

    // do not alter the original spec
    const alteredSpec = _.cloneDeep(spec);

    ['values', 'where', 'order'].forEach(k => alteredSpec[k] = convertKeys.toSnakeCaseDeep(alteredSpec[k]));

    const parsed = specParser.sql(alteredSpec);

    return {spec: alteredSpec, statement: parsed.query, values: parsed.values};
  }

  /**
   * Execute a statement.
   * @param {string|Object} statementOrSpec
   * @param {Array|Object} [valuesOrExecOpts]
   * @param {Object} [execOpts]
   * @throws {Error} ARGUMENTS_INVALID - Neither spec or statement is supplied.
   * @emits Db#execFinish
   * @return {Promise}
   */
  async exec(statementOrSpec, valuesOrExecOpts, execOpts) {
    let spec, statement, values;

    if (typeof statementOrSpec === 'string') {
      statement = statementOrSpec;

      if (Array.isArray(valuesOrExecOpts) || execOpts) {
        values = valuesOrExecOpts;
      } else {
        execOpts = valuesOrExecOpts;
      }
    } else if (typeof statementOrSpec === 'object') {
      spec = statementOrSpec;

      const parsed = this.convertSpec(spec);

      statement = parsed.statement;
      values = parsed.values;
      execOpts = valuesOrExecOpts;
    } else {
      throw errCode(new Error('Neither spec or statement is supplied'), 'ARGUMENTS_INVALID');
    }

    if (!values) {
      values = [];
    }

    if (!execOpts) {
      execOpts = {};
    }

    const client = execOpts.client || await this.pool.connect();

    /**
     * @event Db#execFinish
     * @type {Object}
     * @property {Object} [spec]
     * @property {string} statement
     * @property {Array} values
     * @property {Object} execOpts
     * @property {Date} startedAt
     * @property {Date} finishedAt
     * @property {number} ms
     * @property {Object} [result]
     * @property {Error} [err]
     */
    const execFinishData = {spec, statement, values, execOpts, startedAt: new Date()};

    try {
      const result = await client.query(statement, values);

      Object.assign(execFinishData, {result});

      return result;
    } catch (err) {
      Object.assign(execFinishData, {err});
      err.statement = statement;
      err.values = values;
      throw err;
    } finally {
      const finishedAt = new Date();

      Object.assign(execFinishData, {finishedAt, ms: finishedAt - execFinishData.startedAt});
      this.emit('execFinish', execFinishData);

      if (!execOpts.client) {
        client.release();
      }
    }
  }

  /**
   * Execute a function with multiple queries under a single transaction.
   * @param {Function} f
   * @param {Object} [execOpts]
   * @throws {Error} ARGUMENTS_INVALID - A function to execute is not supplied.
   * @returns {Promise}
   */
  async transact(f, execOpts) {
    if (typeof f !== 'function') {
      throw errCode(new Error('A function to execute is not supplied'), 'ARGUMENTS_INVALID');
    }

    // just run the function when already within a transaction
    if (execOpts && execOpts.client) {
      return f(execOpts);
    }

    // clone execOpts so that the released client is not reused in the future
    const trExecOpts = Object.assign({}, execOpts, {client: await this.pool.connect()});
    // save op to restore after running the supplied function
    const initialOp = trExecOpts.op;

    try {
      await this.exec('BEGIN', trExecOpts);
    } catch (err) {
      trExecOpts.client.release();
      throw err;
    }

    try {
      const result = await f(trExecOpts);

      trExecOpts.op = initialOp;

      await this.exec('COMMIT', trExecOpts);

      return result;
    } catch (err) {
      await this.exec('ROLLBACK', trExecOpts);
      throw err;
    } finally {
      trExecOpts.client.release();
    }
  }
}

module.exports = Db;
