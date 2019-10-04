const {Model} = require('../../index');

class Person extends Model {
  static get table() {
    return 'persons';
  }

  describeHat() {
    return `${this.name} has a ${this.hat.color} hat.`;
  }
}

module.exports = Person;
