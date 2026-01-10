import Model from './model.js';

/**
 * Discover references between model tables.
 */
export function getReferences(config?: {
  models?: typeof Model[];
  ctx?: Record<string, any>;
}): Promise<Array<{
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
}>>;

/**
 * Add extenders that help to discover model relationships.
 */
export function link(config?: {
  models?: typeof Model[];
  ctx?: Record<string, any>;
}): Promise<void>;

