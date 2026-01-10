import * as pg from 'pg';
import Db from './db.js';

/**
 * Base Model class for ORM operations.
 */
declare class Model {
  /** Db instance that stores model records. */
  static db: Db;
  /** The name of the table where model records are stored. */
  static table: string;
  /** The list of columns defined for the table. */
  static columns: string[];
  /** The function to generate instance id (optional, could be assigned by the DB upon saving). */
  static generateId?: () => any;
  /** Functions to be used to extend instances with additional properties. */
  static extenders?: Record<string, (instances: any[], ctx?: any) => Promise<void> | void>;
  /** A helper promise to avoid concurrent calls to refreshColumns(). */
  static _refreshColumnsPromise: Promise<void> | undefined;

  /**
   * @param properties - Properties to assign to the instance
   */
  constructor(properties?: Record<string, any>);

  /**
   * Create a new instance from a row.
   * @param row - Row object provided by the DB.
   * @returns A new instance of the model
   */
  static fromRow<M extends typeof Model>(this: M, row: Record<string, any>): InstanceType<M>;

  /**
   * Execute an SQL spec targeting the table of this model.
   * @private
   */
  static exec<M extends typeof Model>(
    this: M,
    spec: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<pg.QueryResult>;

  /**
   * Update the list of columns defined for the table.
   */
  static refreshColumns<M extends typeof Model>(
    this: M,
    ctx?: Record<string, any>
  ): Promise<void>;

  /**
   * Count instance records.
   */
  static count<M extends typeof Model>(
    this: M,
    spec?: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<number>;

  /**
   * Find instance records.
   */
  static find<M extends typeof Model>(
    this: M,
    spec?: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<InstanceType<M>[]>;

  static findOne<M extends typeof Model>(
    this: M,
    spec?: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<InstanceType<M> | undefined>;

  /**
   * Update instance records.
   */
  static update<M extends typeof Model>(
    this: M,
    spec?: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<pg.QueryResult>;

  /**
   * Delete instance records.
   */
  static delete<M extends typeof Model>(
    this: M,
    spec?: Record<string, any>,
    ctx?: Record<string, any>
  ): Promise<pg.QueryResult>;

  /**
   * Apply extenders to instances.
   */
  static extend<M extends typeof Model>(
    this: M,
    instances: InstanceType<M>[],
    properties: string[],
    ctx?: Record<string, any>
  ): Promise<void>;

  /**
   * Assign instance properties.
   * @param kOrObject - Either a key string or an object of properties
   * @param v - Value to assign (if kOrObject is a string)
   * @returns The instance for chaining
   */
  set(kOrObject: string | Record<string, any>, v?: any): this;

  /**
   * Insert an instance record into the DB.
   */
  insert(ctx?: Record<string, any>): Promise<this>;

  /**
   * Update DB instance record.
   */
  update(ctx?: Record<string, any>): Promise<this>;

  /**
   * Upsert instance record into the DB.
   */
  upsert(ctx?: Record<string, any>): Promise<this>;

  /**
   * Save the instance into the DB.
   * @param modeOrCtx - Either a mode string ('insert'|'update'|'upsert') or a context object
   * @param ctx - Context object (if modeOrCtx is a string)
   */
  save(modeOrCtx?: 'insert' | 'update' | 'upsert' | Record<string, any>, ctx?: Record<string, any>): Promise<this>;

  /**
   * Delete instance record.
   */
  delete(ctx?: Record<string, any>): Promise<pg.QueryResult>;

  /**
   * Apply extenders to the instance.
   */
  extend(properties: string[], ctx?: Record<string, any>): Promise<this>;

  /** Instance id property (can be any type) */
  id?: any;
  [key: string]: any;
}

export default Model;
