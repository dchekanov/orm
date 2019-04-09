const _ = require('lodash');

module.exports = {
  /**
   * Recursively convert objectKeys to row_keys.
   * @param object
   * @returns {*}
   */
  toRow: function(object) {
    function convertRecursive(source) {
      if (typeof source !== 'object') return source;

      source = _.mapKeys(source, (v, k) => {
        if (k.startsWith('$')) return k;

        return k.replace(/\w+/, _.snakeCase);
      });

      _.each(source, (v, k) => {
        if (Array.isArray(v)) source[k] = v.map(vv => convertRecursive(vv));
      });

      return source;
    }

    if (Array.isArray(object)) return object.map(convertRecursive);

    return convertRecursive(object);
  },
  /**
   * Convert row_keys to objectKeys.
   * @param row
   * @returns {object}
   */
  fromRow: function(row) {
    return _.mapKeys(row, (v, k) => _.camelCase(k));
  }
};
