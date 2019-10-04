const {Model} = require('../../index');

class Hat extends Model {
  static get table() {
    return 'hats';
  }
}

module.exports = Hat;
