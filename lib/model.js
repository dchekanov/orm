const _ = require('lodash');
const convertKeys = require('./convert-keys');
const db = require('./db');
const defaultPool = require('./default-pool');

class Model {
  constructor(properties) {
    const schemaKeys = this.constructor.columns.map(_.camelCase);
    const extendedKeys = Object.keys(this.constructor.extenders);

    properties = convertKeys.fromRow(properties);
    // discard properties not existing in the DB and not listed in extenders
    properties = _.pick(properties, schemaKeys.concat(extendedKeys));

    Object.assign(this, properties);

    if (!this.id && typeof this.generateId === 'function') this.id = this.generateId();
    if (!this.createdAt) this.createdAt = new Date();

    return this;
  }

  /**
   * Count instance records.
   * @param {Object} [where]
   * @param {Object} [options]
   * @returns {Promise}
   */
  static count(where, options = {}) {
    if (!options.op) options.op = 'count';

    const queryOptions = Object.assign({}, options, {
      type: 'select',
      table: this.table,
      columns: ['COUNT(*)'],
      where
    });

    const query = db.buildQuery(queryOptions);

    return db.query(query, options).then(r => parseInt(r.rows[0].count, 10));
  }

  /**
   * Delete instance records.
   * @param {object} where
   * @param {Object} [options]
   * @returns {Promise}
   */
  static delete(where = {}, options = {}) {
    if (!options.op) options.op = 'delete';

    const queryOptions = Object.assign({}, options, {type: 'delete', table: this.table, where});
    const query = db.buildQuery(queryOptions);

    return db.query(query, options);
  }

  /**
   * Apply extenders to instances.
   * @param {Object[]} instances
   * @param {Object} [options]
   * @returns {Promise}
   */
  static extend(instances, options) {
    if (!options.op) options.op = 'extend';

    let properties = options.extend;

    if (typeof properties === 'string') properties = [properties];

    if (!Array.isArray(instances) || instances.length === 0 || !properties || properties.length === 0) {
      return Promise.resolve(instances);
    }

    const extended = [];

    properties.forEach(property => {
      const extender = this.extenders[property];

      if (!extender) return;

      const extenderOptions = Object.assign({}, options);
      const prefix = `${property}.`;

      extenderOptions.extend = properties.filter(otherProperty => otherProperty.startsWith(prefix))
        .map(otherProperty => otherProperty.replace(prefix, ''));

      extended.push(extender(instances, extenderOptions));
    });

    return Promise.all(extended).then(() => instances);
  }

  /**
   * Find instance records.
   * @param {Object} [where]
   * @param {Object} [options]
   * @returns {Promise}
   */
  static find(where, options = {}) {
    if (!options.op) options.op = 'find';

    const queryOptions = Object.assign({}, options, {type: 'select', table: this.table, where});
    const query = db.buildQuery(queryOptions);

    return db.query(query, options).then(r => {
      const instances = r.rows.map(row => new this(row));

      return this.extend(instances, _.pick(options, ['op', 'req', 'client', 'pool', 'extend']));
    });
  }

  /**
   * Find an instance record by id.
   * @param {string} id
   * @param {Object} [options]
   * @returns {Promise}
   */
  static findById(id, options) {
    if (typeof id === 'undefined') return Promise.reject(new Error('ID_NOT_SPECIFIED'));

    return this.findOne({id}, options);
  }

  /**
   * Find a single instance record.
   * @param {object} [where]
   * @param {Object} [options]
   * @returns {Promise}
   */
  static findOne(where, options = {}) {
    options = Object.assign({}, options, {limit: 1});

    return this.find(where, options).then(instances => instances[0]);
  }

  /**
   * Read information about table columns from DB to ensure proper instance properties handling.
   * @returns {Promise}
   */
  static refreshColumns() {
    if (!this.table) return Promise.resolve();

    const queryOptions = {
      type: 'select',
      columns: [{expression: 'json_agg(column_name)', as: 'columns'}],
      table: 'information_schema.columns',
      where: {table_schema: 'public', table_name: this.table}
    };

    const query = db.buildQuery(queryOptions);

    return db.query(query, {log: false}).then(r => this.columns = r.rows[0].columns);
  }

  /**
   * Update instance records.
   * @param {Object} where
   * @param {Object} values
   * @param {Object} [options]
   * @returns {Promise}
   */
  static update(where = {}, values = {}, options = {}) {
    if (!options.op) options.op = 'update';

    const queryOptions = Object.assign({}, options, {type: 'update', table: this.table, where, values});
    const query = db.buildQuery(queryOptions);

    return db.query(query, options);
  }

  /**
   * Delete instance record.
   * @param {Object} [options]
   * @returns {Promise}
   */
  delete(options) {
    return this.constructor.delete({id: this.id}, options);
  }

  /**
   * Apply extenders to the instance.
   * @param properties
   * @param {Object} [options]
   * @returns {Promise}
   */
  extend(properties, options) {
    options = Object.assign({}, options, {extend: properties});

    return this.constructor.extend([this], options).then(() => this);
  }

  /**
   * Upsert instance into DB.
   * @param {Object} [options]
   * @returns {Promise}
   */
  save(options = {}) {
    if (!options.op) options.op = 'save';

    const row = this.toRow();

    const queryOptions = {
      type: 'insert',
      table: this.constructor.table,
      values: row,
      conflict: {target: 'id', action: {update: row}},
      returning: ['*']
    };

    const query = db.buildQuery(queryOptions);

    return db.query(query, options).then(r => {
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

Model.extenders = {};

Model.pool = defaultPool;

Model.table = undefined;

module.exports = Model;
