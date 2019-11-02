const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const {Pool} = require('pg');

module.exports = {
  convertKeys: require('./lib/convert-keys'),
  db: require('./lib/db'),
  logger: console,
  Model: require('./lib/model'),
  models: {},
  /**
   * Add extenders for fields referencing other models by id.
   * @param {Object} Model
   * @returns {Promise}
   */
  addIdExtenders(Model) {
    if (!Model.columns.some(column => column.endsWith('_id'))) return Promise.resolve();

    const query = `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE
        tc.constraint_type = 'FOREIGN KEY'
        AND ccu.column_name = 'id'
        AND tc.table_name = '${Model.table}';
    `;

    function parseRow(row) {
      const property = _.camelCase(row.column_name.replace(/_id$/, ''));
      const ReferencedModel = Object.values(this.models).find(Model => Model.table === row.foreign_table_name);

      if (!ReferencedModel) return;
      if (!Model.extenders) Model.extenders = {};

      Model.extenders[property] = (instances = [], options = {}) => {
        if (instances.length === 0) return Promise.resolve();

        const ids = _.chain(instances).map(`${property}Id`).uniq().filter(_.identity).value();

        if (ids.length === 0) return Promise.resolve();

        return ReferencedModel.find({id: {$in: ids}}, options).then(referencedInstances => {
          instances.forEach(instance => {
            instance[property] = referencedInstances.find(referencedInstance => {
              return referencedInstance.id === instance[`${property}Id`];
            });
          });
        });
      };
    }

    return this.db.query(query, {log: false}).then(r => r.rows.forEach(parseRow.bind(this)));
  },
  /**
   * Add "isReferenced" extender to the model.
   * @param {Object} Model
   * @returns {Promise}
   */
  addIsReferencedExtender(Model) {
    const query = `
      SELECT
        kcu.table_name,
        kcu.table_schema,
        kcu.column_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE
        tc.constraint_type = 'FOREIGN KEY'
        AND ccu.column_name = 'id'
        AND ccu.table_name = '${Model.table}'
    `;

    return this.db.query(query, {log: false}).then(r => {
      const references = {};

      r.rows.forEach(row => {
        const table = `${row.table_schema}.${row.table_name}`;

        if (!references[table]) references[table] = [];

        references[table].push(row.column_name);
      });

      if (!Model.extenders) Model.extenders = {};

      Model.extenders.isReferenced = (instances = [], options = {}) => {
        if (instances.length === 0) return Promise.resolve();

        const ids = _.chain(instances).map('id').uniq().filter(_.identity).value();
        const tables = Object.keys(references);

        const queries = [];

        tables.forEach(table => {
          references[table].forEach(column => {
            queries.push(`SELECT ${column} AS referenced_id FROM ${table} WHERE ${column} = ANY($1)`);
          });
        });

        return this.db.query(queries.join(' UNION '), [ids], options).then(r => {
          const referencedIds = r.rows.map(row => row.referenced_id);

          instances.forEach(instance => instance.isReferenced = referencedIds.includes(instance.id));
        });
      };
    });
  },
  /**
   * End the default pool and all custom pools used by the models.
   * Intended to be used for graceful process shutdown.
   * @returns {Promise}
   */
  endPools() {
    const ended = [this.defaultPool.end()];

    Object.values(this.models).forEach(Model => {
      if (!Model.pool.ended && !Model.pool.ending) ended.push(Model.pool.end());
    });

    return Promise.all(ended);
  },
  /**
   *
   * @param {number} maxConnections - The maximum number of clients the default pool should contain.
   */
  resetDefaultPool({maxConnections}) {
    if (this.defaultPool) this.defaultPool.end().catch(err => this.logger.error(err));
    this.defaultPool = this.db.defaultPool = new Pool({max: maxConnections});
    this.defaultPool.reset = () => this.resetDefaultPool({maxConnections});
    this.defaultPool.on('error', err => this.logger.error(err));
  },
  /**
   * Init ORM.
   * @param {string} modulesDir - Where model files are located.
   * @param {Object} [logger] - Log non-critical errors via .error(), queries via .logQueryStart(), .logQueryEnd().
   * @param {Function} [generateId] - Used to create row ids.
   * @param {number} defaultPoolMaxConnections - The maximum number of clients the default pool should contain.
   * @throws {TypeError}
   * @returns {Promise}
   */
  setup({modulesDir, generateId, logger, defaultPoolMaxConnections} = {}) {
    if (typeof logger !== 'undefined') this.logger = this.db.logger = logger;

    this.resetDefaultPool({maxConnections: defaultPoolMaxConnections});

    if (typeof generateId !== 'undefined') {
      if (typeof generateId !== 'function') throw new TypeError('generateId parameter is not a function');

      this.Model.prototype.generateId = generateId;
    }

    if (typeof modulesDir !== 'string') throw new TypeError('modulesDir parameter is not a string');

    modulesDir = path.resolve(modulesDir);

    return util.promisify(fs.readdir)(modulesDir).then(fileNames => {
      fileNames.filter(fileName => fileName.endsWith('.js')).forEach(fileName => {
        const modelName = _.upperFirst(_.camelCase(path.basename(fileName, '.js')));
        const Model = require(path.join(modulesDir, fileName));

        if (!(Model.prototype instanceof this.Model)) throw new Error('MODEL_INVALID');
        if (!Model.pool) Model.pool = this.defaultPool;

        this.models[modelName] = Model;
      });

      const columnsRefreshed = Object.values(this.models).map(Model => Model.refreshColumns());

      return Promise.all(columnsRefreshed).then(() => {
        const extendersDiscovered = Object.values(this.models).map(Model => {
          return Promise.all([this.addIdExtenders(Model), this.addIsReferencedExtender(Model)]);
        });

        return Promise.all(extendersDiscovered);
      });
    });
  }
};
