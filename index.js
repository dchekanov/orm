const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');

module.exports = {
  convertKeys: require('./lib/convert-keys'),
  db: require('./lib/db'),
  defaultPool: require('./lib/default-pool'),
  Model: require('./lib/model'),
  models: {},
  /**
   * Add extenders for fields referencing other models by id.
   * @param {Object} Model
   * @returns {Promise}
   */
  discoverExtenders(Model) {
    if (!Model.columns.some(column => column.endsWith('_id'))) return;

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
      const referenced = Object.entries(this.models).find(([, Model]) => Model.table === row.foreign_table_name);

      if (!referenced) return;

      const ReferencedModel = this.models[referenced[0]];

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
   * End the default pool and all custom pools used by the models.
   * Intended to be used for graceful process shutdown.
   * @returns {Promise}
   */
  endPools() {
    const ended = [this.defaultPool.end()];

    Object.entries(this.models).forEach(([, Model]) => {
      if (Model.pool !== this.defaultPool) ended.push(Model.pool.end());
    });

    return Promise.all(ended);
  },
  /**
   * Init ORM.
   * @param {string} modulesDir - Where model files are located.
   * @param {Object} [logger] - Log non-critical errors via .error(), queries via .logQueryStart(), .logQueryEnd().
   * @param {Function} [generateId] - Used to create row ids.
   * @returns {Promise}
   */
  setup({modulesDir, generateId, logger} = {}) {
    if (typeof logger !== 'undefined') this.defaultPool.logger = this.db.logger = logger;

    if (typeof generateId !== 'undefined') {
      if (typeof generateId !== 'function') return Promise.reject(new Error('GENERATEID_NOT_A_FUNCTION'));

      this.Model.prototype.generateId = generateId;
    }

    if (typeof modulesDir !== 'string') return Promise.reject(new Error('MODULESDIR_NOT_A_STRING'));

    modulesDir = path.resolve(modulesDir);

    return util.promisify(fs.readdir)(modulesDir).then(fileNames => {
      fileNames.filter(fileName => fileName.endsWith('.js')).forEach(fileName => {
        const modelName = _.upperFirst(_.camelCase(path.basename(fileName, '.js')));
        const Model = require(path.join(modulesDir, fileName));

        if (!(Model.prototype instanceof this.Model)) throw new Error('MODEL_INVALID');

        this.models[modelName] = Model;
      });

      const columnsRefreshed = Object.entries(this.models).map(([, Model]) => Model.refreshColumns());

      return Promise.all(columnsRefreshed).then(() => {
        const extendersDiscovered = Object.entries(this.models).map(([, Model]) => this.discoverExtenders(Model));

        return Promise.all(extendersDiscovered);
      });
    });
  }
};
