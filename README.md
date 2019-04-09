This ORM was created to simplify migration from MongoDB+mongoose to PostgreSQL. 

# Usage mini-guide 

Create a DB, setup access permissions, set [PostgreSQL env. variables](https://www.postgresql.org/docs/10/libpq-envars.html).

Create a table:

```
// SQL
CREATE TABLE hats (
  id serial PRIMARY KEY,
  color text,
  created_at timestamptz
);

CREATE TABLE persons (
  id serial PRIMARY KEY,
  name text,
  hat_id int REFERENCES hats,
  created_at timestamptz
);
```

Install the module: 

```bash
npm i @keleran/orm
```

Create models:

```bash
mkdir models
touch models/person.js
touch models/hat.js
```

```javascript
// models/person.js
const {Model} = require('@keleran/orm');

class Person extends Model {
  // models are regular JS classes and can have custom static and instance methods
  describeHat() {
    return `${this.name} has a ${this.hat.color} hat.`;
  }
}

// the table to store instance records must be provided 
Person.table = 'persons';

module.exports = Person;
```

```javascript
// models/hat.js
const {Model} = require('@keleran/orm');

class Hat extends Model {
  
}

Hat.table = 'hats';

module.exports = Hat;
```

Create a script:

```bash
touch index.js
```

```javascript
// index.js
const orm = require('@keleran/orm');

// Init ORM, tell it where to fetch model definitions from
// generateId option can be provided to generate ids in the app (example: shortid.generate)
orm.setup({modulesDir: './models'}).then(async () => {
  // discovered modules can be accessed via orm.models
  const {Hat, Person} = orm.models;

  // create a new object instance using new Model(properties)
  const blueHat = new Hat({color: 'blue'});
  const redHat = new Hat({color: 'red'});

  // use .save(context) to persist instance record in the DB
  // context object must be passed in transactions (see below) 
  await blueHat.save();
  await redHat.save();

  // objectKeys will be converted into row_keys automatically, and vice versa
  // note that model.id is available only after saving, unless you provide generateId for the setup
  await new Person({name: 'John', hatId: blueHat.id}).save();
  await new Person({name: 'Emma'}).save();

  // use .count(query, options, context) to get the number of records
  // see mongo-sql's "where" helper for query syntax
  // options can include any mongo-sql helpers + a special "extend" option (see below)
  const count = await Person.count();

  console.log(count); // 2

  // use .find(q, o), .findOne(q, o), findById(id, o) to search
  const firstPerson = await Person.findOne({}, {order: {name: 'asc'}});

  console.log(firstPerson); // { "id": 2, "name": "Emma", "createdAt": Date }

  // use "extend" option to attach referenced models (only works for fields with "_id" suffix referencing "id" property)
  const john = await Person.findOne({name: 'John'}, {extend: 'hat'});

  console.log(john); // { id: 1, name: 'John', hatId: 1, createdAt: Date, hat: { id: 1, color: 'blue', createdAt: Date } }
  console.log(john.describeHat()); // John has a blue hat.
  
  // use .update(query, update, options) to update records
  // per-instance: model.set({k: v}).save();
  await Person.update({name: 'Emma'}, {hatId: redHat.id});
  
  // use orm.db.transact(function, context object) for transactions
  try {
    await orm.db.transact(async ctx =>  {
      await Person.update({name: 'Emma'}, {hatId: blueHat.id}, ctx);
      throw new Error('INTENTIONAL');
    }, {});
  } catch (err) {
    if (err.message !== 'INTENTIONAL') throw err;
  }
  
  const emma = await Person.findOne({name: 'Emma'}, {extend: 'hat'});
  
  console.log(emma.hat.color); // red, because transaction failed

  // use orm.db.query to execute raw SQL
  console.log((await orm.db.query('SELECT name FROM persons WHERE hat_id = $1', [redHat.id])).rows[0]); // { name: 'Emma' }

  // use .delete(query) to remove records from the DB
  // per-instance: model.delete();
  await Person.delete();
  await Hat.delete();

  // call orm.endPools() to close all connections
  orm.endPools(process.exit);
});
```

Run it:

```bash
$ node index
```
