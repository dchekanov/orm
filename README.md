# @keleran/orm

PostgreSQL ORM bits for Node.js projects.  
Use ESM, require Node.js 16+ and PostgreSQL 11+.

![GitHub Workflow Status](https://img.shields.io/github/workflow/status/dchekanov/orm/Test)

## Installation

```bash
$ npm i @keleran/orm
```

## Usage

```javascript
import {Db, Model, linkModels} from '@keleran/orm';
```

### Db class

Database interface, powered by [pg](https://node-postgres.com/) and [MoSQL](https://github.com/goodybag/mongo-sql).
Supports raw SQL and transactions.

#### constructor({pool, poolOptions})

```javascript
// no options = a new pg.Pool with default options will be created
const db = new Db();
// poolOptions to use instead of the default ones can be supplied 
const db = new Db({poolOptions: {max: 5}});
// an existing pool can be supplied as well
const db = new Db({pool});
// it's best to listen to db.pool's "error" event so that it doesn't crash the app
db.pool.on('error', console.log);
// call db.pool.end() during graceful shutdown
db.pool.end().then(() => process.exit());
```

#### #exec(*) async

```javascript
// statement as plain string
db.exec('SELECT version()');
// with parameters
db.exec('INSERT INTO users (email) VALUES ($1)', ['test@example.com']);
// statement in the MoSQL format
// column names MUST be in snake_case
// keys of "values", "where", and "order" objects and of their children will be converted to snake_case before executing 
db.exec({type: 'select', table: 'users'});
// an additional argument can be supplied to pass context
// works with all signatures, must be added as the last argument
// "client" is reserved for internal use, others can be supplied to implement custom functionality (see below)
```

Db instance emits "execFinish" event when #exec() finishes (either successfully or not). This can be used for logging:

```javascript
db.on('execFinish', data => {
  if (data.ctx.log === true) {
    // statement, values, result/err, and more 
    console.log(data);
  }
});

db.exec('SELECT version()', {log: true});
```

#### #transact(f, ctx) async

```javascript
// execute a function with multiple queries under a single transaction
const ctx = {log: false};

db.transact(async ctx => {
  // ctx = the initial ctx with "client" property added
  // when "client" is set, db will use it instead of creating a new one
  // all execs within a transaction MUST be supplied with ctx for the transaction to work properly
  await db.exec('INSERT INTO users (email) VALUES ($1)', ['test@example.com'], ctx);
  await db.exec('INSERT INTO users (email) VALUES ($1)', ['test@example.com'], ctx);
  // will be rolled back and no rows will be added if email is UNIQUE  
}, ctx);
```

### Model class

Inherit from this class to allow application models to be saved, found, updated, counted, and deleted from the DB.

Methods listed below only accept MoSQL specs.

Methods automatically convert propertyNames to column_names when saving data and the other way around when fetching it.

#### Inheritance

```javascript
const db = new Db();

class User extends Model {
  // Db instance that stores model records MUST be defined
  static db = db;

  // The name of the table where model records are stored MUST be defined
  static table = 'users';
 
  // The function that should be used to generate instance id MUST be defined if DB doesn't assign it
  static generateId = uuid.v4;

  // custom methods MUST accept and pass ctx to DB methods for transactions to work properly  
  static customMethod(params, ctx) {
    this.db.exec('...', ctx);
  }
}

// extenders are functions that can add extra properties to instances
// extension can be performed via .extend, #extend, or by supplying "extend" parameter in query spec
// if multi-level extension is supported by the extender, the hierarchy should be expressed as "parent.child.child"
// extenders MUST NOT be defined as a static property if linkModels utility is used
User.extenders = {
  // can be an async function
  // it MUST adjust supplied instances, it does not matter what it returns 
  randomNumber: instances => instances.forEach(instance => instance.randomNumber = Math.random())
};
```

#### .refreshColumns() async

Each model keeps a list of columns defined for the table so that #save() could build a correct statement.  
.refreshColumns() is called automatically when #save() is called for the first time.  
The method should be called manually is schema is adjusted without restarting the app.

#### .count(spec, ctx) async

```javascript
// count instance records, returns an integer
User.count({where: {email: {$notNull: true}}});
```

#### .find(spec, ctx) async

```javascript
// find instance records, returns an array of instances
User.find({where: {email: {$notNull: true}}});
```

#### .findOne(spec, ctx) async

```javascript
// find instance records, returns the first match
User.findOne({where: {email: {$notNull: true}}});
```

#### .update(spec, ctx) async

```javascript
// update instance records
User.update({where: {email: {$notNull: true}}, values: {email: null}});
```

#### .delete(spec, ctx) async

```javascript
// delete instance records
User.delete({where: {email: {$notNull: true}}});
```

#### .extend(instances, properties, ctx) async

```javascript
// extend instance records
User.extend(users, 'articles');
// an array can be supplied to call multiple extenders
User.extend(users, ['articles', 'comments']);
```

#### constructor(properties)

```javascript
// create an instance, assigning supplied properties
// if User.generateId is defined, user will have the "id" property set
const user = new User({firstName: 'User'});
```

#### .fromRow(row)

```javascript
// the same as the regular constructor, but snake_key property names will be converted to camelCase
// useful when dealing with raw DB results
const user = User.fromRow({first_name: 'User'});
```

#### #set(*)

```javascript
// a convenience method to adjust instance properties, supports chaining
user.set('firstName', 'A').set('lastName', 'B');
// is identical to
user.set({firstName: 'A', lastName: 'B'});
```

#### #insert(ctx) async

```javascript
// rejects if there's already a record with the same id
user.insert(ctx);
```

#### #update(ctx) async

```javascript
// rejects if there's no record with the same id
user.update(ctx);
```

#### #upsert(ctx) async

```javascript
// tries to insert, updates on error
user.upsert(ctx);
```

#### #delete(ctx) async

```javascript
// delete instance record from the DB
user.delete();
```

#### #extend(properties, ctx) async

```javascript
// extend instance
user.extend('articles');
// an array can be supplied to call multiple extenders
user.extend(['articles', 'comments']);
```

### linkModels utility

#### link({models}) async

Discovers relationships between supplied models and appends two types of extenders:

1. "isReferenced" - adds a boolean value indicating whether the instance is referenced from somewhere or not.
2. A set of extenders that allow to append model instances of referenced records. This is done for all properties names
   which follow the pattern "something_id".
   "something" becomes the name of the extender and of the property it appends. The value of that property is an
   instance of the model that uses the table of the referenced record. 
