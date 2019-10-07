const _ = require('lodash');
const convertKeys = require('./convert-keys');
const db = require('./db');
const defaultPool = require('./default-pool');

class Model {
  constructor(properties) {
    const schemaKeys = this.constructor.columns.map(_.camelCase);
    const extendedKeys = Object.keys(this.constructor.extenders || {});

    properties = convertKeys.fromRow(properties);
    // discard properties not existing in the DB and not listed in the extenders
    properties = _.pick(properties, schemaKeys.concat(extendedKeys));

    Object.assign(this, properties);

    if (!this.id && typeof this.generateId === 'function') this.id = this.generateId();
    if (!this.createdAt) this.createdAt = new Date();

    return this;
  }

  /**
   * Get DB connection pool.
   * @returns {Pool}
   */
  static get pool() {
    return defaultPool;
  }

  /**
   * Count instance records.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static count(querySpec = {}, execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'count';

    querySpec = Object.assign({}, querySpec, {type: 'select', columns: ['COUNT(*)'], where: querySpec.where});

    return this.query(querySpec, execOpts).then(r => parseInt(r.rows[0].count, 10));
  }

  /**
   * Delete instance records.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static delete(querySpec = {}, execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'delete';

    querySpec = Object.assign({}, querySpec, {type: 'delete', where: querySpec.where});

    return this.query(querySpec, execOpts);
  }

  /**
   * Apply extenders to instances.
   * @param {Object[]} instances
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static extend(instances, execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'extend';

    let properties = execOpts.extend;

    if (typeof properties === 'string') properties = [properties];

    if (!Array.isArray(instances) || instances.length === 0 || !properties || properties.length === 0) {
      return Promise.resolve(instances);
    }

    const extended = [];

    properties.forEach(property => {
      if (!this.extenders) return;

      const extender = this.extenders[property];

      if (!extender) return;

      const extenderExecOptions = Object.assign({}, execOpts);
      const prefix = `${property}.`;

      extenderExecOptions.extend = properties.filter(otherProperty => otherProperty.startsWith(prefix))
        .map(otherProperty => otherProperty.replace(prefix, ''));

      extended.push(extender(instances, extenderExecOptions));
    });

    return Promise.all(extended).then(() => instances);
  }

  /**
   * Find instance records.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static find(querySpec = {}, execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'find';

    querySpec = Object.assign({}, querySpec, {type: 'select', where: querySpec.where});

    return this.query(querySpec, execOpts).then(r => {
      const instances = r.rows.map(row => new this(row));

      return this.extend(instances, execOpts);
    });
  }

  /**
   * Find an instance record by id.
   * @param {string} id
   * @param {Object} [execOpts={}]
   * @throws Error
   * @returns {Promise}
   */
  static findById(id, execOpts) {
    if (typeof id === 'undefined') throw new Error('id argument is missing');

    return this.findOne({where: {id}}, execOpts);
  }

  /**
   * Find a single instance record.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static findOne(querySpec = {}, execOpts = {}) {
    querySpec = Object.assign({}, querySpec, {limit: 1});

    return this.find(querySpec, execOpts).then(instances => instances[0]);
  }

  /**
   * Execute a DB query targeting the table of this model.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @throws Error Model.table must be defined.
   * @return {Promise}
   */
  static query(querySpec = {}, execOpts = {}) {
    if (!this.table) throw new Error('table for the model is not defined');

    querySpec = Object.assign({}, querySpec, {table: this.table});

    const query = db.buildQuery(querySpec);

    return db.query(query, execOpts);
  }

  /**
   * Read information about table columns from DB to ensure proper instance properties handling.
   * @throws Error Model.table must be defined.
   * @throws Error The table must have some columns defined.
   * @returns {Promise}
   */
  static refreshColumns() {
    if (!this.table) throw new Error('table for the model is not defined');

    const querySpec = {
      type: 'select',
      columns: ['column_name', 'data_type'],
      table: 'information_schema.columns',
      where: {table_schema: 'public', table_name: this.table}
    };

    const query = db.buildQuery(querySpec);

    return db.query(query, {log: false}).then(r => {
      if (!r.rows.length) throw new Error(`the "${this.table}" table does not have any columns`);

      this.columns = r.rows.map(row => row.column_name);

      this.columnDataTypes = r.rows.reduce((accumulator, row) => {
        accumulator[row.column_name] = row.data_type;

        return accumulator;
      }, {});
    });
  }

  /**
   * Update instance records.
   * @param {Object} [querySpec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static update(querySpec = {}, execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'update';

    querySpec = Object.assign({}, querySpec, {type: 'update', where: querySpec.where, values: querySpec.values});

    return this.query(querySpec, execOpts);
  }

  /**
   * Delete instance record.
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  delete(execOpts = {}) {
    return this.constructor.delete({where: {id: this.id}}, execOpts);
  }

  /**
   * Apply extenders to the instance.
   * @param properties
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  extend(properties, execOpts = {}) {
    execOpts = Object.assign({}, execOpts, {extend: properties});

    return this.constructor.extend([this], execOpts).then(() => this);
  }

  /**
   * Upsert instance into DB.
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  save(execOpts = {}) {
    if (!execOpts.op) execOpts.op = 'save';

    const row = this.toRow();

    const querySpec = {
      type: 'insert',
      values: row,
      conflict: {target: 'id', action: {update: row}},
      returning: ['*']
    };

    return this.constructor.query(querySpec, execOpts).then(r => {
      Object.assign(this, convertKeys.fromRow(r.rows[0]));

      return this;
    });
  }

  /**
   * Adjust instance properties.
   * @example
   * instance.set({a: 1, b: 2});
   * instance.set('a', 1).set('b', 2);
   * @returns {Model}
   */
  set() {
    if (_.isPlainObject(arguments[0])) {
      Object.assign(this, arguments[0]);
    } else {
      this[arguments[0]] = arguments[1];
    }

    return this;
  }

  /**
   * Convert instance to instance row.
   * @returns {*}
   */
  toRow() {
    return _.pick(convertKeys.toRow(this), this.constructor.columns);
  }
}

module.exports = Model;
