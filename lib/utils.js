import _ from 'lodash';
import errCode from 'err-code';

/**
 * Discover references between model tables.
 * @param {Model[]} [models]
 * @param {*} [ctx]
 * @return {Promise}
 */
async function getReferences({models = [], ctx = {}} = {}) {
  if (!models.length) {
    return [];
  }

  const db = models[0].db;

  if (!db || !models.every(model => model.db === db)) {
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

  return db.exec(statement, ctx).then(result => result.rows);
}

/**
 * Add extenders that help discovering model relationships.
 * @param {Model[]} [models]
 * @param {*} [ctx]
 * @return {Promise}
 */
function link({models = [], ctx = {}} = {}) {
  const dbs = new Map();

  models = models.filter(model => model.db && model.table);

  models.forEach(model => {
    if (!dbs.has(model.db)) {
      dbs.set(model.db, []);
    }

    dbs.get(model.db).push(model);
  });

  const linked = [];

  dbs.forEach(dbModels => {
    linked.push(
      getReferences({models: dbModels, ctx}).then(references => {
        dbModels.forEach(model => {
          addIdExtenders({model, references, dbModels});
          addIsReferencedExtender({model, references});
        });
      })
    );
  });

  return Promise.all(linked);
}

/**
 * Add extenders for properties ending with "_id".
 * @param {Model} model
 * @param {Object[]} references
 * @param {Model[]} dbModels - All models using the same DB.
 */
function addIdExtenders({model, references, dbModels}) {
  const parentModel = Object.getPrototypeOf(model);

  if (!Object.prototype.hasOwnProperty.call(model, 'extenders')) {
    model.extenders = Object.assign({}, parentModel.extenders);
  }

  // referenced by this model
  const relatedReferences = references.filter(reference => reference.table_name === model.table);

  relatedReferences.forEach(reference => {
    // some_user_id => someUser
    const property = _.camelCase(reference.column_name.replace(/_id$/, ''));
    const referencedModel = dbModels.find(dbModel => dbModel.table === reference.foreign_table_name);

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

      const referencedInstances = await referencedModel.find({where: {id: {$in: ids}}}, ctx);

      instances.forEach(instance => {
        instance[property] = referencedInstances.find(referencedInstance => {
          return referencedInstance.id === instance[`${property}Id`];
        });
      });
    };
  });
}

/**
 * Add "isReferenced" extender.
 * @param {Model} model
 * @param {Object[]} references
 */
function addIsReferencedExtender({model, references}) {
  const parentModel = Object.getPrototypeOf(model);

  if (!Object.prototype.hasOwnProperty.call(model, 'extenders')) {
    model.extenders = Object.assign({}, parentModel.extenders);
  }

  // referencing this model
  const relatedReferences = references.filter(reference => reference.foreign_table_name === model.table);

  // [schema.table]: [column, ...]
  const referencingTables = {};

  relatedReferences.forEach(reference => {
    const table = `${reference.table_schema}.${reference.table_name}`;

    if (!referencingTables[table]) {
      referencingTables[table] = [];
    }

    referencingTables[table].push(reference.column_name);
  });

  model.extenders.isReferenced = async (instances, ctx) => {
    if (!instances || instances.length === 0) {
      return;
    }

    instances.forEach(instance => instance.isReferenced = false);

    // don't attempt to run an empty query
    if (relatedReferences.length === 0) {
      return;
    }

    const ids = _.chain(instances).map('id').uniq().filter(_.identity).value();

    if (ids.length === 0) {
      return;
    }

    const queries = [];

    Object.keys(referencingTables).forEach(table => {
      referencingTables[table].forEach(column => {
        queries.push(`
          SELECT ${column} AS referenced_id
          FROM ${table}
          WHERE ${column} = ANY ($1)
        `);
      });
    });

    const result = await model.db.exec(queries.join(' UNION '), [ids], ctx);
    const referencedIds = result.rows.map(row => row.referenced_id);

    instances.forEach(instance => instance.isReferenced = referencedIds.includes(instance.id));
  };
}

export {getReferences, link};
