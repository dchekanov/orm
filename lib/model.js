import _ from 'lodash';
import errCode from 'err-code';
import * as convertKeys from './convert-keys.js';
import Db from './db.js';

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
   * @param {Object} [ctx={}]
   * @throws {Error} DB_MISSING - The model is not linked to a DB.
   * @throws {Error} TABLE_MISSING - The model is not linked to a table.
   * @return {Promise}
   */
  static exec(spec = {}, ctx = {}) {
    if (!(this.db instanceof Db)) {
      throw errCode(new Error('The model is not linked to a DB'), 'DB_MISSING');
    }

    if (typeof this.table !== 'string') {
      throw errCode(new Error('The model is not linked to a table'), 'TABLE_MISSING');
    }

    spec = Object.assign({}, spec, {table: this.table});

    return this.db.exec(spec, ctx);
  }

  /**
   * Update the list of columns defined for the table.
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static refreshColumns(ctx = {}) {
    const spec = {
      type: 'select',
      columns: ['column_name', 'data_type'],
      table: 'information_schema.columns',
      where: {table_schema: 'public', table_name: this.table}
    };

    return this.db.exec(spec, ctx).then(result => {
      this.columns = result.rows.map(row => row.column_name);
    });
  }

  /**
   * Count instance records.
   * @param {Object} [spec={}]
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static count(spec = {}, ctx = {}) {
    spec = Object.assign({}, spec, {type: 'select', columns: ['COUNT(*)'], where: spec.where});

    return this.exec(spec, ctx).then(r => parseInt(r.rows[0].count, 10));
  }

  /**
   * Find instance records.
   * @param {Object} [spec={}]
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static find(spec = {}, ctx = {}) {
    spec = Object.assign({}, spec, {type: 'select', where: spec.where});

    return this.exec(spec, ctx).then(result => {
      const instances = result.rows.map(row => this.fromRow(row));

      return this.extend(instances, spec.extend, ctx);
    });
  }

  /**
   * Find a single instance record.
   * @param {Object} [spec={}]
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static findOne(spec = {}, ctx = {}) {
    spec = Object.assign({}, spec, {limit: 1});

    return this.find(spec, ctx).then(instances => instances[0]);
  }

  /**
   * Find an instance record by id.
   * @param {*} id
   * @param {Object} [ctx={}]
   * @throws {Error} ARGUMENTS_INVALID - id argument is not supplied.
   * @returns {Promise}
   */
  static findById(id, ctx) {
    if (typeof id === 'undefined') {
      throw errCode(new Error('id argument is not supplied'), 'ARGUMENTS_INVALID');
    }

    return this.findOne({where: {id}}, ctx);
  }

  /**
   * Update instance records.
   * @param {Object} [spec={}]
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static update(spec = {}, ctx = {}) {
    spec = Object.assign({}, spec, {type: 'update', where: spec.where, values: spec.values});

    return this.exec(spec, ctx);
  }

  /**
   * Delete instance records.
   * @param {Object} [spec={}]
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static delete(spec = {}, ctx = {}) {
    spec = Object.assign({}, spec, {type: 'delete', where: spec.where});

    return this.exec(spec, ctx);
  }

  /**
   * Apply extenders to instances.
   * @param {Object[]} [instances]
   * @param {string|Array} properties
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  static async extend(instances, properties, ctx = {}) {
    if (typeof properties === 'string') {
      properties = [properties];
    }

    if (
      !Array.isArray(instances) || instances.length === 0 ||
      !properties || properties.length === 0 ||
      !this.extenders
    ) {
      return instances;
    }

    const rootProperties = [];

    for (const property of properties) {
      const rootProperty = property.split('.')[0];

      if (rootProperties.includes(rootProperty)) {
        continue;
      }

      rootProperties.push(rootProperty);

      const extender = this.extenders[rootProperty];

      if (!extender) {
        continue;
      }

      // notify extender that it should extend further
      const prefix = `${rootProperty}.`;

      const extend = properties
        .filter(someProperty => someProperty.startsWith(prefix))
        .map(someProperty => someProperty.replace(prefix, ''));

      // do not overwrite paths that have been extended fully earlier
      const instancesToExtend = instances.filter(instance => typeof _.get(instance, property) === 'undefined');

      await extender(instancesToExtend, extend, ctx);
    }

    return instances;
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
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  insert(ctx = {}) {
    return this.save('insert', ctx);
  }

  /**
   * Update DB instance record.
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  update(ctx = {}) {
    return this.save('update', ctx);
  }

  /**
   * Upsert instance record into the DB.
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  upsert(ctx = {}) {
    return this.save('upsert', ctx);
  }

  /**
   * Save instance into DB.
   * @returns {Promise}
   */
  async save() {
    let mode = 'upsert', ctx;

    if (typeof arguments[0] === 'string') {
      mode = arguments[0];
      ctx = arguments[1];
    } else {
      ctx = arguments[0];
    }

    if (!['insert', 'update', 'upsert'].includes(mode)) {
      throw errCode(new Error(`"${mode}" is not a valid mode`), 'MODE_INVALID');
    }

    if (!ctx) {
      ctx = {};
    }

    if (!this.constructor.columns) {
      await this.constructor.refreshColumns(ctx);
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

    const result = await this.constructor.exec(spec, ctx);

    if (mode === 'update' && result.rows.length === 0) {
      throw errCode(new Error(`The record with id "${values.id}" is missing`), 'NOT_FOUND');
    }

    Object.assign(this, this.constructor.fromRow(result.rows[0]));

    return this;
  }

  /**
   * Delete instance record.
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  delete(ctx = {}) {
    return this.constructor.delete({where: {id: this.id}}, ctx);
  }

  /**
   * Apply extenders to the instance.
   * @param properties
   * @param {Object} [ctx={}]
   * @returns {Promise}
   */
  extend(properties, ctx = {}) {
    return this.constructor.extend([this], properties, ctx).then(() => this);
  }
}

export default Model;
