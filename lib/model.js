const _ = require('lodash');
const convertKeys = require('./convert-keys');
const Db = require('./db');
const errCode = require('err-code');

/**
 * @property {Db} db - Db instance that stores model records.
 * @property {string} table - The name of the table where model records are stored.
 * @property {string[]} columns - The list of columns defined for the table.
 * @property {Function} [generateId] - The function that should be used to generate instance id if DB doesn't assign it.
 * @property {Object} [extenders] - Functions that should be used to extend instances with additional properties.
 */
class Model {
  constructor(properties) {
    Object.assign(this, properties);

    if (typeof this.id === 'undefined' && typeof this.constructor.generateId === 'function') {
      this.id = this.constructor.generateId();
    }

    return this;
  }

  /**
   * Create a new instance from row.
   * @param {Object} row - Row object provided by the DB.
   * @returns {Model}
   */
  static fromRow(row) {
    return new this(convertKeys.toCamelCase(row));
  }

  /**
   * Execute an SQL spec targeting the table of this model.
   * @private
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @throws {Error} DB_MISSING - The model is not linked to a DB.
   * @throws {Error} TABLE_MISSING - The model is not linked to a table.
   * @return {Promise}
   */
  static exec(spec = {}, execOpts = {}) {
    if (!(this.db instanceof Db)) {
      throw errCode(new Error('The model is not linked to a DB'), 'DB_MISSING');
    }

    if (typeof this.table !== 'string') {
      throw errCode(new Error('The model is not linked to a table'), 'TABLE_MISSING');
    }

    spec = Object.assign({}, spec, {table: this.table});

    return this.db.exec(spec, execOpts);
  }

  /**
   * Update the list of columns defined for the table.
   * @returns {Promise}
   */
  static refreshColumns() {
    const spec = {
      type: 'select',
      columns: ['column_name', 'data_type'],
      table: 'information_schema.columns',
      where: {table_schema: 'public', table_name: this.table}
    };

    return this.db.exec(spec).then(result => {
      this.columns = result.rows.map(row => row.column_name);
    });
  }

  /**
   * Count instance records.
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static count(spec = {}, execOpts = {}) {
    if (!execOpts.op) {
      execOpts.op = 'count';
    }

    spec = Object.assign({}, spec, {type: 'select', columns: ['COUNT(*)'], where: spec.where});

    return this.exec(spec, execOpts).then(r => parseInt(r.rows[0].count, 10));
  }

  /**
   * Find instance records.
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static find(spec = {}, execOpts = {}) {
    if (!execOpts.op) {
      execOpts.op = 'find';
    }

    spec = Object.assign({}, spec, {type: 'select', where: spec.where});

    return this.exec(spec, execOpts).then(result => {
      const instances = result.rows.map(row => this.fromRow(row));

      return this.extend(instances, execOpts.extend, execOpts);
    });
  }

  /**
   * Find a single instance record.
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static findOne(spec = {}, execOpts = {}) {
    spec = Object.assign({}, spec, {limit: 1});

    return this.find(spec, execOpts).then(instances => instances[0]);
  }

  /**
   * Find an instance record by id.
   * @param {*} id
   * @param {Object} [execOpts={}]
   * @throws {Error} ARGUMENTS_INVALID - id argument is not supplied.
   * @returns {Promise}
   */
  static findById(id, execOpts) {
    if (typeof id === 'undefined') {
      throw errCode(new Error('id argument is not supplied'), 'ARGUMENTS_INVALID');
    }

    return this.findOne({where: {id}}, execOpts);
  }

  /**
   * Update instance records.
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static update(spec = {}, execOpts = {}) {
    if (!execOpts.op) {
      execOpts.op = 'update';
    }

    spec = Object.assign({}, spec, {type: 'update', where: spec.where, values: spec.values});

    return this.exec(spec, execOpts);
  }

  /**
   * Delete instance records.
   * @param {Object} [spec={}]
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static delete(spec = {}, execOpts = {}) {
    if (!execOpts.op) {
      execOpts.op = 'delete';
    }

    spec = Object.assign({}, spec, {type: 'delete', where: spec.where});

    return this.exec(spec, execOpts);
  }

  /**
   * Apply extenders to instances.
   * @param {Object[]} [instances]
   * @param {string|Array} properties
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  static extend(instances, properties, execOpts = {}) {
    if (!execOpts.op) {
      execOpts.op = 'extend';
    }

    if (typeof properties === 'string') {
      properties = [properties];
    }

    if (
      !Array.isArray(instances) || instances.length === 0 ||
      !properties || properties.length === 0 ||
      !this.extenders
    ) {
      return Promise.resolve(instances);
    }

    const rootProperties = [];

    const extended = properties.map(property => {
      const rootProperty = property.split('.')[0];

      if (rootProperties.includes(rootProperty)) {
        return Promise.resolve();
      }

      rootProperties.push(rootProperty);

      const extender = this.extenders[rootProperty];

      if (!extender) {
        return Promise.resolve();
      }

      // notify extender that it should extend further
      const extenderExecOptions = Object.assign({}, execOpts);
      const prefix = `${rootProperty}.`;

      extenderExecOptions.extend = properties.filter(otherProperty => otherProperty.startsWith(prefix))
        .map(otherProperty => otherProperty.replace(prefix, ''));

      return extender(instances, extenderExecOptions);
    });

    return Promise.all(extended).then(() => instances);
  }

  /**
   * Assign instance properties.
   * @param {string|Object} [kOrObject]
   * @param {*} [v]
   * @example
   * instance.set({a: 1, b: 2});
   * instance.set('a', 1).set('b', 2);
   * @returns {Model}
   */
  set(kOrObject, v) {
    if (typeof kOrObject === 'object') {
      Object.assign(this, kOrObject);
    } else {
      this[kOrObject] = v;
    }

    return this;
  }

  /**
   * Insert instance record into the DB.
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  insert(execOpts = {}) {
    return this.save('insert', execOpts);
  }

  /**
   * Update DB instance record.
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  update(execOpts = {}) {
    return this.save('update', execOpts);
  }

  /**
   * Upsert instance record into the DB.
   * @param {Object} [execOpts={}]
   * @returns {Promise}
   */
  upsert(execOpts = {}) {
    return this.save('upsert', execOpts);
  }

  /**
   * Save instance into DB.
   * @returns {Promise}
   */
  async save() {
    let mode = 'upsert', execOpts;

    if (typeof arguments[0] === 'string') {
      mode = arguments[0];
      execOpts = arguments[1];
    } else {
      execOpts = arguments[0];
    }

    if (!['insert', 'update', 'upsert'].includes(mode)) {
      throw errCode(new Error(`"${mode}" is not a valid mode`), 'MODE_INVALID');
    }

    if (!execOpts) {
      execOpts = {};
    }

    if (!execOpts.op) {
      execOpts.op = 'save';
    }

    if (!this.constructor.columns) {
      await this.constructor.refreshColumns();
    }

    const values = _.pick(_.mapKeys(this, (v, k) => _.snakeCase(k)), this.constructor.columns);

    Object.entries(values).forEach(([k, v]) => {
      if (_.isPlainObject(v)) {
        values[k] = JSON.stringify(v);
      }
    });

    const spec = {
      type: mode === 'update' ? 'update' : 'insert',
      returning: ['*']
    };

    if (mode === 'update') {
      spec.where = {
        id: values.id
      };
    }

    if (Object.keys(values).length === 0) {
      // allows to insert an empty record
      Object.assign(spec, {
        columns: ['id'],
        expression: 'VALUES (DEFAULT)'
      });
    } else {
      Object.assign(spec, {values});

      if (mode === 'upsert') {
        spec.conflict = {target: 'id', action: {update: values}};
      }
    }

    const result = await this.constructor.exec(spec, execOpts);

    if (mode === 'update' && result.rows.length === 0) {
      throw errCode(new Error(`The record with id "${values.id}" is missing`), 'NOT_FOUND');
    }

    Object.assign(this, this.constructor.fromRow(result.rows[0]));

    return this;
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
    return this.constructor.extend([this], properties, execOpts).then(() => this);
  }
}

module.exports = Model;
