const _ = require('lodash');

/**
 * Convert objectKeys to row_keys, including all child elements.
 * @param {*} [target]
 * @returns {*} - A copy of the target with modified keys.
 */
function toSnakeCaseDeep(target) {
  if (Array.isArray(target)) {
    return target.map(toSnakeCaseDeep);
  }

  if (!target || typeof target !== 'object' || Object.keys(target).length === 0) {
    return target;
  }

  target = _.mapKeys(target, (v, k) => {
    // leave conditional helpers as is
    if (k.startsWith('$')) {
      return k;
    }

    return _.snakeCase(k);
  });

  target = _.mapValues(target, toSnakeCaseDeep);

  return target;
}

/**
 * Convert row_keys to objectKeys.
 * @param {*} [target]
 * @returns {*} - A copy of the target with modified keys.
 */
function toCamelCase(target) {
  return _.mapKeys(target, (v, k) => _.camelCase(k));
}

module.exports = {toCamelCase, toSnakeCaseDeep};
