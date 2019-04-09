const {Model} = require('../../index');

class Person extends Model {
  describeHat() {
    return `${this.name} has a ${this.hat.color} hat.`;
  }
}

Person.table = 'persons';

module.exports = Person;
