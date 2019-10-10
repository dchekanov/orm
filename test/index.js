const assert = require('assert');
const orm = require('../index');

describe('ORM', function() {
  before(async function() {
    await orm.setup({modulesDir: 'test/models'});
  });

  after(function() {
    return orm.endPools();
  });

  afterEach(async function() {
    const {Hat, Person, Style} = orm.models;

    await Person.delete();
    await Hat.delete();
    await Style.delete();
  });

  it('should read model definitions', function() {
    assert(Object.keys(orm.models).length === 3);
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
    await Hat.update({where: {color: 'blue'}, values: {color: 'yellow'}});

    assert(await Hat.count({color: 'yellow'}) === 1);
  });

  it('should delete records', async function() {
    const {Hat} = orm.models;

    await new Hat({color: 'blue'}).save();
    await Hat.delete({where: {color: 'blue'}});

    assert(await Hat.count() === 0);
  });

  it('should extend instances', async function() {
    const {Hat, Person} = orm.models;

    const hat = await new Hat({color: 'blue'}).save();
    await new Person({name: 'John', hatId: hat.id}).save();

    const person = await Person.findOne({where: {name: 'John'}}, {extend: 'hat'});

    assert(person.hat.color === 'blue');
  });

  it('should add "isReferenced" extender', async function() {
    const {Hat, Person, Style} = orm.models;

    // not referenced
    const personA = await new Person({name: 'John'}).save();

    assert((await Person.findById(personA.id, {extend: 'isReferenced'})).isReferenced === false);

    // now referenced in the style
    const styleA = await new Style({name: 'fancy', createdBy: personA.id}).save();

    assert((await Person.findById(personA.id, {extend: 'isReferenced'})).isReferenced === true);

    // no longer referenced after deleting the style
    await styleA.delete();

    assert((await Person.findById(personA.id, {extend: 'isReferenced'})).isReferenced === false);

    const personB = await new Person({name: 'Mike'}).save();
    const styleB = await new Style({name: 'shmancy'}).save();

    // multiple references in a custom table
    await orm.db.query(
      `INSERT INTO person_style (person_id, style_id, created_by) VALUES ($1, $2, $3)`,
      [personB.id, styleB.id, personA.id]
    );

    assert((await Person.findById(personB.id, {extend: 'isReferenced'})).isReferenced === true);
    assert((await Style.findById(styleB.id, {extend: 'isReferenced'})).isReferenced === true);
    assert((await Person.findById(personA.id, {extend: 'isReferenced'})).isReferenced === true);
  });
});
