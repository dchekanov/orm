# @keleran/orm

PostgreSQL ORM bits for Node.js projects.  
Works with Node.js 12, 14 and PostgreSQL 9-13.

![GitHub Workflow Status](https://img.shields.io/github/workflow/status/dchekanov/orm/Test)
![Sonar Coverage](https://img.shields.io/sonar/coverage/dchekanov_orm?server=https%3A%2F%2Fsonarcloud.io&sonarVersion=8.0)
![Libraries.io dependency status for latest release, scoped npm package](https://img.shields.io/librariesio/release/npm/@keleran/orm)

## Installation

```bash
$ npm i @keleran/orm
```

## Usage

```javascript
const {Db, Model, linkModels} = require('@keleran/orm');
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
// an additional argument can be supplied to pass execution options
// works with all signatures, must be added as the last argument
// "client", "extend", and "op" are reserved for internal use, others can be supplied to implement custom functionality (see below)
```
Db instance emits "execFinish" event when #exec() finishes (either successfully or not). 
This can be used for logging:

```javascript
db.on('execFinish', data => {
  if (data.execOpts.log === true) {
    // statement, values, result/err, and more 
    console.log(data);
  }
});

db.exec('SELECT version()', {log: true});
```

#### #transact(f, execOpts) async

```javascript
// execute a function with multiple queries under a single transaction
const execOpts = {log: false};

db.transact(async trExecOpts => {
  // trExecOpts = execOpts with "client" property added
  // when "client" is set, db will use it instead of creating a new one
  // all execs within a transaction MUST use trExecOpts for the transaction to work properly
  await db.exec('INSERT INTO users (email) VALUES ($1)', ['test@example.com'], trExecOpts);
  await db.exec('INSERT INTO users (email) VALUES ($1)', ['test@example.com'], trExecOpts);
  // will be rolled back and no rows will be added if email is UNIQUE  
}, execOpts);
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
  static get db() {
    return db;
  }
  // The name of the table where model records are stored MUST be defined
  static get table() {
    return 'users';
  }
  // The function that should be used to generate instance id MUST be defined if DB doesn't assign it
  static generateId() {
    return nanoid;
  }
  // custom methods MUST accept and pass execOpts to DB methods for transactions to work properly  
  static customMethod(params, execOpts) {
    this.db.exec('...', execOpts);  
  }
}
// extenders are functions that can add extra properties to instances
// extension can be performed via .extend, #extend, or by supplying "extend" parameter in execOpts
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

#### .count(spec, execOpts) async

```javascript
// count instance records, returns an integer
User.count({where: {email: {$notNull: true}}});
```

#### .find(spec, execOpts) async

```javascript
// find instance records, returns an array of instances
User.find({where: {email: {$notNull: true}}});
```

#### .findOne(spec, execOpts) async

```javascript
// find instance records, returns the first match
User.findOne({where: {email: {$notNull: true}}});
```

#### .findById(id, execOpts) async

```javascript
// find instance record by id
User.findById({where: {email: {$notNull: true}}});
```

#### .update(spec, execOpts) async

```javascript
// update instance records
User.update({where: {email: {$notNull: true}}}, {values: {email: null}});
```

#### .delete(spec, execOpts) async

```javascript
// delete instance records
User.delete({where: {email: {$notNull: true}}});
```

#### .extend(instances, properties, execOpts) async

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

#### #save(*) async

```javascript
// upsert
user.save();
user.save(execOpts);
user.save('upsert');
user.save('upsert', execOpts);
// insert, rejects if there's already a record with the same id
user.save('insert');
user.save('insert', execOpts);
// update, rejects if there's no record with the same id
user.save('update');
user.save('update', execOpts);
```

#### #insert(execOpts) async

```javascript
// calls user.save('insert', execOpts); internally
user.insert(execOpts);
```

#### #update(execOpts) async

```javascript
// calls user.save('update', execOpts); internally
user.update(execOpts);
```

#### #upsert(execOpts) async

```javascript
// calls user.save('upsert', execOpts); internally
user.upsert(execOpts);
```

#### #delete(execOpts) async

```javascript
// delete instance record from the DB
user.delete();
```

#### #extend(properties, execOpts) async

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
2. A set of extenders that allow to append model instances of referenced records. 
This is done for all properties names which follow the pattern "something_id". 
"something" becomes the name of the extender and of the property it appends.
The value of that property is an instance of the model that uses the table of the referenced record. 
