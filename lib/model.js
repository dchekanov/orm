import _ from 'lodash';
import errCode from 'err-code';
import * as convertKeys from './convert-keys.js';
import Db from './db.js';

const SAVE_MODES = new Set(['insert', 'update', 'upsert']);

class Model {
  /** @type {Db} Db instance that stores model records. */
  static db;
  /** @type {string} The name of the table where model records are stored. */
  static table;
  /** @type {string[]} The list of columns defined for the table. */
  static columns;
  /** @type {Function} The function to generate instance id (optional, could be assigned by the DB upon saving). */
  static generateId;
  /** @type {Object} [extenders] Functions to be used to extend instances with additional properties. */
  static extenders;
  /** @type {Promise|undefined} A helper promise to avoid concurrent calls to refreshColumns(). */
  static _refreshColumnsPromise;

  /**
   * @param {Object} [properties]
   */
  constructor(properties = {}) {
    Object.assign(this, properties);

    const constructor = /** @type {typeof Model} */ (this.constructor);

    if (this.id === undefined && typeof constructor.generateId === 'function') {
      this.id = constructor.generateId();
    }
  }

  /**
   * Create a new instance from a row.
   * @param {Object} row - Row object provided by the DB.
   * @returns {Model}
   */
  static fromRow(row) {
    return new this(convertKeys.toCamelCase(row));
  }

  /**
   * Execute an SQL spec targeting the table of this model.
   * @private
   * @param {Object} spec
   * @param {Object} [ctx]
   * @throws {Error} DB_MISSING - The model is not linked to a DB.
   * @throws {Error} TABLE_MISSING - The model is not linked to a table.
   * @returns {Promise<import('pg').QueryResult>}
   */
  static exec(spec, ctx = {}) {
    if (!(this.db instanceof Db)) {
      throw errCode(new Error('The model is not linked to a DB'), 'DB_MISSING');
    }

    if (typeof this.table !== 'string') {
      throw errCode(new Error('The model is not linked to a table'), 'TABLE_MISSING');
    }

    spec = { ...spec, table: this.table };

    return this.db.exec(spec, ctx);
  }

  /**
   * Update the list of columns defined for the table.
   * @param {Object} [ctx]
   * @returns {Promise<void>}
   */
  static async refreshColumns(ctx = {}) {
    if (this._refreshColumnsPromise instanceof Promise) {
      return this._refreshColumnsPromise;
    }

    this._refreshColumnsPromise = (async () => {
      const spec = {
        type: 'select',
        columns: ['column_name', 'data_type'],
        table: 'information_schema.columns',
        where: { table_schema: 'public', table_name: this.table },
      };

      const { rows } = await this.db.exec(spec, ctx);

      this.columns = rows.map((row) => row.column_name);
    })();

    try {
      await this._refreshColumnsPromise;
    } finally {
      this._refreshColumnsPromise = undefined;
    }
  }

  /**
   * Count instance records.
   * @param {Object} [spec]
   * @param {Object} [ctx]
   * @returns {Promise<number>}
   */
  static async count(spec = {}, ctx = {}) {
    spec = { ...spec, type: 'select', columns: ['COUNT(*)'], where: spec.where };

    const { rows } = await this.exec(spec, ctx);

    return Number.parseInt(rows[0].count, 10);
  }

  /**
   * Find instance records.
   * @param {Object} [spec]
   * @param {Object} [ctx]
   * @returns {Promise<Model[]>}
   */
  static async find(spec = {}, ctx = {}) {
    spec = { ...spec, type: 'select', where: spec.where };

    const { rows } = await this.exec(spec, ctx);

    const instances = rows.map((row) => this.fromRow(row));

    await this.extend(instances, spec.extend, ctx);

    return instances;
  }

  /**
   * Find a single instance record.
   * @param {Object} [spec]
   * @param {Object} [ctx]
   * @returns {Promise<Model | undefined>}
   */
  static async findOne(spec = {}, ctx = {}) {
    spec = { ...spec, limit: 1 };

    const instances = await this.find(spec, ctx);

    return instances[0];
  }

  /**
   * Update instance records.
   * @param {Object} [spec]
   * @param {Object} [ctx]
   * @returns {Promise<import('pg').QueryResult>}
   */
  static update(spec = {}, ctx = {}) {
    spec = { ...spec, type: 'update', where: spec.where, values: spec.values };

    return this.exec(spec, ctx);
  }

  /**
   * Delete instance records.
   * @param {Object} [spec]
   * @param {Object} [ctx]
   * @returns {Promise<import('pg').QueryResult>}
   */
  static delete(spec = {}, ctx = {}) {
    spec = { ...spec, type: 'delete', where: spec.where };

    return this.exec(spec, ctx);
  }

  /**
   * Apply extenders to instances.
   * @param {Model[]} instances
   * @param {string[]} properties
   * @param {Object} [ctx]
   * @returns {Promise<void>}
   */
  static async extend(instances, properties, ctx = {}) {
    if (properties && !Array.isArray(properties)) {
      throw errCode(new Error('The list of properties to extend is not an array'), 'PROPERTIES_INVALID');
    }

    if (!Array.isArray(instances) || instances.length === 0 || !properties || properties.length === 0) {
      return;
    }

    for (const chain of properties) {
      const segments = chain.split('.');
      const property = segments.shift();
      const extender = this.extenders[property];

      if (!extender) {
        throw errCode(new Error(`Extender "${property}" is not defined for model "${this.name}"`), 'EXTENDER_MISSING');
      }

      const instancesToExtend = instances.filter((instance) => instance[property] === undefined);

      if (instancesToExtend.length !== 0) {
        await extender(instancesToExtend, ctx);
      }

      if (segments.length === 0) {
        continue;
      }

      const extendedProperties = instances
        .filter((instance) => instance[property])
        .flatMap((instance) => instance[property]);

      const constructors = new Set(extendedProperties.map((extendedProperty) => extendedProperty.constructor));

      for (const constructor of constructors) {
        if (typeof constructor.extend !== 'function') {
          throw errCode(
            new Error(`"${constructor.name}" does not provide a way to extend instances`),
            'EXTEND_NOT_IMPLEMENTED',
          );
        }

        const constructorProperties = extendedProperties.filter((extendedProperty) => {
          return extendedProperty.constructor === constructor;
        });

        await constructor.extend(constructorProperties, [segments.join('.')], ctx);
      }
    }
  }

  /**
   * Assign instance properties.
   * @param {string|Object} [kOrObject]
   * @param {*} [v]
   * @example
   * instance.set({a: 1, b: 2});
   * instance.set('a', 1).set('b', 2);
   * @returns {this}
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
   * Insert an instance record into the DB.
   * @param {Object} [ctx]
   * @returns {Promise<this>}
   */
  insert(ctx = {}) {
    return this.save('insert', ctx);
  }

  /**
   * Update DB instance record.
   * @param {Object} [ctx]
   * @returns {Promise<this>}
   */
  update(ctx = {}) {
    return this.save('update', ctx);
  }

  /**
   * Upsert instance record into the DB.
   * @param {Object} [ctx]
   * @returns {Promise<this>}
   */
  upsert(ctx = {}) {
    return this.save('upsert', ctx);
  }

  /**
   * Save the instance into the DB.
   * @param {string|Object} [modeOrCtx]
   * @param {Object} [ctx]
   * @returns {Promise<this>}
   */
  async save(modeOrCtx, ctx) {
    let mode = 'upsert';

    if (typeof modeOrCtx === 'string') {
      mode = modeOrCtx;
    } else {
      ctx = modeOrCtx;
    }

    if (!SAVE_MODES.has(mode)) {
      throw errCode(new Error(`"${mode}" is not a valid mode`), 'MODE_INVALID');
    }

    if (!ctx) {
      ctx = {};
    }

    const constructor = /** @type {typeof Model} */ (this.constructor);

    if (!constructor.columns) {
      await constructor.refreshColumns(ctx);
    }

    /** @type {Record<string, any>} */
    const values = _.pick(
      _.mapKeys(this, (v, k) => _.snakeCase(k)),
      constructor.columns,
    );

    Object.entries(values).forEach(([k, v]) => {
      if (_.isPlainObject(v)) {
        values[k] = JSON.stringify(v);
      }
    });

    const spec = {
      type: mode === 'update' ? 'update' : 'insert',
      returning: ['*'],
    };

    if (mode === 'update') {
      if (values.id === undefined || values.id === null) {
        throw errCode(new Error('The "id" property is missing'), 'ARGUMENTS_INVALID');
      }

      spec.where = {
        id: values.id,
      };
    }

    if (Object.keys(values).length === 0) {
      // allows inserting an empty record
      Object.assign(spec, {
        columns: ['id'],
        expression: 'VALUES (DEFAULT)',
      });
    } else {
      Object.assign(spec, { values });

      if (mode === 'upsert') {
        spec.conflict = { target: 'id', action: { update: values } };
      }
    }

    const result = await constructor.exec(spec, ctx);

    if (mode === 'update' && result.rows.length === 0) {
      throw errCode(new Error(`The record with id "${values.id}" is missing`), 'NOT_FOUND');
    }

    Object.assign(this, constructor.fromRow(result.rows[0]));

    return this;
  }

  /**
   * Delete instance record.
   * @param {Object} [ctx]
   * @returns {Promise<import('pg').QueryResult>}
   */
  delete(ctx = {}) {
    const constructor = /** @type {typeof Model} */ (this.constructor);

    return constructor.delete({ where: { id: this.id } }, ctx);
  }

  /**
   * Apply extenders to the instance.
   * @param {string[]} properties
   * @param {Object} [ctx]
   * @returns {Promise<this>}
   */
  async extend(properties, ctx = {}) {
    const constructor = /** @type {typeof Model} */ (this.constructor);

    await constructor.extend([this], properties, ctx);

    return this;
  }
}

export default Model;
