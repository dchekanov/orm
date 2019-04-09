const assert = require('assert');
const orm = require('../index');

describe('ORM', function() {
  before(async function() {
    await orm.setup({modulesDir: 'test/models'});
  });

  afterEach(async function() {
    const {Hat, Person} = orm.models;

    await Person.delete();
    await Hat.delete();
  });

  it('should read model definitions', function() {
    assert(Object.keys(orm.models).length === 2);
    assert('Person' in orm.models);
    assert('Hat' in orm.models);
  });

  it('should create records', async function() {
    const {Hat} = orm.models;

    await new Hat({color: 'blue'}).save();

    assert(await Hat.count() === 1);
  });

  it('should update records', async function() {
    const {Hat} = orm.models;

    await new Hat({color: 'blue'}).save();
    await Hat.update({color: 'blue'}, {color: 'yellow'});

    assert(await Hat.count({color: 'yellow'}) === 1);
  });

  it('should delete records', async function() {
    const {Hat} = orm.models;

    await new Hat({color: 'blue'}).save();
    await Hat.delete({color: 'blue'});

    assert(await Hat.count() === 0);
  });

  it('should extend instances', async function() {
    const {Hat, Person} = orm.models;

    const hat = await new Hat({color: 'blue'}).save();
    await new Person({name: 'John', hatId: hat.id}).save();

    const person = await Person.findOne({name: 'John'}, {extend: 'hat'});

    assert(person.hat.color === 'blue');
  });
});
