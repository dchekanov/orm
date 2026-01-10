import _ from 'lodash';
import errCode from 'err-code';
import format from 'pg-format';

/**
 * Discover references between model tables.
 * @param {Object} config
 * @param {typeof import('./model.js').default[]} [config.models]
 * @param {*} [config.ctx]
 * @returns {Promise<any[]>}
 */
async function getReferences({ models = [], ctx = {} } = {}) {
  if (!Array.isArray(models) || models.length === 0) {
    return [];
  }

  const db = models[0].db;

  if (!db || !models.every((model) => model.db === db)) {
    throw errCode(new Error('Not all of the supplied models share the same DB'), 'ARGUMENTS_INVALID');
  }

  const statement = `
    SELECT kcu.table_schema,
           kcu.table_name,
           kcu.column_name,
           ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints AS tc
           JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name = 'id';
  `;

  const { rows } = await db.exec(statement, ctx);

  return rows;
}

/**
 * Add extenders that help to discover model relationships.
 * @param {Object} config
 * @param {typeof import('./model.js').default[]} [config.models]
 * @param {*} [config.ctx]
 * @returns {Promise<void>}
 */
async function link({ models = [], ctx = {} } = {}) {
  const dbs = new Map();

  models = models.filter((model) => model.db && model.table);

  models.forEach((model) => {
    if (!dbs.has(model.db)) {
      dbs.set(model.db, []);
    }

    dbs.get(model.db).push(model);
  });

  const linked = [];

  dbs.forEach((dbModels) => {
    linked.push(
      getReferences({ models: dbModels, ctx }).then((references) => {
        dbModels.forEach((model) => {
          addIdExtenders({ model, references, dbModels });
          addIsReferencedExtender({ model, references });
        });
      }),
    );
  });

  await Promise.all(linked);
}

/**
 * Add extenders for properties ending with "_id".
 * @param {Object} config
 * @param {typeof import('./model.js').default} config.model
 * @param {Object[]} config.references
 * @param {typeof import('./model.js').default[]} config.dbModels - All models using the same DB.
 */
function addIdExtenders({ model, references, dbModels }) {
  const parentModel = Object.getPrototypeOf(model);

  if (!Object.hasOwn(model, 'extenders')) {
    model.extenders = { ...parentModel.extenders };
  }

  // referenced by this model
  const relatedReferences = references.filter((reference) => reference.table_name === model.table);

  relatedReferences.forEach((reference) => {
    // some_user_id => someUser
    const property = _.camelCase(reference.column_name.replace(/_id$/, ''));
    const referencedModel = dbModels.find((dbModel) => dbModel.table === reference.foreign_table_name);

    if (!referencedModel) {
      return;
    }

    model.extenders[property] = async (instances, ctx) => {
      if (!instances || instances.length === 0) {
        return;
      }

      const ids = _.chain(instances).map(`${property}Id`).uniq().filter(_.identity).value();

      if (ids.length === 0) {
        return;
      }

      const referencedInstances = await referencedModel.find({ where: { id: { $in: ids } } }, ctx);

      instances.forEach((instance) => {
        instance[property] = referencedInstances.find((referencedInstance) => {
          return referencedInstance.id === instance[`${property}Id`];
        });
      });
    };
  });
}

/**
 * Add the "isReferenced" extender.
 * @param {Object} config
 * @param {typeof import('./model.js').default} config.model
 * @param {Object[]} config.references
 */
function addIsReferencedExtender({ model, references }) {
  const parentModel = Object.getPrototypeOf(model);

  if (!Object.hasOwn(model, 'extenders')) {
    model.extenders = { ...parentModel.extenders };
  }

  // referencing this model
  const relatedReferences = references.filter((reference) => reference.foreign_table_name === model.table);

  /** @type {Record<string, {schema: string, table: string, columns: string[]}>} */
  const referencingTables = {};

  relatedReferences.forEach((reference) => {
    const key = `${reference.table_schema}.${reference.table_name}`;

    if (!referencingTables[key]) {
      referencingTables[key] = { schema: reference.table_schema, table: reference.table_name, columns: [] };
    }

    referencingTables[key].columns.push(reference.column_name);
  });

  model.extenders.isReferenced = async (instances, ctx) => {
    if (!instances || instances.length === 0) {
      return;
    }

    instances.forEach((instance) => (instance.isReferenced = false));

    // don't attempt to run an empty query
    if (relatedReferences.length === 0) {
      return;
    }

    const ids = _.chain(instances).map('id').uniq().filter(_.identity).value();

    if (ids.length === 0) {
      return;
    }

    const queries = [];

    Object.values(referencingTables).forEach(({ schema, table, columns }) => {
      columns.forEach((column) => {
        queries.push(`
          ${format('SELECT %I AS referenced_id FROM %I.%I WHERE %I = ANY ($1)', column, schema, table, column)}
        `);
      });
    });

    const result = await model.db.exec(queries.join(' UNION '), [ids], ctx);
    const referencedIds = new Set(result.rows.map((row) => row.referenced_id));

    instances.forEach((instance) => (instance.isReferenced = referencedIds.has(instance.id)));
  };
}

export { getReferences, link };
