const {Model} = require('../../index');

class Style extends Model {
  static get table() {
    return 'styles';
  }
}

module.exports = Style;
