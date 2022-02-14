import EventEmitter from 'events';
import pg from 'pg';
import specParser from 'mongo-sql';
import errCode from 'err-code';
import _ from 'lodash';
import * as convertKeys from './convert-keys.js';

const {Pool} = pg;

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
   * @param {Array|Object} [valuesOrCtx]
   * @param {Object} [ctx]
   * @throws {Error} ARGUMENTS_INVALID - Neither spec or statement is supplied.
   * @emits Db#execFinish
   * @return {Promise}
   */
  async exec(statementOrSpec, valuesOrCtx, ctx) {
    let spec, statement, values;

    if (typeof statementOrSpec === 'string') {
      statement = statementOrSpec;

      if (Array.isArray(valuesOrCtx) || ctx) {
        values = valuesOrCtx;
      } else {
        ctx = valuesOrCtx;
      }
    } else if (typeof statementOrSpec === 'object') {
      spec = statementOrSpec;

      const parsed = this.convertSpec(spec);

      statement = parsed.statement;
      values = parsed.values;
      ctx = valuesOrCtx;
    } else {
      throw errCode(new Error('Neither spec or statement is supplied'), 'ARGUMENTS_INVALID');
    }

    if (!values) {
      values = [];
    }

    if (!ctx) {
      ctx = {};
    }

    const client = ctx.client || await this.pool.connect();

    /**
     * @event Db#execFinish
     * @type {Object}
     * @property {Object} [spec]
     * @property {string} statement
     * @property {Array} values
     * @property {Object} ctx
     * @property {Date} startedAt
     * @property {Date} finishedAt
     * @property {number} ms
     * @property {Object} [result]
     * @property {Error} [err]
     */
    const execFinishData = {spec, statement, values, ctx, startedAt: new Date()};

    try {
      const result = await client.query(statement, values);

      Object.assign(execFinishData, {result});

      return result;
    } catch (err) {
      Object.assign(execFinishData, {err});
      throw err;
    } finally {
      const finishedAt = new Date();

      Object.assign(execFinishData, {finishedAt, ms: finishedAt - execFinishData.startedAt});
      this.emit('execFinish', execFinishData);

      if (!ctx.client) {
        client.release();
      }
    }
  }

  /**
   * Execute a function with multiple queries under a single transaction.
   * @param {Function} f
   * @param {Object} [ctx]
   * @throws {Error} ARGUMENTS_INVALID - A function to execute is not supplied.
   * @returns {Promise}
   */
  async transact(f, ctx) {
    if (typeof f !== 'function') {
      throw errCode(new Error('A function to execute is not supplied'), 'ARGUMENTS_INVALID');
    }

    // just run the function when already within a transaction
    if (ctx && ctx.client) {
      return f(ctx);
    }

    ctx = Object.assign({}, ctx, {client: await this.pool.connect()});

    try {
      await this.exec('BEGIN', ctx);
    } catch (err) {
      ctx.client.release();
      throw err;
    }

    try {
      const result = await f(ctx);

      await this.exec('COMMIT', ctx);

      return result;
    } catch (err) {
      await this.exec('ROLLBACK', ctx);
      throw err;
    } finally {
      ctx.client.release();
    }
  }
}

export default Db;
