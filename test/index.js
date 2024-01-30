import dotenv from 'dotenv';
import assert from 'assert';
import fs from 'fs';
import _ from 'lodash';
import {pg} from '../index.js';
import sinon from 'sinon';
import * as convertKeys from '../lib/convert-keys.js';
import * as linkModels from '../lib/utils.js';
import Db from '../lib/db.js';
import Model from '../lib/model.js';

dotenv.config({path: 'test/.env', debug: true});

const pool = new pg.Pool();
const schemaSql = fs.readFileSync('test/schema.sql', 'utf8');

function resetDb() {
  return pool.query(schemaSql);
}

const db = new Db({pool});

class Hat extends Model {
  static db = db;
  static table = 'hats';
}

class User extends Model {
  static db = db;
  static table = 'users';
}

after(async function () {
  await pool.query('DROP TABLE IF EXISTS users, hats');
  pool.end();
});

beforeEach(() => {
  db.removeAllListeners('execFinish');
  sinon.restore();
});

describe('lib/convert-keys', function () {
  describe('toCamelCase', function () {
    it('should convert row_keys to objectKeys', function () {
      const row = {id: 1, prop_a: 2, p_r_o_p_b: 3};
      const object = convertKeys.toCamelCase(row);

      assert(object.id === row.id);
      assert(object.propA === row.prop_a);
      assert(object.pROPB === row.p_r_o_p_b);
    });

    it('should not throw when target is missing or of unconventional type', function () {
      assert.doesNotThrow(() => convertKeys.toCamelCase());
      assert.doesNotThrow(() => convertKeys.toCamelCase(null));
      assert.doesNotThrow(() => convertKeys.toCamelCase(1));
    });
  });

  describe('toSnakeCaseDeep', function () {
    it('should convert objectKeys to row_keys, including all child elements', function () {
      const object = {
        id: 1,
        propA: 2,
        pRoPb: 2,
        propC: {
          propD: 3,
          propE: [
            {propF: 4}, {propG: 5}, 6
          ]
        },
        propNull: null,
        propDate: new Date(),
        buffer: Buffer.from('test')
      };

      const row = convertKeys.toSnakeCaseDeep(object);

      assert(row.id === object.id);
      assert(row.prop_a === object.propA);
      assert(row.p_ro_pb === object.pRoPb);
      assert(row.prop_c.prop_d === object.propC.propD);
      assert(row.prop_c.prop_e[0].prop_f === object.propC.propE[0].propF);
      assert(row.prop_c.prop_e[1].prop_g === object.propC.propE[1].propG);
      assert(row.prop_c.prop_e[2] === object.propC.propE[2]);
      assert(row.prop_null === object.propNull);
      assert(row.prop_date.getTime() === object.propDate.getTime());
      assert(row.buffer.compare(Buffer.from('test')) === 0);
    });

    it('should support array input', function () {
      const object = [{propA: 1}, {propB: 2, propC: {propD: 3}}];
      const row = convertKeys.toSnakeCaseDeep(object);

      assert(row[0].prop_a === object[0].propA);
      assert(row[1].prop_b === object[1].propB);
      assert(row[1].prop_c.prop_d === object[1].propC.propD);
    });

    it('should not modify properties starting with $ (conditional helpers)', function () {
      const object = {where: {something: {$notNull: true}}};
      const row = convertKeys.toSnakeCaseDeep(object);

      assert(row.where.something.$notNull === object.where.something.$notNull);
    });

    it('should not throw when target is missing or of unconventional type', function () {
      assert.doesNotThrow(() => convertKeys.toSnakeCaseDeep());
      assert.doesNotThrow(() => convertKeys.toSnakeCaseDeep(null));
      assert.doesNotThrow(() => convertKeys.toSnakeCaseDeep(1));
    });
  });
});

describe('lib/db', function () {
  describe('constructor', function () {
    it('should use the supplied pool', function () {
      const testDb = new Db({pool});

      assert(testDb.pool === pool);
    });

    it('should create a new pool when called with no arguments', function () {
      const testDb = new Db();

      assert(typeof testDb.pool === 'object');
    });

    it('should use the supplied poolOptions', function () {
      const poolOptions = {max: 1};
      const testDb = new Db({poolOptions});

      assert(testDb.pool.options.max === poolOptions.max);
    });
  });

  describe('convertSpec', function () {
    it('should throw on invalid arguments', function () {
      assert.throws(() => db.convertSpec(), {name: 'Error', code: 'ARGUMENTS_INVALID'});
      assert.throws(() => db.convertSpec(123), {name: 'Error', code: 'ARGUMENTS_INVALID'});
    });

    it('should return converted spec, statement, and values', function () {
      const spec = {type: 'select', table: 'users'};
      const converted = db.convertSpec(spec);

      assert(converted.spec !== spec);
      assert(typeof converted.spec === 'object');
      assert(typeof converted.statement === 'string');
      assert(Array.isArray(converted.values));
    });

    it('should convert keys of "order" parameter', function () {
      const spec = {type: 'select', table: 'users', order: {firstName: 'asc'}};
      const converted = db.convertSpec(spec);

      assert(converted.spec.order.first_name === spec.order.firstName);
    });

    it('should convert keys of "values" and "where" parameters', function () {
      const spec = {
        type: 'update',
        table: 'users',
        where: {firstName: 'A', lastName: {$notNull: true}, $or: [{isActive: true}, {isActive: false}]},
        values: {firstName: 'B'}
      };

      const converted = db.convertSpec(spec);

      assert(converted.spec.where.first_name === spec.where.firstName);
      assert(converted.spec.where.last_name.$notNull === spec.where.lastName.$notNull);
      assert(converted.spec.where.$or[0].is_active === spec.where.$or[0].isActive);
      assert(converted.spec.where.$or[1].is_active === spec.where.$or[1].isActive);
    });
  });

  describe('exec', function () {
    it('should reject on missing/invalid spec/statement', async function () {
      await assert.rejects(() => db.exec(), {name: 'Error', code: 'ARGUMENTS_INVALID'});
      await assert.rejects(() => db.exec(true), {name: 'Error', code: 'ARGUMENTS_INVALID'});
    });

    it('should emit "execFinish" events on successful execution', function (done) {
      const statement = 'SELECT version()';

      db.on('execFinish', function (data) {
        assert('statement' in data);
        assert('values' in data);
        assert('ctx' in data);
        assert('startedAt' in data);
        assert('finishedAt' in data);
        assert('result' in data);
        done();
      });

      db.exec(statement);
    });

    it('should emit "execFinish" events on failed execution', function (done) {
      const statement = 'fail';

      db.on('execFinish', function (data) {
        assert('statement' in data);
        assert('values' in data);
        assert('ctx' in data);
        assert('startedAt' in data);
        assert('finishedAt' in data);
        assert('err' in data);
        done();
      });

      db.exec(statement).catch(() => {
        // ignore
      });
    });

    it('should support (statement, values, ctx) signature', function (done) {
      const statement = 'SELECT concat($1::text, $2::text)';
      const values = ['a', 'b'];
      const ctx = {log: false};

      db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.statement === statement);
        assert(data.values === values);
        assert(data.ctx === ctx);
        done();
      });

      db.exec(statement, values, ctx).catch(done);
    });

    it('should support (statement, ctx) signature', function (done) {
      const statement = 'SELECT version()';
      const ctx = {log: false};

      db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.statement === statement);
        assert(data.values.length === 0);
        assert(data.ctx === ctx);
        done();
      });

      db.exec(statement, ctx).catch(done);
    });

    it('should support (spec, ctx) signature', async function () {
      await resetDb();

      const spec = {type: 'select', table: 'hats', where: {color: 'black'}};
      const ctx = {log: false};
      const convertedSpec = db.convertSpec(spec);

      await new Promise((resolve, reject) => {
        db.on('execFinish', function (data) {
          if (data.err) {
            return;
          }

          assert(data.statement === convertedSpec.statement);
          assert(_.isEqual(data.values, convertedSpec.values));
          assert(data.ctx === ctx);
          resolve();
        });

        db.exec(spec, ctx).catch(reject);
      });
    });
  });

  describe('transact', function () {
    it('should reject on invalid arguments', async function () {
      await assert.rejects(() => db.transact(), {name: 'Error', code: 'ARGUMENTS_INVALID'});
    });

    it('should run the supplied function within a transaction (commit)', function (done) {
      const statement = 'SELECT version()';
      const executed = [];

      db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        executed.push(data);

        if (executed.length === 3) {
          assert(executed[0].statement === 'BEGIN');
          assert(executed[1].statement === statement);
          assert(typeof executed[1].result.rows[0].version === 'string');
          assert(executed[2].statement === 'COMMIT');
          done();
        }
      });

      db.transact(trExecOpts => db.exec(statement, trExecOpts)).catch(done);
    });

    it('should run the supplied function within a transaction (rollback)', function (done) {
      const executed = [];

      db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        executed.push(data);

        if (executed.length === 2) {
          assert(executed[0].statement === 'BEGIN');
          assert(executed[1].statement === 'ROLLBACK');
          done();
        }
      });

      db.transact(() => Promise.reject(new Error('ignore')))
        .catch(err => {
          if (err.message === 'ignore') {
            return;
          }

          done(err);
        });
    });

    it('should reuse the supplied client', async function () {
      const client = await pool.connect();

      await db.transact(trExecOpts => assert(trExecOpts.client === client), {client});

      client.release();
    });
  });
});

describe('lib/model', function () {
  describe('constructor', function () {
    it('should assign passed properties to the created instance', function () {
      const properties = {color: 'black'};
      const hat = new Hat(properties);

      assert(hat.color === properties.color);
    });

    it('should use "generateId" static method to assign ids to instances', function () {
      const id = 1;

      class Fedora extends Hat {
        static generateId() {
          return id;
        }
      }

      const fedora = new Fedora();

      assert(fedora.id === id);
    });
  });

  describe('fromRow', function () {
    it('should create a new instance from row', function () {
      const row = {id: 1, created_at: new Date()};
      const hat = Hat.fromRow(row);

      assert(hat.createdAt === row.created_at);
    });
  });

  describe('exec', function () {
    it('should throw if model is not linked to a DB', function () {
      class Test extends Model {

      }

      assert.throws(() => Test.exec({type: 'select'}), {name: 'Error', code: 'DB_MISSING'});
    });

    it('should throw if model is not linked to a table', function () {
      class Test extends Model {
        static get db() {
          return db;
        }
      }

      assert.throws(() => Test.exec({type: 'select'}), {name: 'Error', code: 'TABLE_MISSING'});
    });

    it('should call db.exec with spec modified to point to model table', async function () {
      await resetDb();

      await new Promise((resolve, reject) => {
        Hat.db.on('execFinish', function (data) {
          if (data.err) {
            return;
          }

          assert(data.spec.table === Hat.table);
          resolve();
        });

        Hat.exec({type: 'select'}).catch(reject);
      });
    });
  });

  describe('.refreshColumns', function () {
    beforeEach(resetDb);

    it('should update the list of columns defined for the table', async function () {
      await Hat.refreshColumns();

      assert(Hat.columns.length === 4);
      assert(Hat.columns.includes('id'));
      assert(Hat.columns.includes('color'));
      assert(Hat.columns.includes('created_at'));
      assert(Hat.columns.includes('data'));
    });
  });

  describe('.count', function () {
    beforeEach(resetDb);

    it('should return the number of matched rows', async function () {
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);

      const count = await Hat.count({where: {color: 'black'}});

      assert(count === 1);
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      return Hat.count({}, ctx);
    });
  });

  describe('.find', function () {
    beforeEach(resetDb);

    it('should find instance records', async function () {
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);

      const hats = await Hat.find({where: {color: 'black'}});

      assert(hats.length === 1);
      assert(typeof hats[0].id === 'number');
      assert(hats[0].color === 'black');
    });

    it('should call .extend() for found instance records', async function () {
      const extend = 'something';

      class Fedora extends Hat {
        static extend(instances) {
          instances.forEach(instance => instance[extend] = true);

          return Promise.resolve(instances);
        }
      }

      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);

      const fedoras = await Fedora.find({where: {color: 'black'}, extend: [extend]});

      assert(fedoras[0][extend] === true);
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      return Hat.find({}, ctx);
    });
  });

  describe('.findOne', function () {
    beforeEach(resetDb);

    it('should find a single instance record', async function () {
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);
      const hat = await Hat.findOne();

      assert(['black', 'gray'].includes(hat.color));
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      return Hat.findOne({}, ctx);
    });
  });

  describe('.update', function () {
    beforeEach(resetDb);

    it('should update instance records', async function () {
      const color = 'red';
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);
      await Hat.update({where: {color: 'black'}, values: {color}});

      const result = await pool.query(`SELECT count(*)
                                       FROM hats
                                       WHERE color = '${color}'`);

      assert(result.rows[0].count === '1');
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      return Hat.update({where: {color: 'black'}, values: {color: 'red'}}, ctx);
    });
  });

  describe('.delete', function () {
    beforeEach(resetDb);

    it('should delete instance records', async function () {
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black'),
                               ('gray')`);
      await Hat.delete({where: {color: 'black'}});

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows.length === 1);
      assert(result.rows[0].color === 'gray');
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      return Hat.delete({}, ctx);
    });
  });

  describe('.extend', function () {
    beforeEach(resetDb);

    const delay = 25;

    class Nested extends Model {
      static extenders = {
        randomNumber: instances => {
          instances.forEach(instance => instance.randomNumber = Math.random());
        },
        incrementedCounter: instances => {
          instances.forEach(instance => instance.incrementedCounter = (instance.incrementedCounter || 0) + 1);
        }
      };
    }

    class Fedora extends Hat {
      static extenders = {
        randomNumber: instances => {
          instances.forEach(instance => instance.randomNumber = Math.random());
        },
        delay: instances => {
          return new Promise(resolve => {
            setTimeout(() => {
              instances.forEach(instance => instance.delay = delay);
              resolve();
            }, delay);
          });
        },
        isDelayed: instances => {
          instances.forEach(instance => instance.isDelayed = instance.delay === delay);
        },
        incrementedCounter: instances => {
          instances.forEach(instance => instance.incrementedCounter = (instance.incrementedCounter || 0) + 1);
        },
        nested: instances => {
          instances.forEach(instance => {
            // shouldn't happen
            if (instance.nested) {
              throw new Error('Already extended');
            }

            instance.nested = new Nested();
          });
        },
        nestedArray: instances => {
          instances.forEach(instance => {
            // shouldn't happen
            if (instance.nestedArray) {
              throw new Error('Already extended');
            }

            instance.nestedArray = [new Nested(), new Nested()];
          });
        }
      };
    }

    it('should apply extenders to instances', async function () {
      const fedoras = [new Fedora({color: 'black'}), new Fedora({color: 'gray'})];

      await Fedora.extend(fedoras, ['randomNumber']);

      assert(fedoras.every(fedora => typeof fedora.randomNumber === 'number'));
    });

    it('should only accept arrays for the list of properties', async function () {
      const fedoras = [new Fedora({color: 'black'}), new Fedora({color: 'gray'})];

      await assert.rejects(
        () => Fedora.extend(fedoras, 'randomNumber'),
        err => err.code === 'PROPERTIES_INVALID'
      );
    });

    it('rejects if extender does not exist', async function () {
      const fedoras = [new Fedora({color: 'black'}), new Fedora({color: 'gray'})];

      await assert.rejects(
        () => Fedora.extend(fedoras, ['missing']),
        err => err.code === 'EXTENDER_MISSING'
      );
    });

    it('waits for the previous extender to finish', async function () {
      const fedoras = [new Fedora({color: 'black'})];

      await Fedora.extend(fedoras, ['delay', 'isDelayed']);

      assert(fedoras.every(fedora => fedora.isDelayed));
    });

    it('does not extend twice', async function () {
      const fedora = new Fedora();

      await Fedora.extend([fedora], ['incrementedCounter']);
      await Fedora.extend([fedora], ['incrementedCounter']);

      assert(fedora.incrementedCounter === 1);
    });

    it('extends deep correctly', async function () {
      const fedora = new Fedora();

      await Fedora.extend([fedora], ['nested.incrementedCounter']);
      await Fedora.extend([fedora], ['nested.incrementedCounter']);
      await Fedora.extend([fedora], ['nested.randomNumber']);
      await Fedora.extend([fedora], ['nestedArray.randomNumber']);

      assert(fedora.nested.incrementedCounter === 1);
      assert(typeof fedora.nested.randomNumber === 'number');
      assert(fedora.nestedArray.every(nested => typeof nested.randomNumber === 'number'));
    });
  });

  describe('#set', function () {
    it('should assign instance properties (k, v signature)', function () {
      const hat = new Hat();
      const result = hat.set('color', 'black');

      assert(result === hat);
      assert(hat.color === 'black');
    });

    it('should assign instance properties (object signature)', function () {
      const hat = new Hat();
      const result = hat.set({color: 'black'});

      assert(result === hat);
      assert(hat.color === 'black');
    });
  });

  describe('#save', function () {
    beforeEach(resetDb);

    it('should refresh columns before saving', async function () {
      delete Hat.columns;

      const hat = new Hat({color: 'black'});

      await hat.save();

      assert(Hat.columns.length === 4);
    });

    it('should not reject when saving with properties that do not have matching columns', async function () {
      const hat = new Hat({color: 'black', hasFeathers: true});

      await assert.doesNotReject(() => hat.save());
    });

    it('should save instance record and assign properties set by the DB', async function () {
      const createdAt = new Date();
      const hat = new Hat({color: 'black', createdAt});

      await hat.save();

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows[0].color === hat.color);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].created_at.getTime() === createdAt.getTime());
    });

    it('should save an instance with no properties supplied', async function () {
      const hat = new Hat();

      await hat.save();

      assert(typeof hat.id === 'number');
    });

    it('rejects when supplied with invalid mode', async function () {
      const hat = new Hat({color: 'black'});

      await assert.rejects(() => hat.save('overwrite'), err => err.code === 'MODE_INVALID');
    });

    it('creates a record in the "insert" mode', async function () {
      const hat = new Hat({id: 1, color: 'black'});

      await hat.save('insert');

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows.length === 1);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].color === 'black');
    });

    it('rejects when trying to overwrite in the "insert" mode', async function () {
      const hat1 = new Hat({id: 1, color: 'black'});
      const hat2 = new Hat({id: 1, color: 'gray'});

      await hat1.save('insert');

      await assert.rejects(() => hat2.save('insert'));
    });

    it('changes a record in the "update" mode', async function () {
      const hat1 = new Hat({id: 1, color: 'black'});
      const hat2 = new Hat({id: 1, color: 'gray'});

      await hat1.save();
      await hat2.save('update');

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows.length === 1);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].color === 'gray');
    });

    it('rejects when trying to update non-existing in the "update" mode', async function () {
      const hat = new Hat({id: 1, color: 'black'});

      await assert.rejects(() => hat.save('update'), err => err.code === 'NOT_FOUND');
    });

    it('creates a record in the "upsert" mode', async function () {
      const hat = new Hat({color: 'black'});

      await hat.save('upsert');

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows.length === 1);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].color === 'black');
    });

    it('changes a record in the "upsert" mode', async function () {
      const hat1 = new Hat({id: 1, color: 'black'});
      const hat2 = new Hat({id: 1, color: 'gray'});

      await hat1.save();
      await hat2.save('upsert');

      const result = await pool.query('SELECT * FROM hats');

      assert(result.rows.length === 1);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].color === 'gray');
    });

    it('uses the "upsert" mode by default', async function () {
      const hat1 = new Hat({id: 1, color: 'black'});
      const hat2 = new Hat({id: 1, color: 'gray'});
      const hat3 = new Hat({id: 2, color: 'green'});

      await hat1.save();
      await hat2.save();
      await hat3.save();

      const result = await pool.query('SELECT * FROM hats ORDER BY id');

      assert(result.rows.length === 2);
      assert(result.rows[0].id === 1);
      assert(result.rows[0].color === 'gray');
      assert(result.rows[1].id === 2);
      assert(result.rows[1].color === 'green');
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err || data.spec.table !== Hat.table) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      const hat = new Hat({color: 'black'});

      return hat.save(ctx);
    });

    // https://github.com/goodybag/mongo-sql/issues/190
    it('should save properties that are objects with "type" key set', async function () {
      const hat = new Hat({data: {type: 'magic'}});

      await assert.doesNotReject(() => hat.save());

      const result = await db.exec('SELECT * FROM hats');

      assert(result.rows[0].data.type === 'magic');
    });
  });

  describe('#insert', function () {
    beforeEach(resetDb);

    it('calls #save using the "insert" mode', async function () {
      const stub = sinon.stub(Model.prototype, 'save');

      const ctx = {op: 'insert'};
      const hat = new Hat({color: 'black'});

      await hat.insert(ctx);

      assert(stub.calledOnceWith('insert', ctx));
    });
  });

  describe('#update', function () {
    beforeEach(resetDb);

    it('calls #save using the "update" mode', async function () {
      const stub = sinon.stub(Model.prototype, 'save');

      const ctx = {op: 'update'};
      const hat = new Hat({color: 'black'});

      await hat.update(ctx);

      assert(stub.calledOnceWith('update', ctx));
    });
  });

  describe('#upsert', function () {
    beforeEach(resetDb);

    it('calls #save using the "upsert" mode', async function () {
      const stub = sinon.stub(Model.prototype, 'save');

      const ctx = {op: 'upsert'};
      const hat = new Hat({color: 'black'});

      await hat.upsert(ctx);

      assert(stub.calledOnceWith('upsert', ctx));
    });
  });

  describe('#delete', function () {
    beforeEach(resetDb);

    it('should delete the instance', async function () {
      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black')`);

      const hat = await Hat.findOne({color: 'black'});

      await hat.delete();

      const result = await pool.query('SELECT count(*) FROM hats');

      assert(result.rows[0].count === '0');
    });

    it('should pass ctx', function () {
      const ctx = {op: 'test'};

      Hat.db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.op === ctx.op);
      });

      const hat = new Hat({id: 1});

      return hat.delete(ctx);
    });
  });

  describe('#extend', function () {
    beforeEach(resetDb);

    it('should call .extend() for the instance', async function () {
      const extend = 'something';

      class Fedora extends Hat {
        static extend(instances) {
          instances.forEach(instance => instance[extend] = true);

          return Promise.resolve(instances);
        }
      }

      await pool.query(`INSERT INTO hats (color)
                        VALUES ('black')`);

      const fedora = await Fedora.findOne({where: {color: 'black'}});

      await fedora.extend([extend]);

      assert(fedora[extend] === true);
    });

    it('should pass ctx', function () {
      const extend = 'something';
      const ctx = {op: 'test'};

      class Fedora extends Hat {
        static extend(instances, properties, extenderCtx = {}) {
          assert(extenderCtx.op === ctx.op);

          return Promise.resolve();
        }
      }

      const fedora = new Fedora({id: 1});

      return fedora.extend([extend], ctx);
    });
  });
});

describe('link-models', function () {
  before(resetDb);

  describe('getReferences', function () {
    it('should return empty list if models are not specified', async function () {
      const references = await linkModels.getReferences();

      assert(references.length === 0);
    });

    it('should return empty list if the list of models is empty', async function () {
      const references = await linkModels.getReferences({models: []});

      assert(references.length === 0);
    });

    it('should reject if one of the models does not have a DB assigned', async function () {
      class Fedora extends Hat {
        static db = null;
      }

      await assert.rejects(
        () => linkModels.getReferences({models: [Fedora]}),
        {name: 'Error', code: 'ARGUMENTS_INVALID'}
      );
    });

    it('should reject if models do not share the same DB', async function () {
      class Fedora extends Hat {
        static db = null;
      }

      await assert.rejects(
        () => linkModels.getReferences({models: [Hat, Fedora]}),
        {name: 'Error', code: 'ARGUMENTS_INVALID'}
      );
    });

    it('should discover references between model tables', async function () {
      const references = await linkModels.getReferences({models: [Hat, User]});

      assert(references.length === 1);
      assert(references[0].table_schema === 'public');
      assert(references[0].table_name === 'users');
      assert(references[0].column_name === 'hat_id');
      assert(references[0].foreign_table_name === 'hats');
    });
  });

  describe('link', function () {
    it('should not reject if models are not supplied', async function () {
      await assert.doesNotReject(() => linkModels.link());
    });

    it('should add extenders that help discovering model relationships', async function () {
      class Fedora extends Hat {

      }

      class Manager extends User {

      }

      await linkModels.link({models: [Fedora, Manager]});

      assert(typeof Fedora.extenders.isReferenced === 'function');
      assert(typeof Manager.extenders.isReferenced === 'function');
      assert(typeof Manager.extenders.hat === 'function');

      const fedora = new Fedora({color: 'black'});

      await fedora.save();
      await fedora.extend(['isReferenced']);

      assert(fedora.isReferenced === false);

      const manager = new Manager({hatId: fedora.id});

      await manager.save();

      delete fedora.isReferenced;

      await fedora.extend(['isReferenced']);
      await manager.extend(['hat']);

      assert(fedora.isReferenced === true);
      assert(manager.hat.id === fedora.id);
    });

    it('should preserve existing extenders', async function () {
      class Fedora extends Hat {

      }

      Fedora.extenders = {
        existing: () => _.noop
      };

      await linkModels.link({models: [Fedora]});

      assert(typeof Fedora.extenders.isReferenced === 'function');
      assert(typeof Fedora.extenders.existing === 'function');
    });

    it('should pass ctx', function (done) {
      class Fedora extends Hat {

      }

      db.on('execFinish', function (data) {
        if (data.err) {
          return;
        }

        assert(data.ctx.log === false);
        done();
      });

      linkModels.link({models: [Fedora], ctx: {log: false}}).catch(done);
    });
  });
});

describe('index', function () {
  it('should expose Db, Model, linkModels, pg', async function () {
    const exported = await import('../index.js');

    assert(exported.Db === Db);
    assert(exported.Model === Model);
    assert(exported.linkModels === linkModels);
    assert(exported.pg === pg);
  });
});
